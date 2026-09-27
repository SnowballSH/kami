import { z } from "zod";
import { NATURES } from "../cat/types";
import type { Sighting } from "./types";

const answerSchema = z
  .object({
    guesses: z.array(z.string()),
    confidence: z.array(z.number()),
    names: z.array(z.string()),
    natures: z.array(z.enum(NATURES)),
    strengths: z.array(z.number()),
    lines: z.array(z.string()),
    certain: z.boolean().catch(false),
  })
  .refine(({ guesses, confidence, names, natures, strengths, lines }) =>
    [confidence, names, natures, strengths, lines].every(
      (column) => column.length === guesses.length,
    ),
  );

/** The server's parallel arrays as one list; [] for anything that is not the documented shape. */
export const sightingsOf = (body: unknown): readonly Sighting[] => {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return [];
  const { guesses, confidence, names, natures, strengths, lines, certain } = parsed.data;
  return guesses.map((word, index) => ({
    word,
    confidence: confidence[index] ?? 0,
    name: names[index] ?? word,
    nature: natures[index] ?? "ink",
    strength: strengths[index] ?? 1,
    line: lines[index] ?? "",
    certain: index === 0 && certain,
  }));
};
