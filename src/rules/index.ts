import { ChainedRuleCompiler } from "./chainedCompiler";
import { GrammarRuleCompiler } from "./grammarCompiler";
import { foldOverEarth } from "./resolvePhysics";
import type { Rule, RuleCompiler, WorldPhysics } from "./types";

export * from "./types";

/** The offline compiler: a small grammar for the physics a whiteboard would say out loud. */
export function createRuleCompiler(): RuleCompiler {
  return new GrammarRuleCompiler();
}

/** Tries each compiler in order and returns the first rule any of them understands. */
export function chainCompilers(compilers: readonly RuleCompiler[]): RuleCompiler {
  return new ChainedRuleCompiler(compilers);
}

/** Folds standing rules over EARTH; for each `governs`, the most recently created rule wins. */
export function resolvePhysics(rules: readonly Rule[]): WorldPhysics {
  return foldOverEarth(rules);
}
