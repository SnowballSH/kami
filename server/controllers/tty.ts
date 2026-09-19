import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { platform } from "node:os";

const BAUD = "115200";
const STTY_DEVICE_FLAG = platform() === "darwin" ? "-f" : "-F";
const STTY_TIMEOUT_MS = 2_000;

const isCharacterDevice = (path: string): Promise<boolean> =>
  stat(path).then(
    (stats) => stats.isCharacterDevice(),
    () => false,
  );

/** Best effort: a raw, echo-free line at the sketch's baud rate. Anything that is not a tty is left alone. */
export const prepareSerialDevice = async (path: string): Promise<void> => {
  if (!(await isCharacterDevice(path))) return;
  await new Promise<void>((done) =>
    execFile(
      "stty",
      [STTY_DEVICE_FLAG, path, BAUD, "raw", "-echo"],
      { timeout: STTY_TIMEOUT_MS },
      () => done(),
    ),
  );
};
