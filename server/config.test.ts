// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readConfig } from "./config";

describe("readConfig", () => {
  it("has no sidecar unless KAMI_RECOGNIZER_URL names one", () => {
    expect(readConfig({}).recognizerUrl).toBeNull();
    expect(readConfig({ KAMI_RECOGNIZER_URL: "   " }).recognizerUrl).toBeNull();
    expect(readConfig({ KAMI_RECOGNIZER_URL: " http://127.0.0.1:8790 " }).recognizerUrl).toBe(
      "http://127.0.0.1:8790",
    );
  });

  it("falls back to the default port on nonsense", () => {
    expect(readConfig({ PORT: "8799" }).port).toBe(8799);
    expect(readConfig({ PORT: "eighty" }).port).toBe(8787);
  });

  it("listens for controllers on UDP 8788 and any Arduino's serial line unless told otherwise", () => {
    expect(readConfig({}).controllers).toEqual({ udpPort: 8788, serialDevice: "auto" });
    expect(
      readConfig({ KAMI_CONTROLLER_UDP_PORT: " 9000 ", KAMI_CONTROLLER_SERIAL: " /dev/ttyUSB0 " })
        .controllers,
    ).toEqual({ udpPort: 9000, serialDevice: "/dev/ttyUSB0" });
    expect(readConfig({ KAMI_CONTROLLER_UDP_PORT: "loud" }).controllers.udpPort).toBe(8788);
  });

  it("switches a controller transport off with 'off'", () => {
    expect(
      readConfig({ KAMI_CONTROLLER_UDP_PORT: "off", KAMI_CONTROLLER_SERIAL: "OFF" }).controllers,
    ).toEqual({ udpPort: null, serialDevice: null });
  });
});
