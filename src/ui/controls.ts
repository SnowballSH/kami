import { ArmedTap } from "./armedTap";
import { el } from "./dom";
import { type IconName, icon } from "./icons";
import { activateOnTap } from "./tap";

export interface IconButtonOptions {
  readonly label: string;
  readonly className: string;
  readonly icon: IconName;
  readonly onTap?: () => void;
  /** Shown after the icon, such as a hotkey badge. */
  readonly extras?: readonly Node[];
  readonly attrs?: Readonly<Record<string, string>>;
}

export const iconButton = (options: IconButtonOptions): HTMLButtonElement => {
  const button = el(
    "button",
    {
      className: `kami-control ${options.className}`,
      attrs: {
        type: "button",
        "aria-label": options.label,
        title: options.label,
        ...options.attrs,
      },
    },
    [icon(options.icon), ...(options.extras ?? [])],
  );
  const { onTap } = options;
  if (onTap !== undefined) activateOnTap(button, onTap);
  return button;
};

export interface ArmedButtonOptions {
  readonly className: string;
  readonly icon: IconName;
  readonly label: string;
  /** The label while armed, waiting for the second tap. */
  readonly confirmLabel: string;
  /** A few words shown beside the button while armed. */
  readonly hint: string;
  readonly onConfirm: () => void;
}

const CONFIRMING_CLASS = "is-confirming";

/** An icon button for a destructive action: the first tap arms it, the second does it. */
export class ArmedIconButton {
  readonly element: HTMLButtonElement;
  private readonly tapping: ArmedTap;

  constructor({ className, icon, label, confirmLabel, hint, onConfirm }: ArmedButtonOptions) {
    this.element = iconButton({
      className,
      icon,
      label,
      extras: [
        el("span", { className: "kami-armed-hint", text: hint, attrs: { "aria-hidden": "true" } }),
      ],
      onTap: () => this.tapping.tap(),
    });
    this.tapping = new ArmedTap(onConfirm, (armed) => {
      const shown = armed ? confirmLabel : label;
      this.element.classList.toggle(CONFIRMING_CLASS, armed);
      this.element.setAttribute("aria-label", shown);
      this.element.title = shown;
    });
  }

  disarm(): void {
    this.tapping.disarm();
  }
}
