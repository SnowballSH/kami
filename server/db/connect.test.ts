// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDED_CACHE_GB, embeddedMongodArgs, MIN_EMBEDDED_CACHE_GB } from "./connect";

describe("embeddedMongodArgs", () => {
  it("caps WiredTiger's cache at a quarter gigabyte by default and turns diagnostics off", () => {
    expect(DEFAULT_EMBEDDED_CACHE_GB).toBe(0.25);
    expect(embeddedMongodArgs()).toEqual([
      "--wiredTigerCacheSizeGB",
      "0.25",
      "--setParameter",
      "diagnosticDataCollectionEnabled=false",
    ]);
  });

  it("takes a larger cache when asked and never one mongod would refuse", () => {
    expect(embeddedMongodArgs(1)).toContain("1");
    expect(embeddedMongodArgs(0.1)[1]).toBe(String(MIN_EMBEDDED_CACHE_GB));
  });
});
