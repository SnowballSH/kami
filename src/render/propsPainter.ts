import type { Rect, Vec } from "../core/geometry";
import type { LevelDefinition } from "../game/types";
import type { WorldSnapshot } from "../sim/types";
import { TAU } from "./canvas2d";
import { paintKey } from "./keyShape";
import { PAGE_COLORS, PROP_COLORS, rgbCss } from "./palette";

const KEY = { length: 38, angle: -Math.PI / 5, bobPx: 2.5, bobRadiansPerMs: 0.003 } as const;
const GLOW = { radius: 46, minAlpha: 0.45, maxAlpha: 0.9, pulseRadiansPerMs: 0.004 } as const;
const DOOR = { outline: 2, panelInset: 5, archRatio: 0.35 } as const;
const KEYHOLE = { radius: 2.6, skirt: 6, heightRatio: 0.55 } as const;

export class PropsPainter {
  private keyGlow: CanvasGradient | null = null;

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  setLevel(level: LevelDefinition): void {
    this.keyGlow = level.key === undefined ? null : this.glowAround(level.key);
  }

  paint(level: LevelDefinition, world: WorldSnapshot, nowMs: number): void {
    if (level.door !== undefined && !world.doorOpen) this.paintDoor(level.door);
    if (level.key !== undefined && !world.keyTaken) this.paintWaitingKey(level.key, nowMs);
  }

  private glowAround(center: Vec): CanvasGradient {
    const glow = this.ctx.createRadialGradient(
      center.x,
      center.y,
      0,
      center.x,
      center.y,
      GLOW.radius,
    );
    glow.addColorStop(0, rgbCss(PROP_COLORS.keyGlow, 0.85));
    glow.addColorStop(1, rgbCss(PROP_COLORS.keyGlow, 0));
    return glow;
  }

  private paintWaitingKey(center: Vec, nowMs: number): void {
    const { ctx } = this;
    if (this.keyGlow !== null) {
      const pulse = (Math.sin(nowMs * GLOW.pulseRadiansPerMs) + 1) / 2;
      ctx.save();
      ctx.globalAlpha = GLOW.minAlpha + (GLOW.maxAlpha - GLOW.minAlpha) * pulse;
      ctx.fillStyle = this.keyGlow;
      ctx.beginPath();
      ctx.arc(center.x, center.y, GLOW.radius, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    const bob = Math.sin(nowMs * KEY.bobRadiansPerMs) * KEY.bobPx;
    paintKey(ctx, { x: center.x, y: center.y + bob }, KEY.length, KEY.angle);
  }

  private paintDoor(door: Rect): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.fillStyle = PROP_COLORS.doorWood;
    ctx.strokeStyle = PAGE_COLORS.printInk;
    ctx.lineWidth = DOOR.outline;
    ctx.fillRect(door.x, door.y, door.width, door.height);
    ctx.strokeRect(door.x, door.y, door.width, door.height);
    this.paintDoorPanel(door);
    this.paintKeyhole(door);
    ctx.restore();
  }

  private paintDoorPanel(door: Rect): void {
    const { ctx } = this;
    const left = door.x + DOOR.panelInset;
    const right = door.x + door.width - DOOR.panelInset;
    const bottom = door.y + door.height - DOOR.panelInset;
    const shoulder = door.y + door.height * DOOR.archRatio;
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(left, shoulder);
    ctx.quadraticCurveTo((left + right) / 2, door.y - DOOR.panelInset, right, shoulder);
    ctx.lineTo(right, bottom);
    ctx.closePath();
    ctx.strokeStyle = PROP_COLORS.doorPanel;
    ctx.lineWidth = DOOR.outline / 2;
    ctx.stroke();
  }

  private paintKeyhole(door: Rect): void {
    const { ctx } = this;
    const x = door.x + door.width / 2;
    const y = door.y + door.height * KEYHOLE.heightRatio;
    ctx.fillStyle = PAGE_COLORS.printInk;
    ctx.beginPath();
    ctx.arc(x, y, KEYHOLE.radius, 0, TAU);
    ctx.moveTo(x, y);
    ctx.lineTo(x + KEYHOLE.radius, y + KEYHOLE.skirt);
    ctx.lineTo(x - KEYHOLE.radius, y + KEYHOLE.skirt);
    ctx.closePath();
    ctx.fill();
  }
}
