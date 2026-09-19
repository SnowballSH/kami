// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LineBuffer, linesOf } from "./lines";

describe("LineBuffer", () => {
  it("hands out whole lines however the stream is cut", () => {
    const buffer = new LineBuffer();
    expect(buffer.push("kami arc")).toEqual([]);
    expect(buffer.push("ade 100 0\r")).toEqual(["kami arcade 100 0"]);
    expect(buffer.push("\nkami arcade 0 0\nkami")).toEqual(["", "kami arcade 0 0"]);
    expect(buffer.push(" arcade 5 5\n")).toEqual(["kami arcade 5 5"]);
  });

  it("drops noise that never ends a line instead of growing", () => {
    const buffer = new LineBuffer();
    expect(buffer.push("x".repeat(10_000))).toEqual([]);
    expect(buffer.push("kami arcade 1 1\n")).toEqual(["kami arcade 1 1"]);
  });
});

describe("linesOf", () => {
  it("splits a datagram that holds several lines", () => {
    expect(linesOf("kami a 1 1\nkami b 2 2\r\n")).toEqual(["kami a 1 1", "kami b 2 2", ""]);
  });
});
