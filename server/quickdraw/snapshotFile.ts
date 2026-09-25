import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { type SimplifiedStroke, simplifiedStrokeSchema } from "./dataset";

export interface StoredSketch {
  readonly category: string;
  readonly keyId: string;
  readonly drawing: readonly SimplifiedStroke[];
}

const sketchSchema = z.object({
  category: z.string().min(1),
  keyId: z.string().min(1),
  drawing: z.array(simplifiedStrokeSchema),
});

const byCategoryThenKey = (a: StoredSketch, b: StoredSketch): number =>
  a.category.localeCompare(b.category) || a.keyId.localeCompare(b.keyId);

/**
 * The Quick, Draw! corpus the k-NN learns from: a gzipped NDJSON file, one drawing per line, sorted
 * by category and key. Features are left out; `corpus.ts` derives them and caches the result.
 * Written to a temporary name and renamed, so a server starting meanwhile never reads half a file.
 */
export const writeSnapshot = async (
  sketches: readonly StoredSketch[],
  path: string,
): Promise<number> => {
  const ndjson = sketches
    .toSorted(byCategoryThenKey)
    .map(({ category, keyId, drawing }) => JSON.stringify({ category, keyId, drawing }))
    .join("\n");
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.${process.pid}.partial`;
  await writeFile(partial, gzipSync(ndjson));
  await rename(partial, path);
  return sketches.length;
};

export const parseSnapshot = (gzipped: Uint8Array): readonly StoredSketch[] =>
  gunzipSync(gzipped)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => sketchSchema.parse(JSON.parse(line)));

export const readSnapshot = async (path: string): Promise<readonly StoredSketch[]> =>
  parseSnapshot(await readFile(path));
