import type { Vec } from "../core/geometry";
import type { WalkIntent } from "../sim/types";

export interface HudHandlers {
  onWalkIntent(intent: WalkIntent): void;
  /** A guess chip was tapped or a name was typed and submitted. */
  onNameChosen(name: string): void;
  onNamingDismissed(): void;
  onAskCat(): void;
  onEraserToggled(active: boolean): void;
  onResetRoom(): void;
}

export interface TitleCard {
  readonly title: string;
  readonly subtitle?: string;
  readonly durationMs: number;
}

export interface EndingEntry {
  readonly name: string;
  readonly thumbnail: HTMLCanvasElement;
}

export interface Hud {
  readonly namingOpen: boolean;
  setRoom(title: string, pageNumber: number, pageCount: number): void;
  setInk(budget: { readonly total: number; readonly remaining: number }): void;
  /** Opens the naming panel: three guess chips, a typed box, and a "just ink" way out. */
  showNaming(guesses: readonly string[]): void;
  hideNaming(): void;
  /** The Cat's grin fades in, the line is captioned, and spoken if the device can. */
  say(line: string): void;
  setEraserActive(active: boolean): void;
  /** Covers the page, resolves once the card has faded back out. */
  showTitleCard(card: TitleCard): Promise<void>;
  showEnding(entries: readonly EndingEntry[], onRestart: () => void): void;
  hideEnding(): void;
}

export interface PenSink {
  penDown(point: Vec): void;
  penMove(point: Vec): void;
  penUp(): void;
}

export type Detach = () => void;
