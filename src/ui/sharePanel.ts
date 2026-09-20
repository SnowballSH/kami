import { el } from "./dom";
import { icon } from "./icons";
import type { QrPainter } from "./qr";
import { activateOnTap } from "./tap";
import type { Detach, ShareInfo } from "./types";

const OPEN_LABEL = "Share this page";
const COPY_LABEL = "copy link";
const COPIED_LABEL = "copied";
const COPIED_FOR_MS = 1600;
const CLOSE_KEY = "Escape";

const companyLine = (company: number): string =>
  company === 0
    ? "Only you here so far."
    : company === 1
      ? "One other on this page."
      : `${company} others on this page.`;

export type CopyText = (text: string) => Promise<void>;

const clipboardCopy: CopyText = (text) => navigator.clipboard.writeText(text);

/**
 * The one affordance a shared page needs: a button that opens the QR code and link another device
 * scans or types to draw on the same page. Hidden on pages that are not shared.
 */
export class SharePanel {
  readonly element: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private readonly qr = el("canvas", { className: "kami-share-qr" });
  private readonly link = el("a", { className: "kami-share-link", attrs: { target: "_blank" } });
  private readonly page = el("span", { className: "kami-share-page" });
  private readonly company = el("span", { className: "kami-share-company" });
  private readonly copy: HTMLButtonElement;
  private share: ShareInfo | null = null;
  private copiedUntil: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly paintQr: QrPainter,
    private readonly copyText: CopyText = clipboardCopy,
  ) {
    this.toggle = el(
      "button",
      {
        className: "kami-control kami-share-toggle",
        attrs: { type: "button", "aria-haspopup": "dialog", "aria-label": OPEN_LABEL },
      },
      [icon("share")],
    );
    activateOnTap(this.toggle, () => this.setOpen(!this.open));
    this.copy = el("button", {
      className: "kami-menu-item kami-share-copy",
      text: COPY_LABEL,
      attrs: { type: "button" },
    });
    activateOnTap(this.copy, () => void this.copyLink());
    this.popover = el(
      "div",
      {
        className: "kami-island kami-share-popover",
        attrs: { role: "dialog", "aria-label": OPEN_LABEL },
      },
      [this.qr, this.page, this.link, this.company, this.copy],
    );
    this.element = el("div", { className: "kami-share" }, [this.toggle, this.popover]);
    this.setOpen(false);
    this.show(null);
  }

  get open(): boolean {
    return !this.popover.hidden;
  }

  attach(owner: Document): Detach {
    const listeners = new AbortController();
    const options = { signal: listeners.signal, capture: true };
    owner.addEventListener("pointerdown", (event) => this.closeIfOutside(event.target), options);
    owner.addEventListener(
      "keydown",
      (event) => {
        if (event.key === CLOSE_KEY) this.setOpen(false);
      },
      options,
    );
    return () => listeners.abort();
  }

  show(share: ShareInfo | null): void {
    const linkChanged = share?.link !== this.share?.link;
    this.share = share;
    this.element.hidden = share === null;
    if (share === null) {
      this.setOpen(false);
      return;
    }
    this.company.textContent = companyLine(share.company);
    if (!linkChanged) return;
    this.page.textContent = share.boardId;
    this.link.textContent = share.link;
    this.link.href = share.link;
    void this.paintQr(this.qr, share.link).catch(() => {});
  }

  private async copyLink(): Promise<void> {
    if (this.share === null) return;
    try {
      await this.copyText(this.share.link);
    } catch {
      return;
    }
    this.copy.textContent = COPIED_LABEL;
    if (this.copiedUntil !== null) clearTimeout(this.copiedUntil);
    this.copiedUntil = setTimeout(() => {
      this.copy.textContent = COPY_LABEL;
      this.copiedUntil = null;
    }, COPIED_FOR_MS);
  }

  private setOpen(open: boolean): void {
    this.popover.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
  }

  private closeIfOutside(target: EventTarget | null): void {
    if (!this.open) return;
    if (target instanceof Node && this.element.contains(target)) return;
    this.setOpen(false);
  }
}
