export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Body exceeds ${maxBytes} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

/** Reads at most `maxBytes` of UTF-8; an abort cancels the body and rejects with the signal's reason. */
export const readBoundedText = async (
  message: Request | Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> => {
  if (Number(message.headers.get("content-length")) > maxBytes) {
    void message.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(maxBytes);
  }
  const reader = message.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  const cancel = (): void => void reader.cancel(signal?.reason).catch(() => undefined);
  signal?.addEventListener("abort", cancel, { once: true });
  let bytes = 0;
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new BodyTooLargeError(maxBytes);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
};
