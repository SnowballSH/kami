import { INPUT_LIMITS } from "../core/inputLimits";
import type {
  CompileContext,
  CompiledRule,
  Governs,
  RuleCompiler,
  RuleEffect,
  Target,
} from "../rules/types";
import { browserFetch, compilePath, type FetchLike, JSON_HEADERS } from "./api";

const COMPILE_TIMEOUT_MS = 35_000;

type EffectFor<Setting extends Governs, Effect = RuleEffect> = Effect extends RuleEffect
  ? Setting extends Effect["governs"]
    ? Effect
    : never
  : never;
type Aim<Effect> = Effect extends { readonly of: Target } ? "body" : "world";
type Extent<Effect> = Effect extends { readonly x: number } ? "vector" : "scalar";
type ShapeOf<Setting extends Governs> = `${Aim<EffectFor<Setting>>}-${Extent<EffectFor<Setting>>}`;

/** Typed against `RuleEffect`, so a new setting fails the typecheck here until it is listed. */
const EFFECT_SHAPES: { readonly [Setting in Governs]: ShapeOf<Setting> } = {
  gravity: "world-vector",
  wind: "world-vector",
  timeScale: "world-scalar",
  airDrag: "world-scalar",
  friction: "world-scalar",
  bounciness: "world-scalar",
  temperature: "world-scalar",
  daylight: "world-scalar",
  flight: "world-scalar",
  walkSpeed: "world-scalar",
  aliceSize: "world-scalar",
  attraction: "world-scalar",
  clones: "world-scalar",
  inkEater: "world-scalar",
  tilt: "world-scalar",
  worldSpin: "world-scalar",
  spin: "body-scalar",
  thrust: "body-vector",
  mass: "body-scalar",
  bounce: "body-scalar",
  grip: "body-scalar",
  pace: "body-scalar",
  wings: "body-scalar",
  size: "body-scalar",
  heed: "body-scalar",
  glow: "body-scalar",
};

const isGoverns = (setting: string): setting is Governs => Object.hasOwn(EFFECT_SHAPES, setting);

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isTarget = (value: unknown): value is Target =>
  isRecord(value) &&
  (value.kind === "all" || (value.kind === "named" && typeof value.name === "string"));

const isRuleEffect = (value: unknown): value is RuleEffect => {
  if (!isRecord(value) || typeof value.governs !== "string" || !isGoverns(value.governs)) {
    return false;
  }
  const [aim, extent] = EFFECT_SHAPES[value.governs].split("-");
  if (aim === "body" && !isTarget(value.of)) return false;
  return extent === "vector"
    ? isFiniteNumber(value.x) && isFiniteNumber(value.y)
    : isFiniteNumber(value.value);
};

export const isCompiledRule = (value: unknown): value is CompiledRule =>
  isRecord(value) && isRuleEffect(value.effect) && typeof value.explanation === "string";

export class RemoteRuleCompiler implements RuleCompiler {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async compile(text: string, context?: CompileContext): Promise<CompiledRule | null> {
    if (text.length > INPUT_LIMITS.text) return null;
    try {
      const response = await this.#fetch(compilePath(), {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ text, ...context }),
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
