import { describe, expect, it } from "vitest";
import { chainCompilers } from "./index";
import type { CompiledRule, RuleCompiler } from "./types";

const MOON: CompiledRule = {
  effect: { governs: "gravity", x: 0, y: 0.165 },
  explanation: "gravity = 0.17 g (the Moon)",
};
const SLOW: CompiledRule = {
  effect: { governs: "timeScale", value: 0.5 },
  explanation: "time runs at 0.5x",
};

const answering = (rule: CompiledRule | null): RuleCompiler => ({
  compile: () => Promise.resolve(rule),
});
const rejecting: RuleCompiler = { compile: () => Promise.reject(new Error("offline")) };
const throwing: RuleCompiler = {
  compile: () => {
    throw new Error("broken");
  },
};

describe("chainCompilers", () => {
  it("returns the first rule anyone understands", async () => {
    expect(
      await chainCompilers([answering(null), answering(MOON), answering(SLOW)]).compile("x"),
    ).toBe(MOON);
  });

  it("skips a compiler that throws or rejects", async () => {
    expect(await chainCompilers([throwing, rejecting, answering(SLOW)]).compile("x")).toBe(SLOW);
  });

  it("answers null when nobody understands, or nobody is there", async () => {
    expect(await chainCompilers([answering(null), rejecting]).compile("x")).toBeNull();
    expect(await chainCompilers([]).compile("x")).toBeNull();
  });

  it("does not ask later compilers once one has answered", async () => {
    let asked = 0;
    const counting: RuleCompiler = {
      compile: () => {
        asked += 1;
        return Promise.resolve(SLOW);
      },
    };
    await chainCompilers([answering(MOON), counting]).compile("x");
    expect(asked).toBe(0);
  });
});
