import type { RuleId } from "../rules/types";
import { el } from "./dom";
import { activateOnTap } from "./tap";
import type { LawListing, LawsPanel, LawsPanelHandlers } from "./types";

const HEADING = "laws in force";
const REPEAL_HINT = "tap a law to repeal it";
const CONFIRM_LABEL = "tap again to repeal";
const CONFIRMING_CLASS = "is-confirming";
const DISARM_AFTER_MS = 3000;

/**
 * The standing laws of the board, newest last, each a button. The first tap arms a law, the
 * second repeals it; arming another law, or a few seconds passing, disarms it, so a stray touch
 * much later cannot repeal anything. Kami's notes fade, so this list is how a law can always be
 * found and undone.
 */
export class DomLawsPanel implements LawsPanel {
  readonly element: HTMLElement;
  private readonly list = el("div", {
    className: "kami-laws-list kami-scrollable",
    attrs: { role: "group", "aria-label": HEADING },
  });
  private laws: readonly LawListing[] = [];
  private armed: RuleId | null = null;
  private disarming: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly handlers: LawsPanelHandlers) {
    this.element = el(
      "section",
      { className: "kami-laws kami-island", attrs: { "aria-label": HEADING, hidden: "" } },
      [
        el("header", { className: "kami-laws-heading" }, [
          el("span", { text: HEADING }),
          el("span", { className: "kami-laws-hint", text: REPEAL_HINT }),
        ]),
        this.list,
      ],
    );
  }

  setLaws(laws: readonly LawListing[]): void {
    this.laws = laws;
    if (laws.every((law) => law.id !== this.armed)) this.armed = null;
    this.list.replaceChildren(...laws.map((law) => this.itemFor(law)));
    this.element.toggleAttribute("hidden", laws.length === 0);
  }

  private itemFor(law: LawListing): HTMLButtonElement {
    const arming = law.id === this.armed;
    const item = el(
      "button",
      {
        className: `kami-menu-item kami-law${arming ? ` ${CONFIRMING_CLASS}` : ""}`,
        attrs: { type: "button", title: law.gloss },
      },
      [
        el("span", { className: "kami-law-text", text: law.text }),
        el("span", { className: "kami-law-gloss", text: arming ? CONFIRM_LABEL : law.gloss }),
      ],
    );
    activateOnTap(item, () => this.tapped(law));
    return item;
  }

  private tapped(law: LawListing): void {
    const confirmed = this.armed === law.id;
    this.arm(confirmed ? null : law.id);
    if (confirmed) this.handlers.onRepealLaw(law.id);
  }

  private arm(id: RuleId | null): void {
    if (this.disarming !== null) clearTimeout(this.disarming);
    this.disarming = id === null ? null : setTimeout(() => this.arm(null), DISARM_AFTER_MS);
    this.armed = id;
    this.setLaws(this.laws);
  }
}
