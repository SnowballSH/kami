import Matter from "matter-js";
import type { Vec } from "../core/geometry";
import { MAX_WALKABLE_SLOPE_DEG } from "./constants";

export const CATEGORY = { world: 0x0001, alice: 0x0002, ink: 0x0004 } as const;

/** Bodies sharing a negative group never collide: Alice and her twins walk through one another. */
export const ALICE_GROUP = -1;

const EVERYTHING = 0xffffffff;

export const SOLID_TO_ALL: Matter.ICollisionFilter = {
  group: 0,
  category: CATEGORY.ink,
  mask: EVERYTHING,
};

export const GHOST_TO_ALICE: Matter.ICollisionFilter = {
  group: 0,
  category: CATEGORY.ink,
  mask: EVERYTHING & ~CATEGORY.alice,
};

/** `normal` is a unit vector pointing from the touched body towards `subject`. */
export interface Contact {
  readonly body: Matter.Body;
  readonly normal: Vec;
}

const SLOPE_LIMIT = (MAX_WALKABLE_SLOPE_DEG * Math.PI) / 180;
const WALKABLE_NORMAL_Y = -Math.cos(SLOPE_LIMIT);
const WALL_NORMAL_X = Math.sin(SLOPE_LIMIT);

export const supports = (contact: Contact): boolean => contact.normal.y <= WALKABLE_NORMAL_Y;

export const blocks = (contact: Contact, direction: number): boolean =>
  contact.normal.x * direction < -WALL_NORMAL_X;

export const toContact = (subject: Matter.Body, collision: Matter.Collision): Contact => {
  const body = collision.parentA === subject ? collision.parentB : collision.parentA;
  const { normal } = collision;
  const anchor = collision.supports[0] ?? body.position;
  const facesSubject =
    normal.x * (subject.position.x - anchor.x) + normal.y * (subject.position.y - anchor.y) >= 0;
  return {
    body,
    normal: facesSubject ? { x: normal.x, y: normal.y } : { x: -normal.x, y: -normal.y },
  };
};

const collidingParts = (body: Matter.Body): readonly Matter.Body[] =>
  body.parts.length > 1 ? body.parts.slice(1) : [body];

/** Unlike `Matter.Query.collides`, reports every touching part of a compound, not just the first. */
export const contactsWith = (
  subject: Matter.Body,
  others: readonly Matter.Body[],
  exclude?: Matter.Body,
): readonly Contact[] =>
  others
    .filter((other) => other !== exclude && Matter.Bounds.overlaps(other.bounds, subject.bounds))
    .flatMap(collidingParts)
    .filter((part) => Matter.Bounds.overlaps(part.bounds, subject.bounds))
    .flatMap((part) => Matter.Collision.collides(part, subject) ?? [])
    .map((collision) => toContact(subject, collision));

export const contactsAt = (
  subject: Matter.Body,
  offset: Vec,
  others: readonly Matter.Body[],
  exclude?: Matter.Body,
): readonly Contact[] => {
  Matter.Body.translate(subject, offset);
  const contacts = contactsWith(subject, others, exclude);
  Matter.Body.translate(subject, { x: -offset.x, y: -offset.y });
  return contacts;
};

export const isFreeAt = (
  subject: Matter.Body,
  offset: Vec,
  others: readonly Matter.Body[],
): boolean => contactsAt(subject, offset, others).length === 0;
