import type { Vec } from "../core/geometry";
import { ALICE_BASE, type AliceSnapshot } from "../sim/types";
import { ALICE_POSES, type AlicePose, alicePoseName } from "./alicePose";
import { TAU, tracePolygon } from "./canvas2d";
import { paintKey } from "./keyShape";
import { ALICE_COLORS, PAGE_COLORS } from "./palette";

const LINE_WIDTH = 1.7;
const HEAD = { x: 0.5, y: -21.5, radius: 7.5 } as const;
const EYE = { x: 4, y: -22.5, radius: 0.9 } as const;
const SMILE = { x: 3.2, y: -19.5, radius: 2.2, from: 0.15 * Math.PI, to: 0.75 * Math.PI } as const;
const HAIR_BAND = { from: 1.1 * Math.PI, to: 1.72 * Math.PI, width: 2.4 } as const;
const FRONT_SHOULDER: Vec = { x: 3, y: -11.5 };
const BACK_SHOULDER: Vec = { x: -3, y: -11.5 };
const FRONT_HIP: Vec = { x: 3.5, y: 12 };
const BACK_HIP: Vec = { x: -3.5, y: 12 };
const SHOE = { radiusX: 2.6, radiusY: 1.5, toe: 1.2 } as const;
const KEY_HOLD: Vec = { x: 11, y: -7 };
const CARRIED_KEY = { length: 13, angle: -Math.PI / 2 } as const;
const FACING_EYES: readonly Vec[] = [
  { x: -2.6, y: -22.5 },
  { x: 3.6, y: -22.5 },
];
const FACING_SMILE = {
  x: 0.5,
  y: -19.5,
  radius: 2.4,
  from: 0.2 * Math.PI,
  to: 0.8 * Math.PI,
} as const;
const THOUGHT_DOTS = { y: -37, spacing: 4.5, radius: 1.1, periodMs: 1800 } as const;

const DRESS: readonly Vec[] = [
  { x: -3.5, y: -13.5 },
  { x: 3.5, y: -13.5 },
  { x: 11.5, y: 13 },
  { x: -11.5, y: 13 },
];

const APRON: readonly Vec[] = [
  { x: -1, y: -10 },
  { x: 3, y: -10 },
  { x: 7.5, y: 11 },
  { x: -3, y: 11 },
];

const paintLimb = (ctx: CanvasRenderingContext2D, from: Vec, to: Vec): void => {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
};

const paintLeg = (ctx: CanvasRenderingContext2D, hip: Vec, foot: Vec): void => {
  paintLimb(ctx, hip, foot);
  ctx.beginPath();
  ctx.ellipse(foot.x + SHOE.toe, foot.y, SHOE.radiusX, SHOE.radiusY, 0, 0, TAU);
  ctx.fillStyle = PAGE_COLORS.printInk;
  ctx.fill();
};

const paintShape = (ctx: CanvasRenderingContext2D, points: readonly Vec[], fill: string): void => {
  tracePolygon(ctx, points);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
};

const paintHair = (ctx: CanvasRenderingContext2D): void => {
  ctx.beginPath();
  ctx.moveTo(HEAD.x + 3, HEAD.y - HEAD.radius - 0.5);
  ctx.quadraticCurveTo(-11, -30, -10.5, -17);
  ctx.quadraticCurveTo(-10, -8, -12, -3);
  ctx.quadraticCurveTo(-6, -4, -3, -10);
  ctx.closePath();
  ctx.fillStyle = ALICE_COLORS.hair;
  ctx.fill();
  ctx.stroke();
};

const paintFace = (ctx: CanvasRenderingContext2D, towardPlayer: boolean): void => {
  const eyes = towardPlayer ? FACING_EYES : [EYE];
  ctx.fillStyle = PAGE_COLORS.printInk;
  for (const eye of eyes) {
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, EYE.radius, 0, TAU);
    ctx.fill();
  }
  const smile = towardPlayer ? FACING_SMILE : SMILE;
  ctx.beginPath();
  ctx.arc(smile.x, smile.y, smile.radius, smile.from, smile.to);
  ctx.stroke();
};

const paintThoughtDots = (ctx: CanvasRenderingContext2D, nowMs: number): void => {
  const phase = (nowMs % THOUGHT_DOTS.periodMs) / THOUGHT_DOTS.periodMs;
  const lit = Math.floor(phase * 4);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc((i - 1) * THOUGHT_DOTS.spacing, THOUGHT_DOTS.y, THOUGHT_DOTS.radius, 0, TAU);
    ctx.fillStyle = i < lit ? PAGE_COLORS.printInk : ALICE_COLORS.apron;
    ctx.fill();
    ctx.stroke();
  }
};

const paintHead = (ctx: CanvasRenderingContext2D, towardPlayer: boolean): void => {
  ctx.beginPath();
  ctx.arc(HEAD.x, HEAD.y, HEAD.radius, 0, TAU);
  ctx.fillStyle = ALICE_COLORS.skin;
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.lineWidth = LINE_WIDTH / 2;
  paintFace(ctx, towardPlayer);
  ctx.lineWidth = HAIR_BAND.width;
  ctx.beginPath();
  ctx.arc(HEAD.x, HEAD.y, HEAD.radius, HAIR_BAND.from, HAIR_BAND.to);
  ctx.stroke();
  ctx.restore();
};

const paintBody = (
  ctx: CanvasRenderingContext2D,
  pose: AlicePose,
  frontHand: Vec,
  towardPlayer: boolean,
): void => {
  paintLimb(ctx, BACK_SHOULDER, pose.backHand);
  paintLeg(ctx, BACK_HIP, pose.backFoot);
  paintHair(ctx);
  paintLeg(ctx, FRONT_HIP, pose.frontFoot);
  paintShape(ctx, DRESS, ALICE_COLORS.dress);
  paintShape(ctx, APRON, ALICE_COLORS.apron);
  paintHead(ctx, towardPlayer);
  paintLimb(ctx, FRONT_SHOULDER, frontHand);
};

export const paintAlice = (
  ctx: CanvasRenderingContext2D,
  alice: AliceSnapshot,
  nowMs: number,
  waiting = false,
): void => {
  const poseName = alicePoseName(alice, nowMs, waiting);
  const pose = ALICE_POSES[poseName];
  const towardPlayer = poseName === "wait";
  const frontHand = alice.hasKey ? KEY_HOLD : pose.frontHand;
  ctx.save();
  ctx.translate(alice.center.x, alice.center.y);
  ctx.scale((alice.facing * alice.width) / ALICE_BASE.width, alice.height / ALICE_BASE.height);
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = PAGE_COLORS.printInk;
  paintBody(ctx, pose, frontHand, towardPlayer);
  if (alice.hasKey) paintKey(ctx, frontHand, CARRIED_KEY.length, CARRIED_KEY.angle);
  if (towardPlayer) paintThoughtDots(ctx, nowMs);
  ctx.restore();
};
