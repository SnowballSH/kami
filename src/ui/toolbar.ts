import { el } from "./dom";
import { type IconName, icon } from "./icons";
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
  button.addEventListener("click", () => onPick(spec.tool));
  return button;
};

export class Toolbar {
  readonly element: HTMLElement;
  private readonly buttons: ReadonlyMap<Tool, HTMLButtonElement>;

  constructor(onPick: (tool: Tool) => void) {
    this.buttons = new Map(TOOL_SPECS.map((spec) => [spec.tool, createToolButton(spec, onPick)]));
    this.element = el(
      "div",
      { className: "kami-island kami-toolbar", attrs: { role: "toolbar", "aria-label": "Tools" } },
      [...this.buttons.values()],
    );
  }

  show(inForce: Tool): void {
    for (const [tool, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(tool === inForce));
    }
  }
}
