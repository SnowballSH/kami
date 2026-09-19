import { iconButton } from "./controls";
import { capturePointer, el, isTextField, releasePointer } from "./dom";
import { icon } from "./icons";
import type { Detach, HudHandlers } from "./types";

const PRESSED = "aria-pressed";
const PRIMARY_BUTTON = 0;
const TALK_CODE = "Space";
const LOST_EVENTS = ["pointercancel", "lostpointercapture"] as const;

type TalkHandlers = Pick<HudHandlers, "onTalkStarted" | "onTalkEnded" | "onWakeToggled">;

/**
 * Hold the CAT button, or Space, to talk; let go and Kami answers. Every way of ending the press
 * — lifting, leaving the page, cancelling — ends the listening too, so the microphone is never
 * left open by accident. The ear beside it is the other way: leave it on and say "kami" first.
 */
export class TalkButton {
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly ear: HTMLButtonElement;
  private readonly handlers: TalkHandlers;
  private pointer: number | null = null;
  private keyed = false;

  constructor(handlers: TalkHandlers) {
    this.handlers = handlers;
    this.button = el(
      "button",
      {
        className: "kami-control kami-talk",
        attrs: {
          type: "button",
          "aria-label": "Hold to talk to Kami",
          title: "Hold to talk to Kami (Space)",
          [PRESSED]: "false",
        },
      },
      [icon("cat")],
    );
    this.ear = iconButton({
      label: 'Listen for "kami"',
      className: "kami-wake",
      icon: "ear",
      onClick: () => handlers.onWakeToggled(this.ear.getAttribute(PRESSED) !== "true"),
    });
    this.ear.setAttribute(PRESSED, "false");
    this.element = el(
      "div",
      { className: "kami-island kami-voice", attrs: { role: "group", "aria-label": "Talk" } },
      [this.ear, this.button],
    );
    this.listenForPointer();
  }

  attach(host: Window): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    host.addEventListener("keydown", (event) => this.keyDown(event), options);
    host.addEventListener("keyup", (event) => this.keyUp(event), options);
    host.addEventListener("blur", () => this.letGo(), options);
    return () => {
      listeners.abort();
      this.letGo();
    };
  }

  setListening(listening: boolean): void {
    this.button.setAttribute(PRESSED, String(listening));
    this.element.classList.toggle("kami-listening", listening);
  }

  setWaking(waking: boolean): void {
    this.ear.setAttribute(PRESSED, String(waking));
  }

  private listenForPointer(): void {
    this.button.addEventListener("pointerdown", (event) => {
      if (event.button !== PRIMARY_BUTTON || this.pointer !== null) return;
      event.preventDefault();
      this.pointer = event.pointerId;
      capturePointer(this.button, event.pointerId);
      this.handlers.onTalkStarted();
    });
    this.button.addEventListener("pointerup", (event) => {
      if (event.pointerId !== this.pointer) return;
      this.pointer = null;
      releasePointer(this.button, event.pointerId);
      this.handlers.onTalkEnded();
    });
    for (const type of LOST_EVENTS) {
      this.button.addEventListener(type, (event) => {
        if (event.pointerId !== this.pointer) return;
        this.pointer = null;
        this.handlers.onTalkEnded();
      });
    }
  }

  private keyDown(event: KeyboardEvent): void {
    if (event.code !== TALK_CODE) return;
    if (isTextField(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if (this.keyed) return;
    this.keyed = true;
    this.handlers.onTalkStarted();
  }

  private keyUp(event: KeyboardEvent): void {
    if (event.code !== TALK_CODE || !this.keyed) return;
    this.keyed = false;
    this.handlers.onTalkEnded();
  }

  private letGo(): void {
    if (this.pointer !== null) {
      this.pointer = null;
      this.handlers.onTalkEnded();
    }
    if (!this.keyed) return;
    this.keyed = false;
    this.handlers.onTalkEnded();
  }
}
