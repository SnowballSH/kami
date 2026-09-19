import type { Drawing } from "../ink/types";
import type { Recognizer } from "../recognition/types";
import { mergeGuesses } from "./guesses";
import { HintLadder } from "./hintLadder";
import { ASK_WHAT_IT_IS, OFFER_HELP } from "./lines";
import { namesForRecognized } from "./recognizedNames";
import { ruleOn } from "./ruling";
import { isDot } from "./shape";
import { type Guesses, guessNames } from "./shapeGuesser";
import type { Cat, Hint, RoomBrief, Ruling } from "./types";

const NOWHERE: RoomBrief = {
  id: "nowhere",
  allowedNatures: "all",
  hints: [
    "We're all mad here. Draw something and see.",
    "Ink is solid. A name wakes it up.",
    "Draw what she needs, then tell me what it is.",
  ],
};

export class ScriptedCat implements Cat {
  readonly #recognizer: Recognizer | null;
  #room = NOWHERE;
  #ladder = new HintLadder(NOWHERE.hints);
  #helpOffered = false;

  constructor(recognizer: Recognizer | null = null) {
    this.#recognizer = recognizer;
  }

  enterRoom(room: RoomBrief): void {
    this.#room = room;
    this.#ladder = new HintLadder(room.hints);
    this.#helpOffered = false;
  }

  name(utterance: string, drawing: Drawing): Promise<Ruling> {
    return Promise.resolve(
      ruleOn(utterance, { allowed: this.#room.allowedNatures, drawingIsDot: isDot(drawing) }),
    );
  }

  async guess(drawing: Drawing): Promise<Guesses> {
    const allowed = this.#room.allowedNatures;
    const hunch = guessNames(drawing, allowed);
    const seen = await this.#recognize(drawing);
    return mergeGuesses(namesForRecognized(seen), hunch, allowed);
  }

  askWhatItIs(): string {
    return ASK_WHAT_IT_IS;
  }

  hint(): Hint {
    return this.#ladder.climb();
  }

  offerHelp(): string | null {
    if (this.#helpOffered) return null;
    this.#helpOffered = true;
    return OFFER_HELP;
  }

  async #recognize(drawing: Drawing): Promise<readonly string[]> {
    if (this.#recognizer === null) return [];
    try {
      return await this.#recognizer.recognize(drawing);
    } catch {
      return [];
    }
  }
}
