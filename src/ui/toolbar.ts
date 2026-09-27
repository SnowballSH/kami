import { ArmedIconButton, iconButton } from "./controls";
import { el } from "./dom";
import { HINT_HOTKEY } from "./hotkeys";
import type { IconName } from "./icons";
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

export interface ToolbarActions {
  pick(tool: Tool): void;
  clear(): void;
  askForHint(): void;
}

const HINT_LABEL = `Ask the Cat for a hint (${HINT_HOTKEY})`;

const hotkeyBadge = (hotkey: string): HTMLElement =>
  el("span", { className: "kami-tool-hotkey", text: hotkey.toUpperCase() });

export class Toolbar {
  readonly element: HTMLElement;
  private readonly buttons: ReadonlyMap<Tool, HTMLButtonElement>;
  private readonly clear: ArmedIconButton;

  constructor(actions: ToolbarActions) {
    this.clear = new ArmedIconButton({
      className: "kami-clear-page",
      icon: "clear",
      label: "Clear the page",
      confirmLabel: "Tap again to clear the page",
      hint: "tap again to clear",
      onConfirm: () => actions.clear(),
    });
    this.buttons = new Map(
      TOOL_SPECS.map(({ tool, label, hotkey, icon }) => [
        tool,
        iconButton({
          className: `kami-tool kami-tool-${tool}`,
          icon,
          label: `${label} (${hotkey.toUpperCase()})`,
          attrs: { "aria-pressed": "false" },
          extras: [hotkeyBadge(hotkey)],
          onTap: () => {
            this.clear.disarm();
            actions.pick(tool);
          },
        }),
      ]),
    );
    const hint = iconButton({
      className: "kami-ask-cat",
      icon: "cat",
      label: HINT_LABEL,
      extras: [hotkeyBadge(HINT_HOTKEY)],
      onTap: () => {
        this.clear.disarm();
        actions.askForHint();
      },
    });
    this.element = el(
      "div",
      { className: "kami-island kami-toolbar", attrs: { role: "toolbar", "aria-label": "Tools" } },
      [...this.buttons.values(), hint, this.clear.element],
    );
  }

  show(inForce: Tool): void {
    for (const [tool, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(tool === inForce));
    }
  }
}
