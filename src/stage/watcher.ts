import { type StageAudience, StageDecoder } from "./decoder";
import { type DialStage, KeptLine, type Schedule } from "./line";
import { kindOf, unpackShown } from "./wire";

export interface StageHouse extends StageAudience {
  /** Nobody is playing, or the line to the server is down: there is nothing to show. */
  wentDark(): void;
}

/** A screen's end of the stage: whatever the live source shows, made whole and handed to the house. */
export class StageWatcher {
  readonly #decoder: StageDecoder;

  constructor(dial: DialStage, house: StageHouse, schedule?: Schedule) {
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
          if (shown !== null) this.#decoder.take(shown);
        },
        closed: dark,
      },
      schedule,
    );
  }
}
