import { el, isShown, setShown } from "./dom";

const PROMPT = "What is it?";
const MAX_NAME_LENGTH = 60;

export interface NamingHandlers {
  onNameChosen(name: string): void;
  onNamingDismissed(): void;
}

export class NamingPanel {
  readonly element: HTMLElement;
  private readonly handlers: NamingHandlers;
  private readonly chips = el("div", { className: "kami-naming-chips" });
  private readonly input = el("input", {
    className: "kami-naming-input",
    attrs: {
      type: "text",
      name: "drawing-name",
      placeholder: "or say what it is…",
      "aria-label": "Name your drawing",
      enterkeyhint: "done",
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
      spellcheck: "false",
      maxlength: String(MAX_NAME_LENGTH),
    },
  });

  constructor(handlers: NamingHandlers) {
    this.handlers = handlers;
    const submit = el("button", {
      className: "kami-button kami-naming-ok",
      text: "OK",
      attrs: { type: "submit" },
    });
    const form = el("form", { className: "kami-naming-form", attrs: { novalidate: "" } }, [
      this.input,
      submit,
    ]);
    const justInk = el("button", {
      className: "kami-button kami-naming-dismiss",
      text: "just ink",
      attrs: { type: "button" },
    });
    this.element = el(
      "section",
      { className: "kami-naming kami-fade", attrs: { "aria-label": "Name your drawing" } },
      [el("p", { className: "kami-naming-prompt", text: PROMPT }), this.chips, form, justInk],
    );
    setShown(this.element, false);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.choose(this.input.value);
    });
    justInk.addEventListener("click", () => this.dismiss());
    this.input.addEventListener("blur", () => window.scrollTo(0, 0));
  }

  get open(): boolean {
    return isShown(this.element);
  }

  show(guesses: readonly string[]): void {
    this.input.value = "";
    this.chips.replaceChildren(...guesses.map((guess) => this.createChip(guess)));
    setShown(this.element, true);
  }

  hide(): void {
    this.input.blur();
    setShown(this.element, false);
  }

  private createChip(guess: string): HTMLButtonElement {
    const chip = el("button", {
      className: "kami-button kami-chip",
      text: guess,
      attrs: { type: "button" },
    });
    chip.addEventListener("click", () => this.choose(guess));
    return chip;
  }

  private choose(rawName: string): void {
    const name = rawName.trim();
    if (!this.open || name === "") return;
    this.hide();
    this.handlers.onNameChosen(name);
  }

  private dismiss(): void {
    if (!this.open) return;
    this.hide();
    this.handlers.onNamingDismissed();
  }
}
