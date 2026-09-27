import type { Vec } from "../core/geometry";
import { INK, line, PAPER, round } from "./svg";

const LINE_WIDTH = 2.2;
const HEAD = { x: 0.5, y: -21.5, radius: 7.5 } as const;
const EYE = { x: 4, y: -22.5, radius: 1 } as const;
const HAIR = { start: { x: -5, y: -27 }, bend: { x: -12.5, y: -22 }, end: { x: -9, y: -9 } };
const HAIR_WEIGHT = 1.45;
const DRESS: readonly Vec[] = [
  { x: 0, y: -14 },
  { x: 11.5, y: 13 },
  { x: -11.5, y: 13 },
];
const SHOULDER = 11.5;
const HIP = { x: 3.5, y: 13 } as const;
const HAND = { x: 8, y: 3 } as const;
const TOE = 3.5;

export const ALICE_FOOT = { x: 4, y: 28.5 } as const;
export const ALICE_HEIGHT = ALICE_FOOT.y - (HEAD.y - HEAD.radius);
export const ALICE_HALF_WIDTH = 12.5;

const onHead = (turns: number): string =>
  `${round(HEAD.x + HEAD.radius * Math.cos(turns * Math.PI))} ${round(HEAD.y + HEAD.radius * Math.sin(turns * Math.PI))}`;

/** Alice as the game draws her, standing, facing right, feet on `ALICE_FOOT.y` of her own frame. */
export const aliceSvg = (at: Vec, scale: number, lineWidth = LINE_WIDTH): string => {
  const width = round(lineWidth);
  const stroke = `fill="none" stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
  const leg = (hip: Vec, foot: Vec): string => `${line(hip, foot)}l${TOE} 0`;
  const limbs = [
    line({ x: -3, y: -SHOULDER }, { x: -HAND.x, y: HAND.y }),
    leg({ x: -HIP.x, y: HIP.y }, { x: -ALICE_FOOT.x, y: ALICE_FOOT.y }),
    leg(HIP, ALICE_FOOT),
    `M${HAIR.start.x} ${HAIR.start.y}Q${HAIR.bend.x} ${HAIR.bend.y} ${HAIR.end.x} ${HAIR.end.y}`,
  ].join("");
  const dress = `${DRESS.map(({ x, y }, i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("")}Z`;
  const frontArm = line({ x: 3, y: -SHOULDER }, HAND);
  return (
    `<g transform="translate(${round(at.x)} ${round(at.y)}) scale(${scale})">` +
    `<path ${stroke} d="${limbs}"/>` +
    `<path fill="${PAPER}" stroke="${INK}" stroke-width="${width}" stroke-linejoin="round" d="${dress}"/>` +
    `<circle cx="${HEAD.x}" cy="${HEAD.y}" r="${HEAD.radius}" fill="${PAPER}" stroke="${INK}" stroke-width="${width}"/>` +
    `<circle cx="${EYE.x}" cy="${EYE.y}" r="${EYE.radius}" fill="${INK}"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="${round(lineWidth * HAIR_WEIGHT)}" d="M${onHead(1.1)}A${HEAD.radius} ${HEAD.radius} 0 0 1 ${onHead(1.75)}"/>` +
    `<path ${stroke} d="${frontArm}"/>` +
    "</g>"
  );
};
