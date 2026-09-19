import { deflateSync } from "node:zlib";
import { boundsOf, type Stroke } from "../../src/core/geometry";

const TARGET_LINE_HEIGHT_PX = 64;
const MAX_WIDTH_PX = 1024;
const MIN_SIDE_PX = 32;
const MARGIN_PX = 16;
const PEN_RADIUS_PX = 2;

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const GRAYSCALE_8_BIT = Uint8Array.of(8, 0, 0, 0, 0);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (...parts: readonly Uint8Array[]): number => {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const uint32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0);
  return bytes;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const name = new TextEncoder().encode(type);
  return Uint8Array.from([...uint32(data.length), ...name, ...data, ...uint32(crc32(name, data))]);
};

/** An 8-bit grayscale canvas, white paper, y-down. */
export class GrayCanvas {
  readonly pixels: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint8Array(width * height).fill(255);
  }

  dot(cx: number, cy: number, radius: number): void {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
        if (Math.hypot(x - cx, y - cy) <= radius) this.pixels[y * this.width + x] = 0;
      }
    }
  }

  line(ax: number, ay: number, bx: number, by: number, radius: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      this.dot(ax + (bx - ax) * t, ay + (by - ay) * t, radius);
    }
  }

  toPng(): Uint8Array {
    const header = Uint8Array.from([
      ...uint32(this.width),
      ...uint32(this.height),
      ...GRAYSCALE_8_BIT,
    ]);
    const filtered = new Uint8Array((this.width + 1) * this.height);
    for (let y = 0; y < this.height; y += 1) {
      filtered.set(
        this.pixels.subarray(y * this.width, (y + 1) * this.width),
        y * (this.width + 1) + 1,
      );
    }
    return Uint8Array.from([
      ...PNG_SIGNATURE,
      ...chunk("IHDR", header),
      ...chunk("IDAT", new Uint8Array(deflateSync(filtered))),
      ...chunk("IEND", new Uint8Array(0)),
    ]);
  }
}

/**
 * Draws the strokes as black pen on white paper, fitted so a line of writing is about
 * `TARGET_LINE_HEIGHT_PX` tall: what a vision model reads most reliably, and a small image.
 */
export const renderStrokes = (strokes: readonly Stroke[]): GrayCanvas => {
  const points = strokes.flat();
  if (points.length === 0) return new GrayCanvas(MIN_SIDE_PX, MIN_SIDE_PX);
  const bounds = boundsOf(points);
  const scale = Math.min(
    TARGET_LINE_HEIGHT_PX / Math.max(bounds.height, 1),
    (MAX_WIDTH_PX - MARGIN_PX * 2) / Math.max(bounds.width, 1),
  );
  const width = Math.min(
    MAX_WIDTH_PX,
    Math.max(MIN_SIDE_PX, Math.ceil(bounds.width * scale) + MARGIN_PX * 2),
  );
  const height = Math.max(MIN_SIDE_PX, Math.ceil(bounds.height * scale) + MARGIN_PX * 2);
  const canvas = new GrayCanvas(width, height);
  const toX = (x: number): number => (x - bounds.x) * scale + MARGIN_PX;
  const toY = (y: number): number => (y - bounds.y) * scale + MARGIN_PX;
  for (const stroke of strokes) {
    const [first, ...rest] = stroke;
    if (first === undefined) continue;
    canvas.dot(toX(first.x), toY(first.y), PEN_RADIUS_PX);
    let previous = first;
    for (const point of rest) {
      canvas.line(toX(previous.x), toY(previous.y), toX(point.x), toY(point.y), PEN_RADIUS_PX);
      previous = point;
    }
  }
  return canvas;
};

export const strokesToPngDataUrl = (strokes: readonly Stroke[]): string =>
  `data:image/png;base64,${Buffer.from(renderStrokes(strokes).toPng()).toString("base64")}`;
