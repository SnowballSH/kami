export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Body exceeds ${maxBytes} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

export const readBoundedText = async (
  message: Request | Response,
  maxBytes: number,
): Promise<string> => {
  if (Number(message.headers.get("content-length")) > maxBytes) {
    void message.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError(maxBytes);
  }
  const reader = message.body?.getReader();
  if (reader === undefined) return "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
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
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
};
