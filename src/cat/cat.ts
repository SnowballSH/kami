import type { Stroke } from "../core/geometry";
import type { Drawing, DrawingId } from "../ink/types";
import type { LiveRecognizer, Recognizer, Sighting } from "../recognition/types";
import { mergeGuesses } from "./guesses";
import { HintLadder } from "./hintLadder";
import { ASK_WHAT_IT_IS, OFFER_HELP } from "./lines";
import { namesForRecognized } from "./recognizedNames";
import { isUnknownName, ruleOn } from "./ruling";
import { isDot } from "./shape";
import { type Guesses, guessNames } from "./shapeGuesser";
import { bestSighting, honourRuling, isCertain, offeredRulings, rulingOf, speaksOf } from "./sight";
import type { Cat, Hint, Look, RoomBrief, Ruling } from "./types";

const REMEMBERED_SIGHTINGS = 32;

const canSight = (recognizer: Recognizer): recognizer is LiveRecognizer => "sight" in recognizer;

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
  readonly #seen = new Map<DrawingId, readonly Sighting[]>();
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
    const allowed = this.#room.allowedNatures;
    const ruling = ruleOn(utterance, { allowed, drawingIsDot: isDot(drawing) });
    if (ruling.nature !== "ink" || !isUnknownName(utterance)) return Promise.resolve(ruling);
    const seen = this.#seen.get(drawing.id)?.find((sighting) => speaksOf(utterance, sighting));
    if (seen === undefined || seen.nature === "ink") return Promise.resolve(ruling);
    return Promise.resolve({ ...rulingOf(seen, allowed), name: ruling.name, tags: ruling.tags });
  }

  async guess(drawing: Drawing): Promise<Guesses> {
    return (await this.look(drawing)).guesses;
  }

  accept(ruling: Ruling): Ruling {
    return honourRuling(ruling, this.#room.allowedNatures);
  }

  async look(drawing: Drawing): Promise<Look> {
    const allowed = this.#room.allowedNatures;
    const hunch = guessNames(drawing, allowed);
    const rule = (name: string): Ruling => ruleOn(name, { allowed, drawingIsDot: isDot(drawing) });
    if (this.#recognizer === null || !canSight(this.#recognizer)) {
      const seen = await this.#recognize(drawing);
      const guesses = mergeGuesses(namesForRecognized(seen), hunch, allowed);
      return { certain: null, guesses, rulings: guesses.map(rule) };
    }
    const sightings = await this.#sight(this.#recognizer, drawing.strokes);
    this.#remember(drawing.id, sightings);
    const [first] = sightings;
    const sure = first !== undefined && isCertain(first) ? bestSighting([first], allowed) : null;
    const offered = offeredRulings(sightings, allowed);
    const guesses = mergeGuesses(
      offered.map(({ name }) => name),
      hunch,
      "all",
    );
    return {
      certain: sure === null ? null : rulingOf(sure, allowed),
      guesses,
      rulings: guesses.map((name) => offered.find((ruling) => ruling.name === name) ?? rule(name)),
    };
  }

  async glimpse(strokes: readonly Stroke[]): Promise<Sighting | null> {
    if (this.#recognizer === null || !canSight(this.#recognizer)) return null;
    const sightings = await this.#sight(this.#recognizer, strokes, { partial: true });
    return bestSighting(sightings, this.#room.allowedNatures);
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

  async #sight(
    recognizer: LiveRecognizer,
    strokes: readonly Stroke[],
    options?: { readonly partial: boolean },
  ): Promise<readonly Sighting[]> {
    try {
      return await recognizer.sight(strokes, options);
    } catch {
      return [];
    }
  }

  #remember(id: DrawingId, sightings: readonly Sighting[]): void {
    this.#seen.delete(id);
    this.#seen.set(id, sightings);
    for (const stale of this.#seen.keys()) {
      if (this.#seen.size <= REMEMBERED_SIGHTINGS) break;
      this.#seen.delete(stale);
    }
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
