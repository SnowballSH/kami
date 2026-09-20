import { clamp } from "../core/geometry";
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
  spin: { min: -5, max: 5 },
  thrust: { min: -3, max: 3 },
  mass: { min: 0.1, max: 10 },
  bounce: { min: 0, max: 1 },
  grip: { min: 0, max: 5 },
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

const validTarget = (of: Target): boolean =>
  of.kind === "all" || (of.kind === "named" && of.name.trim().length > 0);

export const validEffect = (effect: RuleEffect): boolean => {
  if (isBodyEffect(effect) && !validTarget(effect.of)) return false;
  return "value" in effect
    ? inEffectDomain(effect.governs, effect.value)
    : inEffectDomain(effect.governs, effect.x) && inEffectDomain(effect.governs, effect.y);
};

const validBodyLaw = ({ of, edit }: BodyLaw): boolean =>
  validTarget(of) &&
  (edit.spin === undefined || inEffectDomain("spin", edit.spin)) &&
  (edit.thrust === undefined ||
    (inEffectDomain("thrust", edit.thrust.x) && inEffectDomain("thrust", edit.thrust.y))) &&
  (edit.mass === undefined || inEffectDomain("mass", edit.mass)) &&
  (edit.bounce === undefined || inEffectDomain("bounce", edit.bounce)) &&
  (edit.grip === undefined || inEffectDomain("grip", edit.grip));

export const validPhysics = (physics: WorldPhysics): boolean =>
  validEffect({ governs: "gravity", ...physics.gravity }) &&
  validEffect({ governs: "wind", ...physics.wind }) &&
  inEffectDomain("timeScale", physics.timeScale) &&
  inEffectDomain("airDrag", physics.airDrag) &&
  inEffectDomain("friction", physics.friction) &&
  inEffectDomain("bounciness", physics.bounciness) &&
  inEffectDomain("temperature", physics.temperature) &&
  inEffectDomain("daylight", physics.daylight) &&
  inEffectDomain("flight", physics.flight) &&
  inEffectDomain("walkSpeed", physics.walkSpeed) &&
  inEffectDomain("aliceSize", physics.aliceSize) &&
  inEffectDomain("attraction", physics.attraction) &&
  inEffectDomain("clones", physics.clones) &&
  inEffectDomain("inkEater", physics.inkEater) &&
  physics.bodies.every(validBodyLaw);

export const clampEffectValue = (governs: Governs, value: number): number => {
  const { min, max } = EFFECT_DOMAINS[governs];
  const bounded = clamp(value, min, max);
  return governs === "clones" ? Math.round(bounded) : bounded;
};
