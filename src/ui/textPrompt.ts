import type { Vec } from "../core/geometry";
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
};

type Settle = (text: string | null) => void;

export class TextPrompt {
  readonly element: HTMLInputElement;
  private readonly host: Window;
  private anchor: Vec = { x: 0, y: 0 };
  private settle: Settle | null = null;

  constructor(host: Window) {
    this.host = host;
    this.element = el("input", { className: "kami-prompt", attrs: PROMPT_ATTRS });
    this.element.hidden = true;
    this.element.addEventListener("keydown", (event) => this.handleKey(event));
    this.element.addEventListener("blur", () => this.commit());
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
    const text = this.element.value.trim();
    this.finish(text === "" ? null : text);
  }

  private finish(text: string | null): void {
    const settle = this.settle;
    if (settle === null) return;
    this.settle = null;
    this.element.hidden = true;
    this.element.blur();
    settle(text);
  }

  private reposition(): void {
    if (!this.isOpen) return;
    const frame = this.element.parentElement?.getBoundingClientRect();
    const placed = placeWithin(
      this.anchor,
      this.element.getBoundingClientRect(),
      visibleRect(this.host),
      PROMPT_MARGIN_PX,
    );
    this.element.style.left = `${Math.round(placed.x - (frame?.left ?? 0))}px`;
    this.element.style.top = `${Math.round(placed.y - (frame?.top ?? 0))}px`;
  }
}
