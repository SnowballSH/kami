import type { Tool } from "./types";

export type ToolChangeSource = "player" | "game";

export type ToolChangeListener = (tool: Tool, source: ToolChangeSource) => void;

export const DEFAULT_TOOL: Tool = "draw";

const TEMPORARY_PAN: Tool = "pan";

/** The tool in force is the picked one, unless Space is holding the pan tool over it. */
export class ToolSelection {
  private readonly onChange: ToolChangeListener;
  private picked: Tool = DEFAULT_TOOL;
  private panHeld = false;

  constructor(onChange: ToolChangeListener) {
    this.onChange = onChange;
  }

  get inForce(): Tool {
    return this.panHeld ? TEMPORARY_PAN : this.picked;
  }

  pick(tool: Tool): void {
    this.change("player", () => {
      this.picked = tool;
    });
  }

  reflect(tool: Tool): void {
    const echoesHeldPan = this.panHeld && tool === TEMPORARY_PAN;
    if (echoesHeldPan) return;
    this.change("game", () => {
      this.picked = tool;
    });
  }

  holdPan(): void {
    this.change("player", () => {
      this.panHeld = true;
    });
  }

  releasePan(): void {
    this.change("player", () => {
      this.panHeld = false;
    });
  }

  private change(source: ToolChangeSource, mutate: () => void): void {
    const before = this.inForce;
    mutate();
    if (this.inForce !== before) this.onChange(this.inForce, source);
  }
}
