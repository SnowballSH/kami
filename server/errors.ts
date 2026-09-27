export const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
