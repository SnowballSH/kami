import { parseControllerLine } from "./message";
import type { ControllerHub, Transport } from "./types";

const LINE_BREAK = /\r?\n|\r/;
const LONGEST_PARTIAL_LINE = 256;

/** Reassembles lines from a byte stream that cuts them anywhere; noise without a line break is dropped. */
export class LineBuffer {
  #partial = "";

  push(chunk: string): readonly string[] {
    const pieces = (this.#partial + chunk).split(LINE_BREAK);
    const partial = pieces.pop() ?? "";
    this.#partial = partial.length > LONGEST_PARTIAL_LINE ? "" : partial;
    return pieces;
  }
}

export const reportLines = (
  hub: ControllerHub,
  lines: readonly string[],
  transport: Transport,
): void => {
  for (const line of lines) {
    const message = parseControllerLine(line);
    if (message !== null) hub.report(message.controller, message.reading, transport);
  }
};

export const linesOf = (text: string): readonly string[] => text.split(LINE_BREAK);
