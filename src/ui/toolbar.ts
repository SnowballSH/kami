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

export const HINT_HOTKEY = "?";

export interface ToolbarActions {
  pick(tool: Tool): void;
  clear(): void;
  askForHint(): void;
}

const hotkeyBadge = (hotkey: string): HTMLElement =>
  el("span", { className: "kami-tool-hotkey", text: hotkey.toUpperCase() });

const createToolButton = (spec: ToolSpec, onPick: (tool: Tool) => void): HTMLButtonElement => {
  const label = `${spec.label} (${spec.hotkey.toUpperCase()})`;
  const button = el(
    "button",
    {
      className: `kami-control kami-tool kami-tool-${spec.tool}`,
      attrs: { type: "button", "aria-label": label, "aria-pressed": "false", title: label },
    },
    [icon(spec.icon), hotkeyBadge(spec.hotkey)],
  );
  activateOnTap(button, () => onPick(spec.tool));
  return button;
};

const HINT_LABEL = `Ask the Cat for a hint (${HINT_HOTKEY})`;

const createHintButton = (onAsk: () => void): HTMLButtonElement => {
  const button = el(
    "button",
    {
      className: "kami-control kami-ask-cat",
      attrs: { type: "button", "aria-label": HINT_LABEL, title: HINT_LABEL },
    },
    [icon("cat"), hotkeyBadge(HINT_HOTKEY)],
  );
  activateOnTap(button, onAsk);
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

  constructor(actions: ToolbarActions) {
    this.buttons = new Map(
      TOOL_SPECS.map((spec) => [
        spec.tool,
        createToolButton(spec, (tool) => {
          this.clearing.disarm();
          actions.pick(tool);
        }),
      ]),
    );
    const hint = createHintButton(() => {
      this.clearing.disarm();
      actions.askForHint();
    });
    this.clear = el(
      "button",
      {
        className: "kami-control kami-clear-page",
        attrs: { type: "button", "aria-label": CLEAR_LABEL, title: CLEAR_LABEL },
      },
      [
        icon("clear"),
        el("span", {
          className: "kami-armed-hint",
          text: "tap again to clear",
          attrs: { "aria-hidden": "true" },
        }),
      ],
    );
    this.clearing = new ArmedTap(
      () => actions.clear(),
      (armed) => this.showClearArmed(armed),
    );
    activateOnTap(this.clear, () => this.clearing.tap());
    this.element = el(
      "div",
      { className: "kami-island kami-toolbar", attrs: { role: "toolbar", "aria-label": "Tools" } },
      [...this.buttons.values(), hint, this.clear],
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
