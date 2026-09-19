import { z } from "zod";
import type { Stroke } from "../../src/core/geometry";

const DATASET_BASE_URL = "https://storage.googleapis.com/quickdraw_dataset/full/simplified";
const DEFAULT_RANGE_BYTES = 1_500_000;

export const simplifiedStrokeSchema = z.tuple([z.array(z.number()), z.array(z.number())]);

const simplifiedLineSchema = z.object({
  key_id: z.string(),
  recognized: z.boolean(),
  drawing: z.array(simplifiedStrokeSchema),
});

export type SimplifiedStroke = z.output<typeof simplifiedStrokeSchema>;

export interface QuickdrawDrawing {
  readonly keyId: string;
  readonly drawing: readonly SimplifiedStroke[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const datasetUrl = (category: string): string =>
  `${DATASET_BASE_URL}/${encodeURIComponent(category)}.ndjson`;

export const toStrokes = (drawing: readonly SimplifiedStroke[]): readonly Stroke[] =>
  drawing.map(([xs, ys]) => xs.map((x, index) => ({ x, y: ys[index] ?? 0 })));

const completeLines = (ndjson: string): readonly string[] => {
  const lines = ndjson.split("\n");
  return lines.slice(0, -1).filter((line) => line.trim().length > 0);
};

const parseLine = (line: string): QuickdrawDrawing | null => {
  try {
    const parsed = simplifiedLineSchema.safeParse(JSON.parse(line));
    if (!parsed.success || !parsed.data.recognized) return null;
    return { keyId: parsed.data.key_id, drawing: parsed.data.drawing };
  } catch {
    return null;
  }
};

/** Whatever follows the last newline is treated as a line cut short by the byte range and dropped. */
export const parseSimplifiedNdjson = (ndjson: string, limit: number): readonly QuickdrawDrawing[] =>
  completeLines(ndjson)
    .map(parseLine)
    .filter((drawing) => drawing !== null)
    .slice(0, limit);

export const fetchCategoryDrawings = async (
  category: string,
  limit: number,
  fetchFn: FetchLike = fetch,
  rangeBytes = DEFAULT_RANGE_BYTES,
): Promise<readonly QuickdrawDrawing[]> => {
  const response = await fetchFn(datasetUrl(category), {
    headers: { range: `bytes=0-${rangeBytes - 1}` },
  });
  if (!response.ok) throw new Error(`${category}: dataset answered ${response.status}`);
  return parseSimplifiedNdjson(await response.text(), limit);
};
