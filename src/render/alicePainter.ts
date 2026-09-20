import type { Vec } from "../core/geometry";
import { ALICE_BASE, type AliceSnapshot } from "../sim/types";
import { ALICE_POSES, type AlicePose, alicePoseName, BACK_HIP, FRONT_HIP } from "./alicePose";
import type { AliceFigure, Ghost } from "./animation/aliceFigure";
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
const TOE_LENGTH = 3.5;
const SOLES_Y = ALICE_BASE.height / 2;
/** A box round her whole figure, key included, that the ink-in reveal wipes down through. */
const INK_BOX = { x: -24, y: -42, width: 48, height: 76 } as const;
const KEY_HOLD: Vec = { x: 11, y: -7 };
const CARRIED_KEY = { length: 13, angle: -Math.PI / 2 } as const;
const RIBBON_HUE_STEP = 137;
const RIBBON_NUMBER = { y: -33, font: "bold 7px sans-serif" } as const;
const SELECTION_CARET = { y: -38, half: 4, height: 5 } as const;

/** How a twin is told apart from Alice herself and from each other: a coloured, numbered ribbon. */
export interface AliceLook {
  /** Her number among the twins (1 up); Alice herself wears no ribbon. */
  readonly ribbon: number | null;
  readonly selected: boolean;
}

export const HERSELF: AliceLook = { ribbon: null, selected: false };

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

const traceLeg = (ctx: CanvasRenderingContext2D, hip: Vec, knee: Vec, foot: Vec): void => {
  ctx.moveTo(hip.x, hip.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(foot.x, foot.y);
  ctx.lineTo(foot.x + TOE_LENGTH, foot.y);
};

const paintBehindDress = (ctx: CanvasRenderingContext2D, pose: AlicePose): void => {
  ctx.beginPath();
  traceLimb(ctx, BACK_SHOULDER, pose.backHand);
  traceLeg(ctx, BACK_HIP, pose.backKnee, pose.backFoot);
  traceLeg(ctx, FRONT_HIP, pose.frontKnee, pose.frontFoot);
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

const paintHead = (ctx: CanvasRenderingContext2D, look: AliceLook): void => {
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
  if (look.ribbon !== null) ctx.strokeStyle = ribbonColour(look.ribbon);
  ctx.stroke();
  ctx.strokeStyle = BOARD_COLORS.marker;
  ctx.lineWidth = LINE_WIDTH;
};

/** Her number and the caret over whoever the player steers, drawn upright whichever way she faces. */
const paintLook = (ctx: CanvasRenderingContext2D, facing: number, look: AliceLook): void => {
  if (look.ribbon === null && !look.selected) return;
  ctx.save();
  ctx.scale(1 / facing, 1);
  if (look.ribbon !== null) {
    ctx.fillStyle = ribbonColour(look.ribbon);
    ctx.font = RIBBON_NUMBER.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(look.ribbon + 1), HEAD.x, RIBBON_NUMBER.y);
  }
  if (look.selected) {
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

const paintBody = (
  ctx: CanvasRenderingContext2D,
  pose: AlicePose,
  hasKey: boolean,
  keyScale: number,
  look: AliceLook,
): void => {
  const frontHand = hasKey ? KEY_HOLD : pose.frontHand;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = BOARD_COLORS.marker;
  paintBehindDress(ctx, pose);
  paintDress(ctx);
  paintHead(ctx, look);
  paintFrontArm(ctx, frontHand);
  if (hasKey && keyScale > 0)
    paintKey(ctx, frontHand, CARRIED_KEY.length * keyScale, CARRIED_KEY.angle);
};

/** Into her base box: origin at her middle, x flipped to face the way she does. */
const enterBody = (
  ctx: CanvasRenderingContext2D,
  center: Vec,
  width: number,
  height: number,
  facing: number,
): void => {
  ctx.translate(center.x, center.y);
  ctx.scale((facing * width) / ALICE_BASE.width, height / ALICE_BASE.height);
};

/** Squashes, stretches and tilts about her soles, so her feet stay where the ground is. */
const deformAboutSoles = (
  ctx: CanvasRenderingContext2D,
  stretch: Vec,
  lean: number,
  facing: number,
): void => {
  ctx.translate(0, SOLES_Y);
  ctx.rotate(lean * Math.sign(facing));
  ctx.scale(stretch.x, stretch.y);
  ctx.translate(0, -SOLES_Y);
};

const clipInked = (ctx: CanvasRenderingContext2D, inked: number): void => {
  ctx.beginPath();
  ctx.rect(INK_BOX.x, INK_BOX.y, INK_BOX.width, INK_BOX.height * inked);
  ctx.clip();
};

const paintGhost = (ctx: CanvasRenderingContext2D, ghost: Ghost, pose: AlicePose): void => {
  ctx.save();
  ctx.globalAlpha *= ghost.alpha;
  enterBody(ctx, ghost.center, ghost.width, ghost.height, ghost.facing);
  ctx.translate(0, -SOLES_Y);
  ctx.scale(1, 1 + ghost.drip);
  ctx.translate(0, SOLES_Y);
  paintBody(ctx, pose, false, 1, HERSELF);
  ctx.restore();
};

/** Paints her as the animation layer says she looks this frame, ghost of where she was and all. */
export const paintAliceFigure = (
  ctx: CanvasRenderingContext2D,
  alice: AliceSnapshot,
  figure: AliceFigure,
  look: AliceLook = HERSELF,
): void => {
  if (figure.ghost !== null) paintGhost(ctx, figure.ghost, figure.pose);
  ctx.save();
  ctx.globalAlpha *= figure.alpha;
  ctx.translate(figure.offset.x, figure.offset.y);
  enterBody(ctx, alice.center, alice.width, alice.height, figure.facing);
  if (figure.inked < 1) clipInked(ctx, figure.inked);
  deformAboutSoles(ctx, figure.stretch, figure.lean, figure.facing);
  paintBody(ctx, figure.pose, alice.hasKey, figure.keyScale, look);
  paintLook(ctx, figure.facing, look);
  ctx.restore();
};

/** Paints her still, straight from the snapshot, with no beats playing. */
export const paintAlice = (
  ctx: CanvasRenderingContext2D,
  alice: AliceSnapshot,
  nowMs: number,
  look: AliceLook = HERSELF,
): void => {
  ctx.save();
  enterBody(ctx, alice.center, alice.width, alice.height, alice.facing);
  paintBody(ctx, ALICE_POSES[alicePoseName(alice, nowMs)], alice.hasKey, 1, look);
  paintLook(ctx, alice.facing, look);
  ctx.restore();
};
