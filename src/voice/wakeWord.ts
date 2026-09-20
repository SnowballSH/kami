/**
 * "Kami, make her fly." Deepgram spells his name a dozen ways and sometimes as two words, so
 * anything that sounds like it wakes him; what follows in the same breath is the command, and if
 * nothing follows, the next thing said is.
 */
const SOUNDS_LIKE = /^k[aeiou]+r?m[aeiou]+s?$/;

/** Words that sound like his name but are plainly English, and would wake him all day. */
const PLAIN = new Set(["come", "comes", "came", "coma", "comma", "commas"]);

const bare = (word: string): string => word.toLowerCase().replace(/[^a-z]/g, "");

const sounded = (word: string): string =>
  bare(word)
    .replace(/ck|c|qu|q/g, "k")
    .replace(/h/g, "")
    .replace(/y/g, "i")
    .replace(/(.)\1+/g, "$1");

const WORDS = /[^\p{L}\p{N}'’]+/u;

export const isWakeWord = (word: string): boolean =>
  !PLAIN.has(bare(word)) && SOUNDS_LIKE.test(sounded(word));

/** "Car me, gravity off": his name split in two is still his name. */
const isWakePair = (word: string, next: string | undefined): boolean =>
  next !== undefined && SOUNDS_LIKE.test(sounded(word + next));

export class WakeWord {
  #armed = false;

  /** Woken, and waiting for the command in the next breath. */
  get armed(): boolean {
    return this.#armed;
  }

  /** The command in this utterance, or null if it was not for Kami. */
  heard(utterance: string): string | null {
    const words = utterance.split(WORDS).filter((word) => word !== "");
    const spoken = words.findIndex(
      (word, at) => isWakeWord(word) || isWakePair(word, words[at + 1]),
    );
    if (spoken === -1) {
      if (!this.#armed) return null;
      this.#armed = false;
      const said = words.join(" ");
      return said === "" ? null : said;
    }
    const after = isWakeWord(words[spoken] ?? "") ? spoken + 1 : spoken + 2;
    const command = words.slice(after).join(" ");
    this.#armed = command === "";
    return command === "" ? null : command;
  }

  forget(): void {
    this.#armed = false;
  }
}
