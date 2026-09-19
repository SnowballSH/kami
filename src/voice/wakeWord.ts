/**
 * "Kami, make her fly." Deepgram spells his name a dozen ways, so anything that sounds like it
 * wakes him; what follows in the same breath is the command, and if nothing follows, the next
 * thing said is.
 */
const VARIANTS = new Set([
  "kami",
  "kamis",
  "kammy",
  "kammi",
  "cami",
  "camy",
  "cammy",
  "khami",
  "karmi",
  "commie",
  "comey",
  "kamee",
  "kamea",
  "kamy",
]);

const WORDS = /[^\p{L}\p{N}'’]+/u;

const bare = (word: string): string => word.toLowerCase().replace(/[^a-z]/g, "");

export const isWakeWord = (word: string): boolean => VARIANTS.has(bare(word));

export class WakeWord {
  #armed = false;

  /** Woken, and waiting for the command in the next breath. */
  get armed(): boolean {
    return this.#armed;
  }

  /** The command in this utterance, or null if it was not for Kami. */
  heard(utterance: string): string | null {
    const words = utterance.split(WORDS).filter((word) => word !== "");
    const at = words.findIndex((word) => isWakeWord(word));
    if (at === -1) {
      if (!this.#armed) return null;
      this.#armed = false;
      const said = words.join(" ");
      return said === "" ? null : said;
    }
    const command = words.slice(at + 1).join(" ");
    this.#armed = command === "";
    return command === "" ? null : command;
  }

  forget(): void {
    this.#armed = false;
  }
}
