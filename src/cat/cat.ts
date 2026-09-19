import type { Drawing } from "../ink/types";
import type { WorldFacts } from "../world/types";
import { decree } from "./decree";
import { HintLadder } from "./hintLadder";
import { ASK_WHAT_IT_IS, OFFER_HELP } from "./lines";
import { ruleOn } from "./ruling";
import { isDot } from "./shape";
import { guessNames } from "./shapeGuesser";
import type { Cat, Decree, Glance, Hint, RoomBrief, Ruling } from "./types";

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

  look(drawing: Drawing): Promise<Glance> {
    return Promise.resolve({
      kind: "picture",
      guesses: guessNames(drawing, this.#room.allowedNatures),
    });
  }

  command(text: string, facts: WorldFacts): Promise<Decree> {
    return Promise.resolve(decree(text, facts));
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
