import { describe, expect, it } from "vitest";
import { GrammarRuleCompiler, speaksOfReferent } from "./grammarCompiler";
import { referentOf } from "./referents";
import type { CompileContext } from "./types";

const BESIDE_A_BOAT: CompileContext = { referent: "boat" };
const grammar = new GrammarRuleCompiler();
const read = (text: string, context?: CompileContext) =>
  grammar.read(text, context)?.effect ?? null;
const boat = { kind: "named", name: "boat" } as const;

describe("a pronoun beside a named drawing", () => {
  it.each([
    ["it drifts to the right", { governs: "thrust", of: boat, x: 0.5, y: 0 }],
    ["it sails left slowly", { governs: "thrust", of: boat, x: -0.2, y: 0 }],
    ["it spins", { governs: "spin", of: boat, value: 1 }],
    ["this spins backwards", { governs: "spin", of: boat, value: -1 }],
    ["it is heavy", { governs: "mass", of: boat, value: 2 }],
    ["that one is heavy", { governs: "mass", of: boat, value: 2 }],
    ["make it bouncy", { governs: "bounce", of: boat, value: 0.8 }],
    ["it's slippery", { governs: "grip", of: boat, value: 0 }],
    ["it glows", { governs: "glow", of: boat, value: 1 }],
    ["they float", { governs: "wings", of: boat, value: 1 }],
    ["make them heavy", { governs: "mass", of: boat, value: 2 }],
    ["it follows me", { governs: "heed", of: boat, value: 1 }],
  ])("reads %j as a law about the drawing", (text, effect) => {
    expect(read(text, BESIDE_A_BOAT)).toEqual(effect);
    expect(read(text)).toBeNull();
  });

  it("leaves what names its own subject, or the world, as it was", () => {
    expect(read("the rock spins", BESIDE_A_BOAT)).toMatchObject({ of: { name: "rock" } });
    expect(read("everything spins", BESIDE_A_BOAT)).toMatchObject({ of: { kind: "all" } });
    expect(read("it is cold", BESIDE_A_BOAT)).toEqual({ governs: "temperature", value: -10 });
    expect(read("make them all bouncy", BESIDE_A_BOAT)).toMatchObject({ governs: "bounciness" });
  });

  it("does not take a name for a law", () => {
    expect(read("it is a boat", BESIDE_A_BOAT)).toBeNull();
    expect(read("this is a heavy boat", BESIDE_A_BOAT)).toBeNull();
    expect(read("it is a bouncy mushroom", BESIDE_A_BOAT)).toBeNull();
  });

  it("does not bind a pronoun Alice is doing something to", () => {
    expect(read("alice chases it", BESIDE_A_BOAT)).toBeNull();
    expect(read("make her follow it", BESIDE_A_BOAT)).toBeNull();
  });
});

describe("speaksOfReferent", () => {
  it("is true only of laws that need something beside them to be about", () => {
    expect(speaksOfReferent("it spins")).toBe(true);
    expect(speaksOfReferent("they float")).toBe(true);
    expect(speaksOfReferent("the wheel spins")).toBe(false);
    expect(speaksOfReferent("it is cold")).toBe(false);
    expect(speaksOfReferent("it is a boat")).toBe(false);
    expect(speaksOfReferent("hello there")).toBe(false);
  });
});

describe("referentOf", () => {
  it.each([
    ["a boat", "boat"],
    ["A little red boat!", "boat"],
    ["a cat that follows her", "cat"],
    ["hot air balloon", "balloon"],
    ["a king of the hill", "king"],
    ["the", null],
    ["", null],
  ])("takes %j to stand for %j", (name, referent) => {
    expect(referentOf(name)).toBe(referent);
  });
});
