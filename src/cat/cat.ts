import type { Drawing } from "../ink/types";
import { HintLadder } from "./hintLadder";
import { ASK_WHAT_IT_IS, OFFER_HELP } from "./lines";
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
  #room = NOWHERE;
  #ladder = new HintLadder(NOWHERE.hints);
  #helpOffered = false;
  #lastSeen: Drawing | null = null;

  enterRoom(room: RoomBrief): void {
    this.#room = room;
    this.#ladder = new HintLadder(room.hints);
    this.#helpOffered = false;
    this.#lastSeen = null;
  }

  name(utterance: string): Promise<Ruling> {
    const drawingIsDot = this.#lastSeen !== null && isDot(this.#lastSeen);
    this.#lastSeen = null;
    return Promise.resolve(ruleOn(utterance, { allowed: this.#room.allowedNatures, drawingIsDot }));
  }

  guess(drawing: Drawing): Promise<Guesses> {
    this.#lastSeen = drawing;
    return Promise.resolve(guessNames(drawing, this.#room.allowedNatures));
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
}
