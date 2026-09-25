import { ArmedTap } from "./armedTap";
import { el } from "./dom";
import { type IconName, icon } from "./icons";
import { activateOnTap } from "./tap";

const HOME_LABEL = "Back to the start";
const RESTART_LABEL = "Start the run over";
const RESTART_CONFIRM_LABEL = "Tap again to start the run over";
const CONFIRMING_CLASS = "is-confirming";
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

const actionButton = (className: string, label: string, name: IconName): HTMLButtonElement =>
  el(
    "button",
    {
      className: `kami-control ${className}`,
      attrs: { type: "button", "aria-label": label, title: label },
    },
    [icon(name)],
  );

/**
 * What every mode offers beside whichever menu it shows: the way back to the start, a staged run's
 * way back to its first room (two taps), and out.
 */
export class PageActions {
  readonly element: HTMLElement;
  private readonly restart: HTMLButtonElement;
  private readonly restarting: ArmedTap;

  constructor(handlers: PageActionHandlers) {
    const home = actionButton("kami-page-home", HOME_LABEL, "home");
    activateOnTap(home, () => handlers.goHome());
    this.restart = actionButton("kami-page-restart", RESTART_LABEL, "restart");
    this.restart.append(
      el("span", {
        className: "kami-armed-hint",
        text: "tap again to start over",
        attrs: { "aria-hidden": "true" },
      }),
    );
    this.restarting = new ArmedTap(
      () => handlers.restartRun(),
      (armed) => this.showRestartArmed(armed),
    );
    activateOnTap(this.restart, () => this.restarting.tap());
    this.showRestart(false);
    this.element = el("div", { className: "kami-island kami-page-actions" }, [home, this.restart]);
    if (handlers.signOut !== undefined) this.element.append(this.signOutButton(handlers));
  }

  showRestart(shown: boolean): void {
    this.restart.hidden = !shown;
    this.restarting.disarm();
  }

  private showRestartArmed(armed: boolean): void {
    const label = armed ? RESTART_CONFIRM_LABEL : RESTART_LABEL;
    this.restart.classList.toggle(CONFIRMING_CLASS, armed);
    this.restart.setAttribute("aria-label", label);
    this.restart.title = label;
  }

  private signOutButton({ signOut, signedOut }: PageActionHandlers): HTMLButtonElement {
    const button = actionButton("kami-page-sign-out", SIGN_OUT_LABEL, "signOut");
    activateOnTap(button, () => {
      if (button.disabled || signOut === undefined) return;
      button.disabled = true;
      signOut().then(signedOut, () => {
        button.setAttribute("aria-label", SIGN_OUT_FAILED_LABEL);
        button.title = SIGN_OUT_FAILED_LABEL;
        button.disabled = false;
      });
    });
    return button;
  }
}
