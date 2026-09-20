import { validEffect } from "./effectDomains";
import { lawOf } from "./motion";
import { EARTH, isBodyEffect, type Rule, type WorldPhysics } from "./types";

const oldestFirst = (a: Rule, b: Rule): number =>
  a.createdAt - b.createdAt || a.id.localeCompare(b.id);

const enact = (physics: WorldPhysics, { effect }: Rule): WorldPhysics => {
  if (isBodyEffect(effect)) return { ...physics, bodies: [...physics.bodies, lawOf(effect)] };
  return "value" in effect
    ? { ...physics, [effect.governs]: effect.value }
    : { ...physics, [effect.governs]: { x: effect.x, y: effect.y } };
};

export const foldOverEarth = (rules: readonly Rule[]): WorldPhysics =>
  rules
    .filter(({ effect }) => validEffect(effect))
    .toSorted(oldestFirst)
    .reduce(enact, EARTH);
