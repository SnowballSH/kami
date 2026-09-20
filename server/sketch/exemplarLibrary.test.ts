// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExemplarLibrary } from "./exemplarLibrary";
import { parseNpy } from "./npy";

const npyBytes = (
  descriptor: string,
  shape: readonly number[],
  data: ArrayBufferView,
): Uint8Array => {
  const shapeText = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(", ")})`;
  let header = `{'descr': '${descriptor}', 'fortran_order': False, 'shape': ${shapeText}, }`;
  while ((10 + header.length + 1) % 64 !== 0) header += " ";
  header += "\n";
  const bytes = new Uint8Array(10 + header.length + data.byteLength);
  bytes.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, header.length & 0xff, header.length >> 8]);
  bytes.set(new TextEncoder().encode(header), 10);
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), 10 + header.length);
  return bytes;
};

/** Three categories; "moon" has no exemplars at all, "rabbit" two, "tree" one. Points are (x, y). */
const writeSet = async (directory: string): Promise<void> => {
  const labels = Int32Array.from([0, 0, 2]);
  const drawingOffsets = Uint32Array.from([0, 2, 3, 4]);
  const strokeOffsets = Uint32Array.from([0, 2, 4, 6, 9]);
  const points = Uint8Array.from([
    ...[1, 2, 3, 4],
    ...[5, 6, 7, 8],
    ...[9, 10, 11, 12],
    ...[20, 21, 22, 23, 24, 25],
  ]);
  await Promise.all([
    writeFile(join(directory, "labels.npy"), npyBytes("<i4", [3], labels)),
    writeFile(join(directory, "drawing_offsets.npy"), npyBytes("<u4", [4], drawingOffsets)),
    writeFile(join(directory, "stroke_offsets.npy"), npyBytes("<u4", [5], strokeOffsets)),
    writeFile(join(directory, "points.npy"), npyBytes("|u1", [9, 2], points)),
    writeFile(
      join(directory, "meta.json"),
      JSON.stringify({ version: 1, count: 3, categories: ["rabbit", "moon", "tree"] }),
    ),
  ]);
};

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "kami-exemplars-"));
  await writeSet(directory);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("parseNpy", () => {
  it("reads the integer arrays an exemplar set is made of", () => {
    const parsed = parseNpy(npyBytes("<u4", [3], Uint32Array.from([7, 8, 9])));
    expect(parsed.shape).toEqual([3]);
    expect([...parsed.data]).toEqual([7, 8, 9]);
    const grid = parseNpy(npyBytes("|u1", [2, 2], Uint8Array.from([1, 2, 3, 4])));
    expect(grid.shape).toEqual([2, 2]);
    expect(grid.data).toBeInstanceOf(Uint8Array);
  });

  it("refuses what it does not understand", () => {
    expect(() => parseNpy(new Uint8Array([1, 2, 3]))).toThrow("not a .npy file");
    expect(() => parseNpy(npyBytes("<f4", [1], Float32Array.from([1])))).toThrow("dtype");
  });
});

describe("ExemplarLibrary", () => {
  it("hands out a category's drawings, best first, as strokes of points", async () => {
    const library = await ExemplarLibrary.load(directory, () => 0);
    expect(library.size).toBe(3);
    expect(library.categories).toEqual(["rabbit", "moon", "tree"]);
    expect(await library.pick("rabbit")).toEqual({
      category: "rabbit",
      strokes: [
        [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        [
          { x: 5, y: 6 },
          { x: 7, y: 8 },
        ],
      ],
    });
    expect(await library.pick("tree")).toEqual({
      category: "tree",
      strokes: [
        [
          { x: 20, y: 21 },
          { x: 22, y: 23 },
          { x: 24, y: 25 },
        ],
      ],
    });
  });

  it("varies which of the best it picks, and has nothing for an empty or unknown category", async () => {
    const library = await ExemplarLibrary.load(directory, () => 0.99);
    expect((await library.pick("rabbit"))?.strokes).toEqual([
      [
        { x: 9, y: 10 },
        { x: 11, y: 12 },
      ],
    ]);
    expect(await library.pick("moon")).toBeNull();
    expect(await library.pick("unicorn")).toBeNull();
  });

  it("refuses a set whose files disagree with its meta", async () => {
    const broken = await mkdtemp(join(tmpdir(), "kami-exemplars-broken-"));
    await writeSet(broken);
    await writeFile(
      join(broken, "meta.json"),
      JSON.stringify({ version: 1, count: 4, categories: ["rabbit", "moon", "tree"] }),
    );
    await expect(ExemplarLibrary.load(broken)).rejects.toThrow("does not hold 4 drawings");
    await rm(broken, { recursive: true, force: true });
  });
});
