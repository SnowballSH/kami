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
});
