import { INPUT_LIMITS } from "../core/inputLimits";
import type { CompiledRule, Governs, RuleCompiler, RuleEffect } from "../rules/types";
import { browserFetch, compilePath, type FetchLike, JSON_HEADERS } from "./api";

const COMPILE_TIMEOUT_MS = 35_000;

type ShapeOf<Setting extends Governs> =
  Extract<RuleEffect, { governs: Setting }> extends { readonly x: number } ? "vector" : "scalar";

/** Typed against `RuleEffect`, so a new setting fails the typecheck here until it is listed. */
const EFFECT_SHAPES: { readonly [Setting in Governs]: ShapeOf<Setting> } = {
  gravity: "vector",
  wind: "vector",
  timeScale: "scalar",
  airDrag: "scalar",
  friction: "scalar",
  bounciness: "scalar",
  temperature: "scalar",
  daylight: "scalar",
  flight: "scalar",
  walkSpeed: "scalar",
  aliceSize: "scalar",
  attraction: "scalar",
  clones: "scalar",
  inkEater: "scalar",
};

const isGoverns = (setting: string): setting is Governs => Object.hasOwn(EFFECT_SHAPES, setting);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRuleEffect = (value: unknown): value is RuleEffect => {
  if (!isRecord(value) || typeof value.governs !== "string" || !isGoverns(value.governs)) {
    return false;
  }
  return EFFECT_SHAPES[value.governs] === "vector"
    ? isFiniteNumber(value.x) && isFiniteNumber(value.y)
    : isFiniteNumber(value.value);
};

const isCompiledRule = (value: unknown): value is CompiledRule =>
  isRecord(value) && isRuleEffect(value.effect) && typeof value.explanation === "string";

export class RemoteRuleCompiler implements RuleCompiler {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async compile(text: string): Promise<CompiledRule | null> {
    if (text.length > INPUT_LIMITS.text) return null;
    try {
      const response = await this.#fetch(compilePath(), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(COMPILE_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return isRecord(body) && isCompiledRule(body.rule) ? body.rule : null;
    } catch {
      return null;
    }
  }
}
