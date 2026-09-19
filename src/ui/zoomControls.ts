import { iconButton } from "./controls";
import { el } from "./dom";
import type { HudHandlers } from "./types";

export const ZOOM_STEP = 1.25;

type ZoomHandlers = Pick<HudHandlers, "onZoom" | "onRecenter" | "onAutopilotToggled">;

const PRESSED = "aria-pressed";

export class ZoomControls {
  readonly element: HTMLElement;
  private readonly autopilot: HTMLButtonElement;

  constructor(handlers: ZoomHandlers) {
    this.autopilot = iconButton({
      label: "Alice walks herself",
      className: "kami-autopilot",
      icon: "walker",
      onClick: () => handlers.onAutopilotToggled(this.autopilot.getAttribute(PRESSED) !== "true"),
    });
    this.element = el(
      "div",
      { className: "kami-island kami-zoom", attrs: { role: "group", "aria-label": "Zoom" } },
      [
        this.autopilot,
        iconButton({
          label: "Zoom out",
          className: "kami-zoom-out",
          icon: "minus",
          onClick: () => handlers.onZoom(1 / ZOOM_STEP),
        }),
        iconButton({
          label: "Zoom in",
          className: "kami-zoom-in",
          icon: "plus",
          onClick: () => handlers.onZoom(ZOOM_STEP),
        }),
        iconButton({
          label: "Back to Alice",
          className: "kami-recenter",
          icon: "recenter",
          onClick: () => handlers.onRecenter(),
        }),
      ],
    );
  }

  setAutopilot(enabled: boolean): void {
    this.autopilot.setAttribute(PRESSED, String(enabled));
  }
}
