// @vitest-environment node
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryControllerHub } from "./hub";
import { listenOnSerial, type SerialListenerSettings } from "./serialListener";
import { ManualClock } from "./testing/manualClock";
import { AUTO_SERIAL_DEVICE, type ControllerInput } from "./types";

const RESCAN_MS = 10;
const SEVERAL_RESCANS_MS = 80;

let directory: string;
let hub: InMemoryControllerHub;
let logged: string[];
let listeners: ControllerInput[];

const listen = (
  device: string,
  settings: Partial<SerialListenerSettings> = {},
): ControllerInput => {
  const listener = listenOnSerial(hub, device, {
    rescanMs: RESCAN_MS,
    deviceDirectory: directory,
    prepare: async () => {},
    log: (line) => logged.push(line),
    ...settings,
  });
  listeners.push(listener);
  return listener;
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "kami-serial-"));
  hub = new InMemoryControllerHub(new ManualClock());
  logged = [];
  listeners = [];
});

afterEach(async () => {
  await Promise.all(listeners.map((listener) => listener.close()));
  hub.close();
  await rm(directory, { recursive: true, force: true });
});

describe("the serial listener", () => {
  it("reads the lines a device prints, whatever else is on the wire", async () => {
    const device = join(directory, "stick");
    await writeFile(device, "booting...\r\nkami arcade 0 100\r\nkami arcade -100 0 B\r\nkami arc");
    expect(listen(device).description).toBe(`serial ${device}`);
    await vi.waitFor(() =>
      expect(hub.list()).toEqual([
        {
          id: "arcade",
          x: -1,
          y: 0,
          held: ["left"],
          buttons: ["b"],
          transport: "serial",
          idleMs: 0,
        },
      ]),
    );
    expect(logged).toContain(`controllers: hearing ${device}`);
  });

  it("finds an Arduino by itself, also one that is plugged in later", async () => {
    const listener = listen(AUTO_SERIAL_DEVICE);
    expect(listener.description).toBe(`serial ${join(directory, "ttyACM")}*`);
    await pause(SEVERAL_RESCANS_MS);
    expect(hub.list()).toEqual([]);
    expect(logged).toEqual([]);

    await writeFile(join(directory, "ttyUSB0"), "kami wrong 100 0\n");
    await writeFile(join(directory, "ttyACM1"), "kami late 100 0\n");
    await vi.waitFor(() => expect(hub.list().map(({ id }) => id)).toEqual(["late"]));
  });

  it("sets the line up before reading it", async () => {
    const device = join(directory, "ttyACM0");
    await writeFile(device, "kami arcade 100 0\n");
    const prepared: string[] = [];
    listen(AUTO_SERIAL_DEVICE, {
      prepare: async (path) => {
        expect(hub.list()).toEqual([]);
        prepared.push(path);
      },
    });
    await vi.waitFor(() => expect(hub.list()).toHaveLength(1));
    expect(prepared[0]).toBe(device);
  });

  it("names the dialout group once when the device may not be read, and keeps going", async () => {
    const device = join(directory, "ttyACM0");
    await writeFile(device, "kami arcade 100 0\n");
    await chmod(device, 0o000);
    listen(AUTO_SERIAL_DEVICE);
    await pause(SEVERAL_RESCANS_MS);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("dialout");

    await chmod(device, 0o644);
    await vi.waitFor(() => expect(hub.list()).toHaveLength(1));
  });

  it("waits quietly for a named device that is not there, and for a preparation that fails", async () => {
    const device = join(directory, "not-yet");
    listen(device);
    listen(join(directory, "cursed"), {
      prepare: async () => {
        throw new Error("stty fell over");
      },
    });
    await pause(SEVERAL_RESCANS_MS);
    expect(logged.filter((line) => line.includes(device))).toHaveLength(1);
    expect(logged.filter((line) => line.includes("stty fell over"))).toHaveLength(1);

    await writeFile(device, "kami arcade 0 -100\n");
    await vi.waitFor(() => expect(hub.list()[0]?.held).toEqual(["down"]));
  });

  it("stops reading once closed", async () => {
    const device = join(directory, "stick");
    const listener = listen(device);
    await listener.close();
    await writeFile(device, "kami arcade 100 0\n");
    await pause(SEVERAL_RESCANS_MS);
    expect(hub.list()).toEqual([]);
  });
});
