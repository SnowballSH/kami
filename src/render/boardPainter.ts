import type { Drawable, OpSet } from "roughjs/bin/core";
import type { BoardDefinition } from "../board/types";
import type { Rect, Vec } from "../core/geometry";
import type { WorldSnapshot } from "../sim/types";
import { type ArtPiece, composeBoardArt } from "./boardArt";
import { TAU } from "./canvas2d";
import { rectInView } from "./culling";
import { keyBounds, paintKey } from "./keyShape";
import { BOARD_COLORS } from "./palette";

interface ArtLayer {
  readonly path: Path2D;
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly lineWidth: number;
}

interface CachedPiece {
  readonly bounds: Rect;
  readonly layers: readonly ArtLayer[];
}

interface Props {
  readonly door: { readonly piece: CachedPiece; readonly rect: Rect } | null;
  readonly key: { readonly center: Vec; readonly bounds: Rect } | null;
}

const NO_PAINT = "none";
const WAITING_KEY = { length: 38, angle: -Math.PI / 5 } as const;
const KEYHOLE = { radiusRatio: 0.09, skirtRatio: 0.22, heightRatio: 0.5 } as const;

const tracePath = (set: OpSet): Path2D => {
  const path = new Path2D();
  for (const { op, data } of set.ops) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = data;
    if (op === "move") path.moveTo(a, b);
    else if (op === "lineTo") path.lineTo(a, b);
    else path.bezierCurveTo(a, b, c, d, e, f);
  }
  return path;
};

const paintOrNull = (paint: string | undefined): string | null =>
  paint === undefined || paint === NO_PAINT ? null : paint;

const layerOf = (set: OpSet, { options }: Drawable): ArtLayer => {
  const path = tracePath(set);
  if (set.type === "fillPath") {
    return { path, fill: paintOrNull(options.fill), stroke: null, lineWidth: 0 };
  }
  return set.type === "fillSketch"
    ? { path, fill: null, stroke: paintOrNull(options.fill), lineWidth: options.fillWeight }
    : { path, fill: null, stroke: paintOrNull(options.stroke), lineWidth: options.strokeWidth };
};

const cachePiece = ({ bounds, drawable }: ArtPiece): CachedPiece => ({
  bounds,
  layers: drawable.sets.map((set) => layerOf(set, drawable)),
});

const paintPiece = (ctx: CanvasRenderingContext2D, piece: CachedPiece): void => {
  for (const layer of piece.layers) {
    if (layer.fill !== null) {
      ctx.fillStyle = layer.fill;
      ctx.fill(layer.path);
    }
    if (layer.stroke !== null) {
      ctx.strokeStyle = layer.stroke;
      ctx.lineWidth = layer.lineWidth;
      ctx.stroke(layer.path);
    }
  }
};

const paintKeyhole = (ctx: CanvasRenderingContext2D, door: Rect): void => {
  const x = door.x + door.width / 2;
  const y = door.y + door.height * KEYHOLE.heightRatio;
  const radius = door.height * KEYHOLE.radiusRatio;
  const skirt = door.height * KEYHOLE.skirtRatio;
  ctx.fillStyle = BOARD_COLORS.marker;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.moveTo(x, y);
  ctx.lineTo(x + radius, y + skirt);
  ctx.lineTo(x - radius, y + skirt);
  ctx.closePath();
  ctx.fill();
};

export class BoardPainter {
  private scenery: readonly CachedPiece[] = [];
  private props: Props = { door: null, key: null };

  setBoard(board: BoardDefinition): void {
    const art = composeBoardArt(board);
    this.scenery = art.scenery.map(cachePiece);
    this.props = {
      door:
        art.door === null || board.door === undefined
          ? null
          : { piece: cachePiece(art.door), rect: board.door },
      key:
        board.key === undefined
          ? null
          : { center: board.key, bounds: keyBounds(board.key, WAITING_KEY.length) },
    };
  }

  paint(ctx: CanvasRenderingContext2D, view: Rect, world: WorldSnapshot): void {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const piece of this.scenery) {
      if (rectInView(piece.bounds, view, 0)) paintPiece(ctx, piece);
    }
    const { door, key } = this.props;
    if (door !== null && !world.doorOpen && rectInView(door.piece.bounds, view, 0)) {
      paintPiece(ctx, door.piece);
      paintKeyhole(ctx, door.rect);
    }
    if (key !== null && !world.keyTaken && rectInView(key.bounds, view, 0)) {
      paintKey(ctx, key.center, WAITING_KEY.length, WAITING_KEY.angle);
    }
  }
}
