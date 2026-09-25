import { el } from "./dom";
import { type IconName, icon } from "./icons";
import { activateOnTap } from "./tap";

const HOME_LABEL = "Back to the start";
const SIGN_OUT_LABEL = "Sign out";
const SIGN_OUT_FAILED_LABEL = "Sign-out failed — tap to retry";

/** The address of the start screen: this page with nothing said about mode, board or stage. */
export const homeUrl = (location: Pick<Location, "origin" | "pathname">): string =>
  `${location.origin}${location.pathname}`;

export interface PageActionHandlers {
  goHome(): void;
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

/** What every mode offers beside whichever menu it shows: the way back to the start, and out. */
export class PageActions {
  readonly element: HTMLElement;

  constructor(handlers: PageActionHandlers) {
    const home = actionButton("kami-page-home", HOME_LABEL, "home");
    activateOnTap(home, () => handlers.goHome());
    this.element = el("div", { className: "kami-island kami-page-actions" }, [home]);
    if (handlers.signOut !== undefined) this.element.append(this.signOutButton(handlers));
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
