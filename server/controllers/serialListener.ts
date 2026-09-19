import { constants, type ReadStream } from "node:fs";
import { type FileHandle, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { LineBuffer, reportLines } from "./lines";
import { prepareSerialDevice } from "./tty";
import { AUTO_SERIAL_DEVICE, type ControllerHub, type ControllerInput, type Log } from "./types";

const DEVICE_DIRECTORY = "/dev";
const ARDUINO_DEVICE_PREFIXES = ["ttyACM", "cu.usbmodem"] as const;
const RESCAN_MS = 3_000;
const NO_PERMISSION_CODES: readonly unknown[] = ["EACCES", "EPERM"];
/** Without O_NOCTTY a daemonised server would adopt the tty, and unplugging the stick would SIGHUP it. */
const READ_WITHOUT_ADOPTING_THE_TTY = constants.O_RDONLY | constants.O_NOCTTY;

export interface SerialListenerSettings {
  readonly rescanMs: number;
  readonly deviceDirectory: string;
  readonly prepare: (path: string) => Promise<void>;
  readonly log: Log;
}

const codeOf = (failure: unknown): unknown =>
  failure instanceof Error && "code" in failure ? failure.code : undefined;

const complaintAbout = (path: string, failure: unknown): string => {
  const code = codeOf(failure);
  if (NO_PERMISSION_CODES.includes(code)) {
    return `controllers: no permission to read ${path} — add this user to the dialout group (sudo usermod -aG dialout $USER), then log in again`;
  }
  if (code === "ENOENT") return `controllers: ${path} is not there; still looking for it`;
  return `controllers: reading ${path} failed (${failure instanceof Error ? failure.message : failure})`;
};

/**
 * Reads every device it is pointed at, for as long as it exists: a rescan opens whatever is there and
 * not yet open, so a stick plugged in late, or pulled and plugged back, is picked up within seconds.
 * Nothing in here may throw past the listener: a serial line that misbehaves is logged once and retried.
 */
class SerialListener implements ControllerInput {
  readonly description: string;
  readonly #hub: ControllerHub;
  readonly #device: string;
  readonly #settings: SerialListenerSettings;
  readonly #streams = new Map<string, ReadStream>();
  readonly #opening = new Set<string>();
  readonly #complaints = new Set<string>();
  #rescan: ReturnType<typeof setInterval> | null = null;

  constructor(hub: ControllerHub, device: string, settings: SerialListenerSettings) {
    this.#hub = hub;
    this.#device = device;
    this.#settings = settings;
    this.description =
      device === AUTO_SERIAL_DEVICE
        ? `serial ${join(settings.deviceDirectory, ARDUINO_DEVICE_PREFIXES[0])}*`
        : `serial ${device}`;
  }

  start(): this {
    this.#rescan = setInterval(() => void this.#scan(), this.#settings.rescanMs);
    this.#rescan.unref();
    void this.#scan();
    return this;
  }

  async close(): Promise<void> {
    if (this.#rescan !== null) clearInterval(this.#rescan);
    this.#rescan = null;
    for (const stream of this.#streams.values()) stream.destroy();
    this.#streams.clear();
  }

  get #listening(): boolean {
    return this.#rescan !== null;
  }

  async #scan(): Promise<void> {
    const unopened = (await this.#candidates()).filter(
      (path) => !this.#streams.has(path) && !this.#opening.has(path),
    );
    await Promise.all(unopened.map((path) => this.#open(path)));
  }

  async #candidates(): Promise<readonly string[]> {
    if (this.#device !== AUTO_SERIAL_DEVICE) return [this.#device];
    const { deviceDirectory } = this.#settings;
    const names = await readdir(deviceDirectory).catch(() => []);
    return names
      .filter((name) => ARDUINO_DEVICE_PREFIXES.some((prefix) => name.startsWith(prefix)))
      .sort()
      .map((name) => join(deviceDirectory, name));
  }

  async #open(path: string): Promise<void> {
    this.#opening.add(path);
    try {
      await this.#settings.prepare(path);
      const device = await open(path, READ_WITHOUT_ADOPTING_THE_TTY);
      if (this.#listening) this.#read(path, device);
      else await device.close();
    } catch (failure) {
      this.#complain(path, failure);
    } finally {
      this.#opening.delete(path);
    }
  }

  #read(path: string, device: FileHandle): void {
    const lines = new LineBuffer();
    const stream = device.createReadStream({ encoding: "utf8" });
    this.#streams.set(path, stream);
    stream.once("data", () => this.#settings.log(`controllers: hearing ${path}`));
    stream.on("data", (chunk) => reportLines(this.#hub, lines.push(String(chunk)), "serial"));
    stream.on("error", (failure) => this.#complain(path, failure));
    stream.on("close", () => {
      if (this.#streams.get(path) === stream) this.#streams.delete(path);
      if (stream.bytesRead > 0 && this.#listening) {
        this.#settings.log(`controllers: ${path} closed`);
      }
    });
  }

  #complain(path: string, failure: unknown): void {
    const complaint = complaintAbout(path, failure);
    if (this.#complaints.has(complaint)) return;
    this.#complaints.add(complaint);
    this.#settings.log(complaint);
  }
}

export const listenOnSerial = (
  hub: ControllerHub,
  device: string,
  {
    rescanMs = RESCAN_MS,
    deviceDirectory = DEVICE_DIRECTORY,
    prepare = prepareSerialDevice,
    log = console.log,
  }: Partial<SerialListenerSettings> = {},
): ControllerInput =>
  new SerialListener(hub, device, { rescanMs, deviceDirectory, prepare, log }).start();
