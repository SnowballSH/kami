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

  it("drops an entire overlong line, including a plausible suffix in the next chunk", () => {
    const buffer = new LineBuffer();
    expect(buffer.push("x".repeat(10_000))).toEqual([]);
    expect(buffer.push("kami arcade 1 1\n")).toEqual([]);
    expect(buffer.push("kami arcade 0 0\n")).toEqual(["kami arcade 0 0"]);
  });

  it("enforces the same length limit within a single chunk and at a chunk boundary", () => {
    const buffer = new LineBuffer();
    expect(buffer.push(`${"x".repeat(257)}\rS,1,0,0,0,0\n`)).toEqual(["S,1,0,0,0,0"]);
    expect(buffer.push("x".repeat(256))).toEqual([]);
    expect(buffer.push("\n")).toEqual(["x".repeat(256)]);
    expect(buffer.push("x".repeat(256))).toEqual([]);
    expect(buffer.push("x\n")).toEqual([]);
  });
});

describe("linesOf", () => {
  it("splits a datagram that holds several lines", () => {
    expect(linesOf("kami a 1 1\nkami b 2 2\r\n")).toEqual(["kami a 1 1", "kami b 2 2", ""]);
  });
});
