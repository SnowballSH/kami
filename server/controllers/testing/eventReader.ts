const BLOCK_END = "\n\n";
const DATA_FIELD = "data: ";

export interface EventReader {
  /** The next block of the stream as it was sent: an event, a comment or a field. */
  nextBlock(): Promise<string>;
  /** The payload of the next `data:` event, skipping comments and other fields. */
  nextEvent(): Promise<unknown>;
  cancel(): Promise<void>;
}

export const readEvents = (response: Response): EventReader => {
  if (response.body === null) throw new Error("the response has no body to stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let unread = "";

  const nextBlock = async (): Promise<string> => {
    while (!unread.includes(BLOCK_END)) {
      const { done, value } = await reader.read();
      if (done) throw new Error("the event stream ended");
      unread += decoder.decode(value, { stream: true });
    }
    const end = unread.indexOf(BLOCK_END);
    const block = unread.slice(0, end);
    unread = unread.slice(end + BLOCK_END.length);
    return block;
  };

  const nextEvent = async (): Promise<unknown> => {
    for (;;) {
      const data = (await nextBlock()).split("\n").find((line) => line.startsWith(DATA_FIELD));
      if (data !== undefined) return JSON.parse(data.slice(DATA_FIELD.length));
    }
  };

  return { nextBlock, nextEvent, cancel: () => reader.cancel() };
};
