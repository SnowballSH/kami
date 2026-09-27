import { iconButton } from "./controls";
import { el } from "./dom";
import { Popover } from "./popover";
import type { QrPainter } from "./qr";
import { activateOnTap } from "./tap";
import type { Detach, ShareInfo } from "./types";

const OPEN_LABEL = "Share this page";
const COPY_LABEL = "copy link";
const COPIED_LABEL = "copied";
const COPIED_FOR_MS = 1600;

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
  private readonly qr = el("canvas", { className: "kami-share-qr" });
  private readonly link = el("a", { className: "kami-share-link", attrs: { target: "_blank" } });
  private readonly page = el("span", { className: "kami-share-page" });
  private readonly company = el("span", { className: "kami-share-company" });
  private readonly copy = el("button", {
    className: "kami-menu-item kami-share-copy",
    text: COPY_LABEL,
    attrs: { type: "button" },
  });
  private readonly popover: Popover;
  private share: ShareInfo | null = null;
  private copiedUntil: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly paintQr: QrPainter,
    private readonly copyText: CopyText = clipboardCopy,
  ) {
    const toggle = iconButton({
      className: "kami-share-toggle",
      icon: "share",
      label: OPEN_LABEL,
      attrs: { "aria-haspopup": "dialog" },
    });
    activateOnTap(this.copy, () => void this.copyLink());
    const panel = el(
      "div",
      {
        className: "kami-island kami-share-popover",
        attrs: { role: "dialog", "aria-label": OPEN_LABEL },
      },
      [this.qr, this.page, this.link, this.company, this.copy],
    );
    this.element = el("div", { className: "kami-share" }, [toggle, panel]);
    this.popover = new Popover(this.element, toggle, panel);
    this.show(null);
  }

  get open(): boolean {
    return this.popover.open;
  }

  attach(owner: Document): Detach {
    return this.popover.attach(owner);
  }

  show(share: ShareInfo | null): void {
    const linkChanged = share?.link !== this.share?.link;
    this.share = share;
    this.element.hidden = share === null;
    if (share === null) {
      this.popover.setOpen(false);
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
}
