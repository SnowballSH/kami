import { ChainedRuleCompiler } from "./chainedCompiler";
import { GrammarRuleCompiler } from "./grammarCompiler";
import { foldOver } from "./resolvePhysics";
import { AtlasSceneCompiler } from "./scenes/sceneCompiler";
import {
  EARTH,
  type Rule,
  type RuleCompiler,
  type SceneCompiler,
  type WorldPhysics,
} from "./types";

export { placeCalled } from "./scenes/atlas";
export { destinationOf } from "./scenes/travel";
export * from "./types";

/** The offline compiler: a small grammar for the physics a whiteboard would say out loud. */
export function createRuleCompiler(): RuleCompiler {
  return new GrammarRuleCompiler();
}

/** Tries each compiler in order and returns the first rule any of them understands. */
export function chainCompilers(compilers: readonly RuleCompiler[]): RuleCompiler {
  return new ChainedRuleCompiler(compilers);
}

/**
 * Places to be teleported to: the offline atlas first (the Moon, the ocean, Candy Land…), then
 * `farther` — a model — for anywhere it has never heard of.
 */
export function createSceneCompiler(farther: SceneCompiler | null = null): SceneCompiler {
  return new AtlasSceneCompiler(farther);
}

/** Folds standing rules over `base` (EARTH unless a room lays down its own); for each `governs`, the most recently created rule wins. */
export function resolvePhysics(rules: readonly Rule[], base: WorldPhysics = EARTH): WorldPhysics {
  return foldOver(base, rules);
}
