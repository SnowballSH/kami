// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isControllerId, parseControllerLine, parseControllerReading } from "./message";

const reading = (x: number, y: number, ...buttons: string[]) => ({ x, y, buttons });
const arcade = (x: number, y: number, ...buttons: string[]) => ({
  controller: "arcade",
  reading: reading(x, y, ...buttons),
});

describe("parseControllerLine", () => {
  it.each([
    ["kami arcade 100 0", arcade(100, 0)],
    ["kami arcade -70 85", arcade(-70, 85)],
    ["kami arcade 60 0 A", arcade(60, 0, "a")],
    ["kami arcade 0 0", arcade(0, 0)],
    ["kami arcade 0 0\r\n", arcade(0, 0)],
    ["  kami   stick-2  +5   -5  ", { controller: "stick-2", reading: reading(5, -5) }],
    ["kami arcade 250 -999", arcade(100, -100)],
    ["kami arcade 12.6 -0.2", arcade(13, 0)],
    ["kami arcade 0 0 YXBA", arcade(0, 0, "a", "b", "x", "y")],
    ["kami arcade 0 0 AAB", arcade(0, 0, "a", "b")],
    ["kami arcade 0 0 a B", arcade(0, 0, "a", "b")],
    ["kami arcade 0 0 AQZ!", arcade(0, 0, "a")],
    ["kami arcade 0 0 LR", arcade(0, 0)],
  ])("reads %j", (line, message) => {
    expect(parseControllerLine(line)).toEqual(message);
  });

  it.each([
    ["nothing at all", ""],
    ["another protocol", "hello arcade 100 0"],
    ["the wrong case of the word", "KAMI arcade 100 0"],
    ["a missing controller", "kami"],
    ["an upper-case controller", "kami Arcade 100 0"],
    ["a controller with odd characters", "kami arc_ade 100 0"],
    ["a controller longer than 32", `kami ${"a".repeat(33)} 100 0`],
    ["a missing axis", "kami arcade 100"],
    ["words for axes", "kami arcade left up"],
    ["a hexadecimal axis", "kami arcade 0x10 0"],
    ["an exponent axis", "kami arcade 1e2 0"],
    ["NaN", "kami arcade NaN 0"],
    ["Infinity", "kami arcade Infinity 0"],
    ["binary noise", `${String.fromCharCode(0, 255, 7)} kami`],
  ])("answers null to %s", (_what, line) => {
    expect(parseControllerLine(line)).toBeNull();
  });
});

describe("parseControllerReading", () => {
  it.each([
    ["100 0", reading(100, 0)],
    ["100 0 A", reading(100, 0, "a")],
    [" -40\t40 XY\n", reading(-40, 40, "x", "y")],
    ["-0 0", reading(0, 0)],
  ])("reads %j", (body, expected) => {
    expect(parseControllerReading(body)).toEqual(expected);
  });

  it.each(["", "100", "fast 0", "kami arcade 100 0", "{}", "100,0"])(
    "answers null to %j",
    (body) => {
      expect(parseControllerReading(body)).toBeNull();
    },
  );
});

describe("isControllerId", () => {
  it("accepts 1–32 of a-z, 0-9 and '-'", () => {
    expect(["arcade", "a", "stick-2", "a".repeat(32)].every(isControllerId)).toBe(true);
    expect(["", "Arcade", "two words", "a/b", "a".repeat(33)].some(isControllerId)).toBe(false);
  });
});
