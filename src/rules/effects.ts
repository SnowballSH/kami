import { clamp, type Vec } from "../core/geometry";
import { EARTH_BODY } from "./bodies";
import { DIRECTION_LABELS, directionOf } from "./directions";
import {
  type BodyGoverns,
  type CompiledRule,
  EARTH,
  type Target,
  type WorldGoverns,
} from "./types";

type FieldGoverns = Extract<WorldGoverns, "gravity" | "wind">;
export type ScalarGoverns = Exclude<WorldGoverns, FieldGoverns>;
export type BodyScalarGoverns = Exclude<BodyGoverns, "thrust">;

interface Range {
  readonly min: number;
  readonly max: number;
}

interface ScalarStyle {
  readonly range: Range;
  readonly gloss: (shown: string) => string;
  readonly glossAtZero: string | null;
}

const MAX_FIELD_IN_G: Readonly<Record<FieldGoverns, number>> = { gravity: 5, wind: 2 };

const SCALAR_STYLES: Readonly<Record<ScalarGoverns, ScalarStyle>> = {
  timeScale: {
    range: { min: 0.1, max: 3 },
    gloss: (shown) => `time runs at ${shown}x`,
    glossAtZero: null,
  },
  friction: {
    range: { min: 0, max: 5 },
    gloss: (shown) => `friction = ${shown}`,
    glossAtZero: "friction off",
  },
  bounciness: {
    range: { min: 0, max: 1 },
    gloss: (shown) => `bounciness = ${shown}`,
    glossAtZero: "bounciness off",
  },
  airDrag: {
    range: { min: 0, max: 10 },
    gloss: (shown) => `air drag = ${shown}`,
    glossAtZero: "air drag off",
  },
  temperature: {
    range: { min: -100, max: 1000 },
    gloss: (shown) => `temperature = ${shown} °C`,
    glossAtZero: null,
  },
  daylight: {
    range: { min: 0, max: 1 },
    gloss: (shown) => `daylight = ${shown}`,
    glossAtZero: "night",
  },
  flight: {
    range: { min: 0, max: 1 },
    gloss: () => "Alice can fly",
    glossAtZero: "Alice walks",
  },
  walkSpeed: {
    range: { min: 0.1, max: 5 },
    gloss: (shown) => `Alice walks at ${shown}x`,
    glossAtZero: null,
  },
  aliceSize: {
    range: { min: 0.25, max: 4 },
    gloss: (shown) => `Alice is ${shown}x her size`,
    glossAtZero: null,
  },
  attraction: {
    range: { min: -3, max: 3 },
    gloss: (shown) => `Alice pulls at ${shown} g`,
    glossAtZero: "Alice pulls nothing",
  },
  clones: {
    range: { min: 0, max: 8 },
    gloss: (shown) => `${shown} more of Alice`,
    glossAtZero: "one Alice",
  },
  inkEater: {
    range: { min: 0, max: 1 },
    gloss: () => "the Sumikui, the ink eater, is loose",
    glossAtZero: "the Sumikui is sealed",
  },
};

const BODY_STYLES: Readonly<Record<BodyScalarGoverns, ScalarStyle>> = {
  spin: {
    range: { min: -5, max: 5 },
    gloss: (shown) => `spin = ${shown} turns/s`,
    glossAtZero: "spin off",
  },
  mass: {
    range: { min: 0.1, max: 10 },
    gloss: (shown) => `weight = ${shown}x`,
    glossAtZero: null,
  },
  bounce: {
    range: { min: 0, max: 1 },
    gloss: (shown) => `bounce = ${shown}`,
    glossAtZero: "bounce off",
  },
  grip: {
    range: { min: 0, max: 5 },
    gloss: (shown) => `grip = ${shown}x`,
    glossAtZero: "grip off, slick as ice",
  },
};

const MAX_THRUST_IN_G = 3;

const EFFECT_DECIMALS = 3;
const GLOSS_DECIMALS = 2;
const CAPPED = "capped";

const rounded = (value: number, decimals: number): number => Number(value.toFixed(decimals)) || 0;

export const shownNumber = (value: number): string => String(rounded(value, GLOSS_DECIMALS));

const annotated = (gloss: string, notes: readonly (string | null)[]): string => {
  const said = notes.filter((note) => note !== null);
  return said.length === 0 ? gloss : `${gloss} (${said.join(", ")})`;
};

const cappedField = (field: Vec, max: number): Vec => {
  const size = Math.hypot(field.x, field.y);
  const scale = size > max ? max / size : 1;
  return {
    x: rounded(field.x * scale, EFFECT_DECIMALS),
    y: rounded(field.y * scale, EFFECT_DECIMALS),
  };
};

const exceeds = (field: Vec, max: number): boolean => Math.hypot(field.x, field.y) > max;

/** `origin` is where the number came from, e.g. "the Moon". Straight down goes without saying. */
export const gravityRule = (field: Vec, origin: string | null = null): CompiledRule => {
  const applied = cappedField(field, MAX_FIELD_IN_G.gravity);
  const size = Math.hypot(applied.x, applied.y);
  const direction = directionOf(applied);
  const heading = direction === "down" ? "" : `, ${DIRECTION_LABELS[direction]}`;
  const gloss = size === 0 ? "gravity off" : `gravity = ${shownNumber(size)} g${heading}`;
  const cap = exceeds(field, MAX_FIELD_IN_G.gravity) ? CAPPED : null;
  return {
    effect: { governs: "gravity", ...applied },
    explanation: annotated(gloss, [origin, cap]),
  };
};

export const windRule = (field: Vec): CompiledRule => {
  const applied = cappedField(field, MAX_FIELD_IN_G.wind);
  const size = Math.hypot(applied.x, applied.y);
  const gloss =
    size === 0
      ? "wind off"
      : `wind = ${shownNumber(size)} g, ${DIRECTION_LABELS[directionOf(applied)]}`;
  const cap = exceeds(field, MAX_FIELD_IN_G.wind) ? CAPPED : null;
  return { effect: { governs: "wind", ...applied }, explanation: annotated(gloss, [cap]) };
};

export const scalarRule = (governs: ScalarGoverns, requested: number): CompiledRule => {
  const { range, gloss, glossAtZero } = SCALAR_STYLES[governs];
  const value = rounded(clamp(requested, range.min, range.max), EFFECT_DECIMALS);
  const cap = requested < range.min || requested > range.max ? CAPPED : null;
  const said = value === 0 && glossAtZero !== null ? glossAtZero : gloss(shownNumber(value));
  return { effect: { governs, value }, explanation: annotated(said, [cap]) };
};

const targetLabel = (of: Target): string => (of.kind === "all" ? "everything" : `the ${of.name}`);

export const bodyRule = (
  governs: BodyScalarGoverns,
  of: Target,
  requested: number,
): CompiledRule => {
  const { range, gloss, glossAtZero } = BODY_STYLES[governs];
  const value = rounded(clamp(requested, range.min, range.max), EFFECT_DECIMALS);
  const cap = requested < range.min || requested > range.max ? CAPPED : null;
  const said = value === 0 && glossAtZero !== null ? glossAtZero : gloss(shownNumber(value));
  return {
    effect: { governs, of, value },
    explanation: annotated(`${targetLabel(of)}: ${said}`, [cap]),
  };
};

export const thrustRule = (of: Target, field: Vec): CompiledRule => {
  const applied = cappedField(field, MAX_THRUST_IN_G);
  const size = Math.hypot(applied.x, applied.y);
  const said =
    size === 0
      ? "thrust off"
      : `thrust = ${shownNumber(size)} g, ${DIRECTION_LABELS[directionOf(applied)]}`;
  const cap = exceeds(field, MAX_THRUST_IN_G) ? CAPPED : null;
  return {
    effect: { governs: "thrust", of, ...applied },
    explanation: annotated(`${targetLabel(of)}: ${said}`, [cap]),
  };
};

export const earthRule = (governs: WorldGoverns): CompiledRule => {
  if (governs === "gravity") return gravityRule(EARTH.gravity, EARTH_BODY.label);
  if (governs === "wind") return windRule(EARTH.wind);
  return scalarRule(governs, EARTH[governs]);
};
