import type { PersistenceFailure } from "./types";

export class PersistenceError extends Error {
  constructor(readonly failure: PersistenceFailure) {
    super(`Board ${failure.operation} failed: ${failure.reason}`);
    this.name = "PersistenceError";
  }
}

export const persistenceFailure = (
  operation: PersistenceFailure["operation"],
  error: unknown,
): PersistenceFailure => {
  if (error instanceof PersistenceError) return error.failure;
  if (error instanceof Error && error.name === "TimeoutError") {
    return { operation, reason: "timeout" };
  }
  if (
    error instanceof SyntaxError ||
    (error instanceof Error && error.name === "BoardResponseError")
  ) {
    return { operation, reason: "invalid-response" };
  }
  return { operation, reason: "network" };
};
