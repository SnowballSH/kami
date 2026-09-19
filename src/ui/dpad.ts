import { capturePointer, el, releasePointer } from "./dom";
import { icon } from "./icons";
import { DIRECTIONS, type Direction, type PressedListener } from "./walkIntent";

const HELD_CLASS = "is-held";
const RELEASE_EVENTS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

const LABELS: Readonly<Record<Direction, string>> = {
  left: "Walk left",
  right: "Walk right",
  up: "Climb up",
  down: "Climb down",
};

export class DPad {
  readonly element: HTMLElement;
  private readonly onPressedChange: PressedListener;
  private readonly heldByPointer = new Map<number, Direction>();
  private readonly buttons = new Map<Direction, HTMLButtonElement>();

  constructor(onPressedChange: PressedListener) {
    this.onPressedChange = onPressedChange;
    for (const direction of DIRECTIONS) this.buttons.set(direction, this.createButton(direction));
    this.element = el(
      "div",
      { className: "kami-dpad", attrs: { role: "group", "aria-label": "Walk" } },
      [...this.buttons.values()],
    );
  }

  releaseAll(): void {
    this.heldByPointer.clear();
    this.publish();
  }

  private createButton(direction: Direction): HTMLButtonElement {
    const button = el(
      "button",
      {
        className: `kami-dpad-button kami-dpad-${direction}`,
        attrs: { type: "button", "aria-label": LABELS[direction] },
      },
      [icon(direction)],
    );
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      capturePointer(button, event.pointerId);
      this.heldByPointer.set(event.pointerId, direction);
      this.publish();
    });
    for (const type of RELEASE_EVENTS) {
      button.addEventListener(type, (event) => {
        releasePointer(button, event.pointerId);
        if (this.heldByPointer.delete(event.pointerId)) this.publish();
      });
    }
    return button;
  }

  private publish(): void {
    const pressed = new Set(this.heldByPointer.values());
    for (const [direction, button] of this.buttons) {
      button.classList.toggle(HELD_CLASS, pressed.has(direction));
    }
    this.onPressedChange(pressed);
  }
}
