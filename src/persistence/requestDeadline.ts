export const PERSISTENCE_TIMEOUT_MS = 10_000;

export const withRequestDeadline = async <Result>(
  request: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> => {
  const controller = new AbortController();
  const deadline = Promise.withResolvers<never>();
  const timer = setTimeout(() => {
    const error = new DOMException("Persistence request timed out", "TimeoutError");
    deadline.reject(error);
    controller.abort(error);
  }, PERSISTENCE_TIMEOUT_MS);
  try {
    return await Promise.race([request(controller.signal), deadline.promise]);
  } finally {
    clearTimeout(timer);
  }
};
