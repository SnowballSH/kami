import type { Vec } from "../core/geometry";
import { INK, PAPER, round } from "./svg";

const TAU = Math.PI * 2;
const LOBES = 7;
const WOBBLE = 0.2;
const EYE = { x: 0.3, y: -0.12, radius: 0.27, pupil: 0.13 } as const;
const BLINK = { at: 0.72, span: 0.08 } as const;

/** How far the blot bobs over one breath, as a share of its radius. */
export const SUMIKUI_BOB = 0.12;
/** The farthest a lobe reaches from the centre, as a share of its radius. */
export const SUMIKUI_REACH = 1.12 * (1 + WOBBLE);

const polar = (angle: number, radius: number): Vec => ({
  x: Math.cos(angle) * radius,
  y: Math.sin(angle) * radius,
});

const blotPath = (radius: number, phase: number): string => {
  const lobe = (index: number): number =>
    radius * (1 + WOBBLE * Math.sin(phase * TAU + (index % LOBES) * 1.9));
  const start = polar(0, lobe(0));
  const parts = [`M${round(start.x)} ${round(start.y)}`];
  for (let index = 1; index <= LOBES; index++) {
    const angle = (index / LOBES) * TAU;
    const previous = ((index - 1) / LOBES) * TAU;
    const control = polar((angle + previous) / 2, ((lobe(index - 1) + lobe(index)) / 2) * 1.12);
    const point = polar(angle, lobe(index));
    parts.push(`Q${round(control.x)} ${round(control.y)} ${round(point.x)} ${round(point.y)}`);
  }
  parts.push("Z");
  return parts.join("");
};

const blinkSquint = (phase: number): number => {
  const distance = Math.abs(phase - BLINK.at);
  return distance >= BLINK.span ? 1 : Math.max(distance / BLINK.span, 0.1);
};

/** Where the blot sits `phase` (0..1) into a breath, bobbing about its perch. */
export const sumikuiBob = (perch: Vec, radius: number, phase: number): Vec => ({
  x: perch.x,
  y: perch.y + Math.sin(phase * TAU) * radius * SUMIKUI_BOB,
});

/** The Sumikui as the game draws it: a breathing blot of ink with one eye that watches Alice below. */
export const sumikuiSvg = (at: Vec, radius: number, phase = 0): string => {
  const eye = {
    x: EYE.x * radius,
    y: EYE.y * radius,
    radius: EYE.radius * radius,
    pupil: EYE.pupil * radius,
  };
  const squint = blinkSquint(phase);
  return (
    `<g transform="translate(${round(at.x)} ${round(at.y)})">` +
    `<path fill="${INK}" d="${blotPath(radius, phase)}"/>` +
    `<g transform="translate(${round(eye.x)} ${round(eye.y)}) scale(1 ${round(squint)})">` +
    `<circle r="${round(eye.radius)}" fill="${PAPER}"/>` +
    `<circle cx="${round(eye.radius * 0.2)}" cy="${round(eye.radius * 0.25)}" r="${round(eye.pupil)}" fill="${INK}"/>` +
    "</g></g>"
  );
};
