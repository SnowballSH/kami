import { clamp, type Vec } from "../core/geometry";
import { GOVERNS } from "./subjects";
import {
  type BodyLaw,
  type Governs,
  isBodyEffect,
  type RuleEffect,
  type Target,
  type WorldPhysics,
} from "./types";

interface Domain {
  readonly min: number;
  readonly max: number;
}

export const EFFECT_DOMAINS: Readonly<Record<Governs, Domain>> = {
  gravity: { min: -30, max: 30 },
  wind: { min: -3, max: 3 },
  timeScale: { min: 0.1, max: 3 },
  airDrag: { min: 0, max: 10 },
  friction: { min: 0, max: 10 },
  bounciness: { min: 0, max: 1 },
  temperature: { min: -100, max: 1000 },
  daylight: { min: 0, max: 1 },
  flight: { min: 0, max: 1 },
  walkSpeed: { min: 0.1, max: 5 },
  aliceSize: { min: 0.25, max: 4 },
  attraction: { min: -3, max: 3 },
  clones: { min: 0, max: 8 },
  inkEater: { min: 0, max: 1 },
  tilt: { min: -180, max: 180 },
  worldSpin: { min: -90, max: 90 },
  spin: { min: -5, max: 5 },
  thrust: { min: -3, max: 3 },
  mass: { min: 0.1, max: 10 },
  bounce: { min: 0, max: 1 },
  grip: { min: 0, max: 5 },
  pace: { min: 0.1, max: 5 },
  wings: { min: 0, max: 1 },
  size: { min: 0.25, max: 4 },
  heed: { min: -1, max: 1 },
  glow: { min: 0, max: 1 },
};

export const inEffectDomain = (governs: Governs, value: number): boolean => {
  const { min, max } = EFFECT_DOMAINS[governs];
  return (
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (governs !== "clones" || Number.isInteger(value))
  );
};

const isGoverns = (key: string): key is Governs => Object.hasOwn(EFFECT_DOMAINS, key);

const inDomain = (governs: Governs, value: number | Vec): boolean =>
  typeof value === "number"
    ? inEffectDomain(governs, value)
    : inEffectDomain(governs, value.x) && inEffectDomain(governs, value.y);

const validTarget = (of: Target): boolean =>
  of.kind === "all" || (of.kind === "named" && of.name.trim().length > 0);

export const validEffect = (effect: RuleEffect): boolean =>
  (!isBodyEffect(effect) || validTarget(effect.of)) &&
  inDomain(effect.governs, "value" in effect ? effect.value : effect);

const validBodyLaw = ({ of, edit }: BodyLaw): boolean =>
  validTarget(of) &&
  Object.entries(edit).every(
    ([governs, value]) => value === undefined || !isGoverns(governs) || inDomain(governs, value),
  );

export const validPhysics = (physics: WorldPhysics): boolean =>
  GOVERNS.every((governs) => inDomain(governs, physics[governs])) &&
  physics.bodies.every(validBodyLaw);

export const clampEffectValue = (governs: Governs, value: number): number => {
  const { min, max } = EFFECT_DOMAINS[governs];
  const bounded = clamp(value, min, max);
  return governs === "clones" ? Math.round(bounded) : bounded;
};
