import { iconButton, ToggleButton } from "./buttons";
import { el } from "./dom";
import { InkMeter } from "./inkMeter";

export interface TopBarHandlers {
  onEraserToggled(active: boolean): void;
  onResetRoom(): void;
  onAskCat(): void;
  onMuteToggled(muted: boolean): void;
}

export const pageLabel = (pageNumber: number, pageCount: number): string =>
  `page ${pageNumber} of ${pageCount}`;

export class TopBar {
  readonly element: HTMLElement;
  readonly inkMeter = new InkMeter();
  private readonly roomTitle = el("h2", { className: "kami-room-title" });
  private readonly roomPage = el("p", { className: "kami-room-page" });
  private readonly eraser: ToggleButton;

  constructor(handlers: TopBarHandlers) {
    this.eraser = new ToggleButton({
      label: "Eraser",
      className: "kami-eraser",
      icons: { off: "eraser", on: "eraser" },
      onToggle: (active) => handlers.onEraserToggled(active),
    });
    const mute = new ToggleButton({
      label: "Mute the Cat",
      className: "kami-mute",
      icons: { off: "sound", on: "muted" },
      onToggle: (muted) => handlers.onMuteToggled(muted),
    });
    this.element = el("header", { className: "kami-top" }, [
      el("div", { className: "kami-room kami-plate" }, [this.roomTitle, this.roomPage]),
      this.inkMeter.element,
      el("div", { className: "kami-tools" }, [
        this.eraser.element,
        iconButton("Reset room", "kami-reset", "reset", () => handlers.onResetRoom()),
        iconButton("Ask the Cat", "kami-ask", "cat", () => handlers.onAskCat()),
        mute.element,
      ]),
    ]);
  }

  setRoom(title: string, pageNumber: number, pageCount: number): void {
    this.roomTitle.textContent = title;
    this.roomPage.textContent = pageLabel(pageNumber, pageCount);
  }

  setEraserActive(active: boolean): void {
    this.eraser.set(active);
  }
}
