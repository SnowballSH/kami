import { ArmedIconButton, iconButton } from "./controls";
import { el } from "./dom";

const SIGN_OUT_LABEL = "Sign out";
const SIGN_OUT_FAILED_LABEL = "Sign-out failed — tap to retry";

/** The address of the start screen: this page with nothing said about mode, board or stage. */
export const homeUrl = (location: Pick<Location, "origin" | "pathname">): string =>
  `${location.origin}${location.pathname}`;

export interface PageActionHandlers {
  goHome(): void;
  /** Back to the first room of a staged run; offered only while `showRestart(true)`. */
  restartRun(): void;
  /** Ends the token session, resolving once it has; without it the island offers no sign-out. */
  readonly signOut?: () => Promise<void>;
  /** After a sign-out: back through the access gate. */
  signedOut(): void;
}

/**
 * What every mode offers beside whichever menu it shows: the way back to the start, a staged run's
 * way back to its first room (two taps), and out.
 */
export class PageActions {
  readonly element: HTMLElement;
  private readonly restart: ArmedIconButton;

  constructor(handlers: PageActionHandlers) {
    const home = iconButton({
      className: "kami-page-home",
      icon: "home",
      label: "Back to the start",
      onTap: () => handlers.goHome(),
    });
    this.restart = new ArmedIconButton({
      className: "kami-page-restart",
      icon: "restart",
      label: "Start the run over",
      confirmLabel: "Tap again to start the run over",
      hint: "tap again to start over",
      onConfirm: () => handlers.restartRun(),
    });
    this.showRestart(false);
    this.element = el("div", { className: "kami-island kami-page-actions" }, [
      home,
      this.restart.element,
    ]);
    const { signOut } = handlers;
    if (signOut !== undefined)
      this.element.append(signOutButton(signOut, () => handlers.signedOut()));
  }

  showRestart(shown: boolean): void {
    this.restart.element.hidden = !shown;
    this.restart.disarm();
  }
}

const signOutButton = (signOut: () => Promise<void>, signedOut: () => void): HTMLButtonElement => {
  const button = iconButton({
    className: "kami-page-sign-out",
    icon: "signOut",
    label: SIGN_OUT_LABEL,
    onTap: () => {
      if (button.disabled) return;
      button.disabled = true;
      signOut().then(signedOut, () => {
        button.setAttribute("aria-label", SIGN_OUT_FAILED_LABEL);
        button.title = SIGN_OUT_FAILED_LABEL;
        button.disabled = false;
      });
    },
  });
  return button;
};
