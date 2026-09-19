import { el } from "./dom";
import { type IconName, icon } from "./icons";

export interface IconButtonOptions {
  readonly label: string;
  readonly className: string;
  readonly icon: IconName;
  onClick(): void;
}

export const iconButton = (options: IconButtonOptions): HTMLButtonElement => {
  const button = el(
    "button",
    {
      className: `kami-control ${options.className}`,
      attrs: { type: "button", "aria-label": options.label, title: options.label },
    },
    [icon(options.icon)],
  );
  button.addEventListener("click", () => options.onClick());
  return button;
};
