import { type StageAudience, StageDecoder } from "./decoder";
import { type DialStage, KeptLine, type Schedule } from "./line";
import { kindOf, type ShownMessage, unpackShown } from "./wire";

export interface StageHouse extends StageAudience {
  /** Nobody is playing, or the line to the server is down: there is nothing to show. */
  wentDark(): void;
}

const UNREADABLE = "Kami's screen could not read what it was shown";

/** A screen's end of the stage: whatever the live source shows, made whole and handed to the house. */
export class StageWatcher {
  readonly #decoder: StageDecoder;

  constructor(dial: DialStage, house: StageHouse, schedule?: Schedule, chance?: () => number) {
    this.#decoder = new StageDecoder(house);
    const dark = (): void => {
      this.#decoder.clear();
      house.wentDark();
    };
    new KeptLine(
      dial,
      {
        opened: () => {},
        message: (text) => {
          if (kindOf(text) === "offstage") return dark();
          const shown = unpackShown(text);
          if (shown !== null) this.#take(shown);
        },
        closed: dark,
      },
      schedule,
      chance,
    );
  }

  /** The bodies are the source's word for it: one that is not what it says must not end the show. */
  #take(shown: ShownMessage): void {
    try {
      this.#decoder.take(shown);
    } catch (error) {
      console.warn(UNREADABLE, shown.kind, error);
    }
  }
}
