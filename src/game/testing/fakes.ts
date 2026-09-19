import type { Vec } from "../../core/geometry";
import type { Drawing } from "../../ink/types";
import type { Renderer, RenderFrame } from "../../render/types";
import type { EndingEntry, Hud, HudHandlers, TitleCard } from "../../ui/types";
import type { LevelDefinition } from "../types";

export class FakeHud implements Hud {
  readonly said: string[] = [];
  readonly rooms: string[] = [];
  readonly cards: TitleCard[] = [];
  guesses: readonly string[] | null = null;
  ending: readonly EndingEntry[] | null = null;
  restart: (() => void) | null = null;
  eraserActive = false;
  ink = { total: 0, remaining: 0 };

  constructor(readonly handlers: HudHandlers) {}

  get namingOpen(): boolean {
    return this.guesses !== null;
  }

  setRoom(title: string): void {
    this.rooms.push(title);
  }

  setInk(budget: { readonly total: number; readonly remaining: number }): void {
    this.ink = { ...budget };
  }

  showNaming(guesses: readonly string[]): void {
    this.guesses = guesses;
  }

  hideNaming(): void {
    this.guesses = null;
  }

  say(line: string): void {
    this.said.push(line);
  }

  setEraserActive(active: boolean): void {
    this.eraserActive = active;
  }

  showTitleCard(card: TitleCard): Promise<void> {
    this.cards.push(card);
    return Promise.resolve();
  }

  showEnding(entries: readonly EndingEntry[], onRestart: () => void): void {
    this.ending = entries;
    this.restart = onRestart;
  }

  hideEnding(): void {
    this.ending = null;
  }
}

export class FakeRenderer implements Renderer {
  readonly levels: LevelDefinition[] = [];
  lastFrame: RenderFrame | null = null;

  setLevel(level: LevelDefinition): void {
    this.levels.push(level);
  }

  resize(): void {}

  toWorld(clientX: number, clientY: number): Vec {
    return { x: clientX, y: clientY };
  }

  render(frame: RenderFrame): void {
    this.lastFrame = frame;
  }

  thumbnail(_drawing: Drawing, sizePx: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;
    return canvas;
  }
}
