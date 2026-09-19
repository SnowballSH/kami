import { el } from "./dom";
import { type IconName, icon } from "./icons";

export interface ToggleOptions {
  readonly label: string;
  readonly className: string;
  readonly icons: { readonly off: IconName; readonly on: IconName };
  onToggle(pressed: boolean): void;
}

export const iconButton = (
  label: string,
  className: string,
  iconName: IconName,
  onClick: () => void,
): HTMLButtonElement => {
  const button = el(
    "button",
    { className: `kami-button kami-icon-button ${className}`, attrs: { type: "button" } },
    [icon(iconName)],
  );
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", onClick);
  return button;
};

export class ToggleButton {
  readonly element: HTMLButtonElement;
  private readonly icons: ToggleOptions["icons"];

  constructor(options: ToggleOptions) {
    this.icons = options.icons;
    this.element = iconButton(options.label, options.className, options.icons.off, () => {
      this.set(!this.pressed);
      options.onToggle(this.pressed);
    });
    this.set(false);
  }

  get pressed(): boolean {
    return this.element.getAttribute("aria-pressed") === "true";
  }

  set(pressed: boolean): void {
    this.element.setAttribute("aria-pressed", String(pressed));
    this.element.replaceChildren(icon(pressed ? this.icons.on : this.icons.off));
  }
}
