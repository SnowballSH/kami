import type { z } from "zod";

export class BoardResponseError extends Error {
  constructor(
    readonly path: string,
    readonly problems: readonly string[],
  ) {
    super(`Invalid saved board response from ${path}: ${problems.join("; ")}`);
    this.name = "BoardResponseError";
  }
}

export const parseBoardResponse = <Value>(
  schema: z.ZodType<Value>,
  path: string,
  body: unknown,
): Value => {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  const error = new BoardResponseError(
    path,
    parsed.error.issues.map(({ path, message }) => `${path.join(".") || "response"}: ${message}`),
  );
  console.warn("Kami could not read the saved board data; nothing was restored or deleted.", error);
  throw error;
};
