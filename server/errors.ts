export const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const errorCodeOf = (error: unknown): unknown =>
  error instanceof Error && "code" in error ? error.code : undefined;
