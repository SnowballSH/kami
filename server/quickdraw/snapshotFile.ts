import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import { simplifiedStrokeSchema } from "./dataset";
import { indexSketches } from "./indexing";
import type { QuickdrawSampleRepository, StoredSketch } from "./sampleRepository";

const sketchSchema = z.object({
  category: z.string().min(1),
  keyId: z.string().min(1),
  drawing: z.array(simplifiedStrokeSchema),
});

/**
 * A box with no internet cannot run the ingest, so what one machine ingested travels as a
 * gzipped NDJSON file. Features are left out and recomputed on arrival, so they cannot drift.
 */
export const writeSnapshot = async (
  sketches: readonly StoredSketch[],
  path: string,
): Promise<number> => {
  const ndjson = sketches.map((sketch) => JSON.stringify(sketch)).join("\n");
  await writeFile(path, gzipSync(ndjson));
  return sketches.length;
};

export const exportSnapshot = async (
  repository: QuickdrawSampleRepository,
  path: string,
): Promise<number> => writeSnapshot(await repository.loadDrawings(), path);

export const readSnapshot = async (path: string): Promise<readonly StoredSketch[]> =>
  gunzipSync(await readFile(path))
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => sketchSchema.parse(JSON.parse(line)));

export const importSnapshot = async (
  repository: QuickdrawSampleRepository,
  path: string,
): Promise<number> => indexSketches(repository, await readSnapshot(path));
