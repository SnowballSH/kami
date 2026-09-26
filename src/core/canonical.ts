import type { z } from "zod";

/**
 * A value as the server keeps it: through JSON (so `-0` and `undefined` fields read as they will
 * arrive) and through the schema the server validates it with (so fields it drops are dropped here
 * too). A value the schema refuses is never stored, and is left as JSON made it.
 */
export const canonicalOf = (schema: z.ZodType, value: unknown): unknown => {
  const json: unknown = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : json;
};
