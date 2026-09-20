import { parseCabinetLine } from "./cabinet";
import { parseControllerLine } from "./message";
import type { ControllerHub, Transport } from "./types";

const LINE_BREAK = /\r?\n|\r/;
const LONGEST_PARTIAL_LINE = 256;

/** Reassembles lines from a byte stream that cuts them anywhere; noise without a line break is dropped. */
export class LineBuffer {
  #partial = "";
  #discarding = false;

  push(chunk: string): readonly string[] {
    const lines: string[] = [];
    for (const character of chunk) {
      if (character === "\r" || character === "\n") {
        if (!this.#discarding) lines.push(this.#partial);
        this.#partial = "";
        this.#discarding = false;
      } else if (!this.#discarding) {
        if (this.#partial.length === LONGEST_PARTIAL_LINE) {
          this.#partial = "";
          this.#discarding = true;
        } else {
          this.#partial += character;
        }
      }
    }
    return lines;
  }
}

export const reportLines = (
  hub: ControllerHub,
  lines: readonly string[],
  transport: Transport,
): void => {
  for (const line of lines) {
    const message =
      parseControllerLine(line) ?? (transport === "serial" ? parseCabinetLine(line) : null);
    if (message !== null) hub.report(message.controller, message.reading, transport);
  }
};

export const linesOf = (text: string): readonly string[] => text.split(LINE_BREAK);
