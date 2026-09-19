import type { Rule, RuleCompiler, WorldPhysics } from "./types";

export * from "./types";

/** The offline compiler: a small grammar for the physics a whiteboard would say out loud. */
export function createRuleCompiler(): RuleCompiler {
  throw new Error("not implemented");
}

/** Tries each compiler in order and returns the first rule any of them understands. */
export function chainCompilers(_compilers: readonly RuleCompiler[]): RuleCompiler {
  throw new Error("not implemented");
}

/** Folds standing rules over EARTH; for each `governs`, the most recently created rule wins. */
export function resolvePhysics(_rules: readonly Rule[]): WorldPhysics {
  throw new Error("not implemented");
}
