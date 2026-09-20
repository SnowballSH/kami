import type { Vec } from "../core/geometry";
import { INPUT_LIMITS, TEXT_LIMIT_MESSAGE } from "../core/inputLimits";
import { el } from "./dom";
import { placeWithin, visibleRect } from "./placement";
import type { Detach } from "./types";

const PROMPT_MARGIN_PX = 12;
const COMMIT_KEY = "Enter";
const ABANDON_KEY = "Escape";
const VIEWPORT_EVENTS = ["resize", "scroll"] as const;

const PROMPT_ATTRS: Readonly<Record<string, string>> = {
  type: "text",
  inputmode: "text",
  enterkeyhint: "done",
  autocapitalize: "off",
  autocomplete: "off",
  autocorrect: "off",
  spellcheck: "false",
  placeholder: "write…",
  "aria-label": "Write a note",
  "aria-describedby": "kami-prompt-limit",
  maxlength: String(INPUT_LIMITS.text),
};

type Settle = (text: string | null) => void;

export class TextPrompt {
  readonly element: HTMLInputElement;
  readonly feedback = el("span", {
    className: "kami-prompt-limit",
    attrs: { id: "kami-prompt-limit", role: "status" },
  });
  private readonly host: Window;
  private anchor: Vec = { x: 0, y: 0 };
  private settle: Settle | null = null;

  constructor(host: Window) {
    this.host = host;
    this.element = el("input", { className: "kami-prompt", attrs: PROMPT_ATTRS });
    this.element.hidden = true;
    this.feedback.hidden = true;
    this.element.addEventListener("keydown", (event) => this.handleKey(event));
    this.element.addEventListener("blur", () => this.commit());
    this.element.addEventListener("input", () => this.validate());
    this.element.addEventListener("paste", (event) => {
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      const replaced = (this.element.selectionEnd ?? 0) - (this.element.selectionStart ?? 0);
      if (this.element.value.length - replaced + pasted.length > INPUT_LIMITS.text) {
        event.preventDefault();
        this.feedback.textContent = `Paste too long. ${TEXT_LIMIT_MESSAGE}`;
        this.reposition();
      }
    });
  }

  get isOpen(): boolean {
    return this.settle !== null;
  }

  attach(): Detach {
    const viewport = this.host.visualViewport ?? null;
    const listeners = new AbortController();
    for (const type of VIEWPORT_EVENTS) {
      viewport?.addEventListener(type, () => this.reposition(), { signal: listeners.signal });
    }
    return () => {
      listeners.abort();
      this.finish(null);
    };
  }

  ask(client: Vec): Promise<string | null> {
    this.finish(null);
    const answer = new Promise<string | null>((resolve) => {
      this.settle = resolve;
    });
    this.anchor = client;
    this.element.value = "";
    this.element.hidden = false;
    this.feedback.hidden = false;
    this.validate();
    this.reposition();
    this.element.focus({ preventScroll: true });
    return answer;
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === COMMIT_KEY) {
      event.preventDefault();
      this.commit();
    } else if (event.key === ABANDON_KEY) {
      event.preventDefault();
      this.finish(null);
    }
  }

  private commit(): void {
    if (!this.isOpen) return;
    if (!this.validate()) {
      this.element.focus({ preventScroll: true });
      return;
    }
    const text = this.element.value.trim();
    this.finish(text === "" ? null : text);
  }

  private validate(): boolean {
    const valid = this.element.value.length <= INPUT_LIMITS.text;
    this.element.setCustomValidity(valid ? "" : TEXT_LIMIT_MESSAGE);
    this.element.setAttribute("aria-invalid", String(!valid));
    this.feedback.textContent = valid
      ? `${this.element.value.length} / ${INPUT_LIMITS.text} characters`
      : TEXT_LIMIT_MESSAGE;
    this.reposition();
    return valid;
  }

  private finish(text: string | null): void {
    const settle = this.settle;
    if (settle === null) return;
    this.settle = null;
    this.element.hidden = true;
    this.feedback.hidden = true;
    this.element.blur();
    settle(text);
  }

  private reposition(): void {
    if (!this.isOpen) return;
    const frame = this.element.parentElement?.getBoundingClientRect();
    const input = this.element.getBoundingClientRect();
    const feedback = this.feedback.getBoundingClientRect();
    const placed = placeWithin(
      this.anchor,
      { width: Math.max(input.width, feedback.width), height: input.height + feedback.height + 4 },
      visibleRect(this.host),
      PROMPT_MARGIN_PX,
    );
    this.element.style.left = `${Math.round(placed.x - (frame?.left ?? 0))}px`;
    this.element.style.top = `${Math.round(placed.y - (frame?.top ?? 0))}px`;
    this.feedback.style.left = this.element.style.left;
    this.feedback.style.top = `${Math.round(placed.y - (frame?.top ?? 0) + input.height + 4)}px`;
  }
}
