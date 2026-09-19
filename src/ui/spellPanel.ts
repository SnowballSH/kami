import { el, isShown, setShown } from "./dom";
import { onTap } from "./tap";

const MAX_SPELL_LENGTH = 120;

export interface SpellHandlers {
  onSpell(text: string): void;
}

/** A typed way to write to the world, for when there is no pencil or no model to read handwriting. */
export class SpellPanel {
  readonly element: HTMLElement;
  private readonly input = el("input", {
    className: "kami-naming-input kami-spell-input",
    attrs: {
      type: "text",
      name: "spell",
      placeholder: "tell the world something… g = 1 m/s²",
      "aria-label": "Write to the world",
      enterkeyhint: "send",
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
      spellcheck: "false",
      maxlength: String(MAX_SPELL_LENGTH),
    },
  });

  constructor(private readonly handlers: SpellHandlers) {
    const submit = el("button", {
      className: "kami-button kami-spell-ok",
      text: "So be it",
      attrs: { type: "button" },
    });
    const form = el("form", { className: "kami-naming-form", attrs: { novalidate: "" } }, [
      this.input,
      submit,
    ]);
    this.element = el(
      "section",
      {
        className: "kami-naming kami-spell kami-fade",
        attrs: { "aria-label": "Write to the world" },
      },
      [form],
    );
    setShown(this.element, false);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.cast();
    });
    onTap(submit, () => this.cast());
    this.input.addEventListener("blur", () => window.scrollTo(0, 0));
  }

  get open(): boolean {
    return isShown(this.element);
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    this.input.value = "";
    setShown(this.element, true);
    this.input.focus();
  }

  hide(): void {
    this.input.blur();
    setShown(this.element, false);
  }

  private cast(): void {
    const text = this.input.value.trim();
    if (!this.open || text === "") return;
    this.hide();
    this.handlers.onSpell(text);
  }
}
