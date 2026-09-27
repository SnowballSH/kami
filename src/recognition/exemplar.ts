import { z } from "zod";
import type { Exemplar } from "./types";

const EXEMPLAR_BOX = 256;

const inBox = z.number().min(0).max(EXEMPLAR_BOX);

const exemplarSchema = z.object({
  word: z.string().trim().min(1),
  strokes: z.array(z.array(z.object({ x: inBox, y: inBox })).min(2)).min(1),
}) satisfies z.ZodType<Exemplar>;

/** The server's picture of a word; null for anything that is not strokes inside the 256 px frame. */
export const exemplarOf = (body: unknown): Exemplar | null => {
  const parsed = exemplarSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};
