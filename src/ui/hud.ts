import { createRemoteStick } from "../controller";
import type { Vec } from "../core/geometry";
import { BoardMenu } from "./boardMenu";
import { el } from "./dom";
import { Joystick } from "./joystick";
import { KeyboardWalk } from "./keyboard";
import { TextPrompt } from "./textPrompt";
import { Toolbar } from "./toolbar";
import { ToolHotkeys } from "./toolHotkeys";
import { ToolSelection } from "./toolSelection";
import { installTouchGuards } from "./touchGuards";
import type { BoardListing, Detach, Hud, HudHandlers, Tool } from "./types";
import { WalkIntentMerger } from "./walkIntent";
import { ZoomControls } from "./zoomControls";

export class DomHud implements Hud {
  private readonly zoom: ZoomControls;
  private readonly overlay = el("div", { className: "kami-hud" });
  private readonly tools: ToolSelection;
  private readonly toolbar: Toolbar;
  private readonly boards: BoardMenu;
  private readonly prompt: TextPrompt;
  private readonly stick: Joystick;
  private readonly detachers: readonly Detach[];

  constructor(root: HTMLElement, handlers: HudHandlers) {
    this.zoom = new ZoomControls(handlers);
    const owner = root.ownerDocument;
    const host = owner.defaultView ?? window;
    const walk = new WalkIntentMerger((intent) => handlers.onWalkIntent(intent));
    this.tools = new ToolSelection((tool, source) => {
      this.toolbar.show(tool);
      if (source === "player") handlers.onToolChanged(tool);
    });
    this.toolbar = new Toolbar((tool) => this.tools.pick(tool));
    this.toolbar.show(this.tools.inForce);
    this.boards = new BoardMenu(handlers);
    this.prompt = new TextPrompt(host);
    this.stick = new Joystick(walk.source());
    const remoteStick = createRemoteStick(walk.source());
    this.overlay.append(
      this.boards.element,
      this.toolbar.element,
      this.stick.element,
      this.zoom.element,
      this.prompt.element,
      this.prompt.feedback,
    );
    root.append(this.overlay);
    this.detachers = [
      new KeyboardWalk(walk.source()).attach(host),
      ...(remoteStick === null ? [] : [remoteStick.attach()]),
      this.stick.attach(host),
      new ToolHotkeys(this.tools).attach(host),
      this.boards.attach(owner),
      this.prompt.attach(),
      installTouchGuards(owner),
    ];
  }

  setAutopilot(enabled: boolean): void {
    this.zoom.setAutopilot(enabled);
  }

  setTool(tool: Tool): void {
    this.tools.reflect(tool);
  }

  setBoards(boards: readonly BoardListing[], currentId: string): void {
    this.boards.setBoards(boards, currentId);
  }

  promptText(client: Vec): Promise<string | null> {
    return this.prompt.ask(client);
  }

  dispose(): void {
    for (const detach of this.detachers) detach();
    this.overlay.remove();
  }
}
