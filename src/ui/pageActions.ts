import { el } from "./dom";
import { icon } from "./icons";
import { activateOnTap } from "./tap";

const HOME_LABEL = "Back to the start";

/** The address of the start screen: this page with nothing said about mode, board or stage. */
export const homeUrl = (location: Pick<Location, "origin" | "pathname">): string =>
  `${location.origin}${location.pathname}`;

/** What every mode offers beside whichever menu it shows: the way back to the start screen. */
export class PageActions {
  readonly element: HTMLElement;

  constructor(goHome: () => void) {
    const home = el(
      "button",
      {
        className: "kami-control kami-page-home",
        attrs: { type: "button", "aria-label": HOME_LABEL, title: HOME_LABEL },
      },
      [icon("home")],
    );
    activateOnTap(home, goHome);
    this.element = el("div", { className: "kami-island kami-page-actions" }, [home]);
  }
}
