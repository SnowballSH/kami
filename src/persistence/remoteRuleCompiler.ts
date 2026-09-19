import type { CompiledRule, RuleCompiler, RuleEffect } from "../rules/types";
import { browserFetch, compilePath, type FetchLike, JSON_HEADERS } from "./api";

const COMPILE_TIMEOUT_MS = 35_000;

const VECTOR_SETTINGS: readonly string[] = ["gravity", "wind"];
const SCALAR_SETTINGS: readonly string[] = ["timeScale", "airDrag", "friction", "bounciness"];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isRuleEffect = (value: unknown): value is RuleEffect => {
  if (!isRecord(value) || typeof value.governs !== "string") return false;
  if (VECTOR_SETTINGS.includes(value.governs)) {
    return isFiniteNumber(value.x) && isFiniteNumber(value.y);
  }
  return SCALAR_SETTINGS.includes(value.governs) && isFiniteNumber(value.value);
};

const isCompiledRule = (value: unknown): value is CompiledRule =>
  isRecord(value) && isRuleEffect(value.effect) && typeof value.explanation === "string";

export class RemoteRuleCompiler implements RuleCompiler {
  readonly #fetch: FetchLike;

  constructor(fetchFn: FetchLike = browserFetch) {
    this.#fetch = fetchFn;
  }

  async compile(text: string): Promise<CompiledRule | null> {
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
