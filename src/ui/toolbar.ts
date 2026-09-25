import { ArmedTap } from "./armedTap";
import { el } from "./dom";
import { type IconName, icon } from "./icons";
import { activateOnTap } from "./tap";
import type { Tool } from "./types";

interface ToolSpec {
  readonly tool: Tool;
  readonly label: string;
  readonly hotkey: string;
  readonly icon: IconName;
}

export const TOOL_SPECS: readonly ToolSpec[] = [
  { tool: "draw", label: "Draw", hotkey: "d", icon: "draw" },
  { tool: "write", label: "Write", hotkey: "t", icon: "write" },
  { tool: "erase", label: "Erase", hotkey: "e", icon: "erase" },
  { tool: "pan", label: "Pan", hotkey: "h", icon: "pan" },
];

const createToolButton = (spec: ToolSpec, onPick: (tool: Tool) => void): HTMLButtonElement => {
  const hotkey = spec.hotkey.toUpperCase();
  const label = `${spec.label} (${hotkey})`;
  const button = el(
    "button",
    {
      className: `kami-control kami-tool kami-tool-${spec.tool}`,
      attrs: { type: "button", "aria-label": label, "aria-pressed": "false", title: label },
    },
    [icon(spec.icon), el("span", { className: "kami-tool-hotkey", text: hotkey })],
  );
  activateOnTap(button, () => onPick(spec.tool));
  return button;
};

const CLEAR_LABEL = "Clear the page";
const CLEAR_CONFIRM_LABEL = "Tap again to clear the page";
const CONFIRMING_CLASS = "is-confirming";

export class Toolbar {
  readonly element: HTMLElement;
  private readonly buttons: ReadonlyMap<Tool, HTMLButtonElement>;
  private readonly clear: HTMLButtonElement;
  private readonly clearing: ArmedTap;

  constructor(onPick: (tool: Tool) => void, onClear: () => void) {
    this.buttons = new Map(
      TOOL_SPECS.map((spec) => [
        spec.tool,
        createToolButton(spec, (tool) => {
          this.clearing.disarm();
          onPick(tool);
        }),
      ]),
    );
    this.clear = el(
      "button",
      {
        className: "kami-control kami-clear-page",
        attrs: { type: "button", "aria-label": CLEAR_LABEL, title: CLEAR_LABEL },
      },
      [
        icon("clear"),
        el("span", {
          className: "kami-clear-hint",
          text: "tap again to clear",
          attrs: { "aria-hidden": "true" },
        }),
      ],
    );
    this.clearing = new ArmedTap(onClear, (armed) => this.showClearArmed(armed));
    activateOnTap(this.clear, () => this.clearing.tap());
    this.element = el(
      "div",
      { className: "kami-island kami-toolbar", attrs: { role: "toolbar", "aria-label": "Tools" } },
      [...this.buttons.values(), this.clear],
    );
  }

  show(inForce: Tool): void {
    for (const [tool, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(tool === inForce));
    }
  }

  private showClearArmed(armed: boolean): void {
    const label = armed ? CLEAR_CONFIRM_LABEL : CLEAR_LABEL;
    this.clear.classList.toggle(CONFIRMING_CLASS, armed);
    this.clear.setAttribute("aria-label", label);
    this.clear.title = label;
  }
}
