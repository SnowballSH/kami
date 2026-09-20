import type { Vec } from "../core/geometry";
import { ALICE_BASE, type AliceSnapshot } from "../sim/types";
import { ALICE_POSES, type AlicePose, alicePoseName } from "./alicePose";
import { TAU } from "./canvas2d";
import { paintKey } from "./keyShape";
import { BOARD_COLORS } from "./palette";

const LINE_WIDTH = 2.2;
const HEAD = { x: 0.5, y: -21.5, radius: 7.5 } as const;
const EYE = { x: 4, y: -22.5, radius: 1 } as const;
const HAIR_BAND = { from: 1.1 * Math.PI, to: 1.75 * Math.PI, width: 3.2 } as const;
const HAIR = {
  start: { x: -5, y: -27 },
  bend: { x: -12.5, y: -22 },
  end: { x: -9, y: -9 },
} as const;
const FRONT_SHOULDER: Vec = { x: 3, y: -11.5 };
const BACK_SHOULDER: Vec = { x: -3, y: -11.5 };
const FRONT_HIP: Vec = { x: 3.5, y: 13 };
const BACK_HIP: Vec = { x: -3.5, y: 13 };
const TOE_LENGTH = 3.5;
const KEY_HOLD: Vec = { x: 11, y: -7 };
const CARRIED_KEY = { length: 13, angle: -Math.PI / 2 } as const;
const RIBBON_HUE_STEP = 137;
const RIBBON_NUMBER = { y: -33, font: "bold 7px sans-serif" } as const;
const SELECTION_CARET = { y: -38, half: 4, height: 5 } as const;

/** How a twin is told apart from Alice herself and from each other: a coloured, numbered ribbon. */
export interface AliceBadge {
  /** Her number among the twins (1 up); Alice herself wears no ribbon. */
  readonly ribbon: number | null;
  readonly selected: boolean;
}

export const HERSELF: AliceBadge = { ribbon: null, selected: false };

export const ribbonColour = (ribbon: number): string =>
  `hsl(${(ribbon * RIBBON_HUE_STEP) % 360} 65% 45%)`;

const DRESS: readonly Vec[] = [
  { x: 0, y: -14 },
  { x: 11.5, y: 13 },
  { x: -11.5, y: 13 },
];

const traceLimb = (ctx: CanvasRenderingContext2D, from: Vec, to: Vec): void => {
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
};

const traceLeg = (ctx: CanvasRenderingContext2D, hip: Vec, foot: Vec): void => {
  traceLimb(ctx, hip, foot);
  ctx.lineTo(foot.x + TOE_LENGTH, foot.y);
};

const paintBehindDress = (ctx: CanvasRenderingContext2D, pose: AlicePose): void => {
  ctx.beginPath();
  traceLimb(ctx, BACK_SHOULDER, pose.backHand);
  traceLeg(ctx, BACK_HIP, pose.backFoot);
  traceLeg(ctx, FRONT_HIP, pose.frontFoot);
  ctx.moveTo(HAIR.start.x, HAIR.start.y);
  ctx.quadraticCurveTo(HAIR.bend.x, HAIR.bend.y, HAIR.end.x, HAIR.end.y);
  ctx.stroke();
};

const paintFrontArm = (ctx: CanvasRenderingContext2D, frontHand: Vec): void => {
  ctx.beginPath();
  traceLimb(ctx, FRONT_SHOULDER, frontHand);
  ctx.stroke();
};

const paintDress = (ctx: CanvasRenderingContext2D): void => {
  ctx.beginPath();
  for (const corner of DRESS) ctx.lineTo(corner.x, corner.y);
  ctx.closePath();
  ctx.fillStyle = BOARD_COLORS.board;
  ctx.fill();
  ctx.stroke();
};

const paintHead = (ctx: CanvasRenderingContext2D, badge: AliceBadge): void => {
  ctx.beginPath();
  ctx.arc(HEAD.x, HEAD.y, HEAD.radius, 0, TAU);
  ctx.fillStyle = BOARD_COLORS.board;
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(EYE.x, EYE.y, EYE.radius, 0, TAU);
  ctx.fillStyle = BOARD_COLORS.marker;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(HEAD.x, HEAD.y, HEAD.radius, HAIR_BAND.from, HAIR_BAND.to);
  ctx.lineWidth = HAIR_BAND.width;
  if (badge.ribbon !== null) ctx.strokeStyle = ribbonColour(badge.ribbon);
  ctx.stroke();
  ctx.strokeStyle = BOARD_COLORS.marker;
  ctx.lineWidth = LINE_WIDTH;
};

/** Her number and the caret over whoever the player steers, drawn upright whichever way she faces. */
export const paintBadge = (
  ctx: CanvasRenderingContext2D,
  facing: number,
  badge: AliceBadge,
): void => {
  if (badge.ribbon === null && !badge.selected) return;
  ctx.save();
  ctx.scale(facing, 1);
  if (badge.ribbon !== null) {
    ctx.fillStyle = ribbonColour(badge.ribbon);
    ctx.font = RIBBON_NUMBER.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(badge.ribbon + 1), HEAD.x, RIBBON_NUMBER.y);
  }
  if (badge.selected) {
    const { y, half, height } = SELECTION_CARET;
    ctx.beginPath();
    ctx.moveTo(HEAD.x - half, y - height);
    ctx.lineTo(HEAD.x + half, y - height);
    ctx.lineTo(HEAD.x, y);
    ctx.closePath();
    ctx.fillStyle = BOARD_COLORS.marker;
    ctx.fill();
  }
  ctx.restore();
};

export const paintAlice = (
  ctx: CanvasRenderingContext2D,
  alice: AliceSnapshot,
  nowMs: number,
  badge: AliceBadge = HERSELF,
): void => {
  const pose = ALICE_POSES[alicePoseName(alice, nowMs)];
  const frontHand = alice.hasKey ? KEY_HOLD : pose.frontHand;
  ctx.save();
  ctx.translate(alice.center.x, alice.center.y);
  ctx.scale((alice.facing * alice.width) / ALICE_BASE.width, alice.height / ALICE_BASE.height);
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = BOARD_COLORS.marker;
  paintBehindDress(ctx, pose);
  paintDress(ctx);
  paintHead(ctx, badge);
  paintFrontArm(ctx, frontHand);
  if (alice.hasKey) paintKey(ctx, frontHand, CARRIED_KEY.length, CARRIED_KEY.angle);
  paintBadge(ctx, alice.facing, badge);
  ctx.restore();
};
