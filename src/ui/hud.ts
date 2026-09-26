import { createRemoteStick } from "../controller";
import type { Vec } from "../core/geometry";
import type { ModeCard, RoomCard } from "../modes/types";
import type { PersistenceState } from "../persistence/types";
import { BoardMenu } from "./boardMenu";
import { el } from "./dom";
import { HintHotkey } from "./hintHotkey";
import { Joystick } from "./joystick";
import { KeyboardWalk } from "./keyboard";
import { homeUrl, PageActions } from "./pageActions";
import { PersistenceStatus } from "./persistenceStatus";
import { paintQr } from "./qr";
import { RoomCardView } from "./roomCard";
import { SharePanel } from "./sharePanel";
import { SpokenLines } from "./spokenLines";
import { TextPrompt } from "./textPrompt";
import { TidySlider } from "./tidySlider";
import { TitleCard } from "./titleCard";
import { Toolbar } from "./toolbar";
import { ToolHotkeys } from "./toolHotkeys";
import { ToolSelection } from "./toolSelection";
import { installTouchGuards } from "./touchGuards";
import type {
  BoardListing,
  Detach,
  Hud,
  HudHandlers,
  HudOptions,
  MenuKind,
  ShareInfo,
  Tool,
} from "./types";
import { UndoHotkey } from "./undoHotkey";
import { WalkIntentMerger } from "./walkIntent";
import { ZoomControls } from "./zoomControls";

export class DomHud implements Hud {
  private readonly zoom: ZoomControls;
  private readonly overlay = el("div", { className: "kami-hud" });
  private readonly tools: ToolSelection;
  private readonly toolbar: Toolbar;
  private readonly boards: BoardMenu;
  private readonly persistence: PersistenceStatus;
  private readonly prompt: TextPrompt;
  private readonly stick: Joystick;
  private readonly tidy: TidySlider;
  private readonly roomCard = new RoomCardView();
  private readonly share = new SharePanel(paintQr);
  private readonly page: PageActions;
  private readonly card = new TitleCard();
  private readonly spoken: SpokenLines;
  private readonly detachers: readonly Detach[];
  private menu: MenuKind = "boards";
  private shared = false;

  constructor(root: HTMLElement, handlers: HudHandlers, options: HudOptions = {}) {
    this.zoom = new ZoomControls(handlers);
    const owner = root.ownerDocument;
    const host = owner.defaultView ?? window;
    this.spoken = new SpokenLines(() => host.performance.now());
    const walk = new WalkIntentMerger((intent) => handlers.onWalkIntent(intent));
    this.tools = new ToolSelection((tool, source) => {
      this.toolbar.show(tool);
      if (source === "player") handlers.onToolChanged(tool);
    });
    this.toolbar = new Toolbar({
      pick: (tool) => this.tools.pick(tool),
      clear: () => handlers.onClearBoard(),
      askForHint: () => handlers.onAskForHint(),
    });
    this.toolbar.show(this.tools.inForce);
    this.boards = new BoardMenu(handlers);
    this.page = new PageActions({
      goHome: () => host.location.assign(homeUrl(host.location)),
      restartRun: () => handlers.onRestartRun(),
      signedOut: () => host.location.reload(),
      ...(options.signOut === undefined ? {} : { signOut: options.signOut }),
    });
    this.persistence = new PersistenceStatus(() => handlers.onRetryPersistence());
    this.prompt = new TextPrompt(host);
    this.stick = new Joystick(walk.source());
    this.tidy = new TidySlider((tidiness) => handlers.onTidinessChanged(tidiness));
    const remoteStick = createRemoteStick(walk.source(), () => handlers.onAskForHint());
    this.overlay.append(
      el("div", { className: "kami-top-left" }, [
        el("div", { className: "kami-top-left-row" }, [
          this.page.element,
          this.boards.element,
          this.share.element,
        ]),
        this.persistence.element,
      ]),
      this.card.element,
      this.toolbar.element,
      this.stick.element,
      this.tidy.element,
      this.zoom.element,
      this.prompt.element,
      this.prompt.feedback,
      this.roomCard.mark,
      this.roomCard.card,
      this.spoken.element,
    );
    root.append(this.overlay);
    this.detachers = [
      new KeyboardWalk(walk.source()).attach(host),
      ...(remoteStick === null ? [] : [remoteStick.attach()]),
      this.stick.attach(host),
      new ToolHotkeys(this.tools).attach(host),
      new UndoHotkey(() => handlers.onUndo()).attach(host),
      new HintHotkey(() => handlers.onAskForHint()).attach(host),
      this.boards.attach(owner),
      this.share.attach(owner),
      this.prompt.attach(),
      installTouchGuards(owner),
    ];
  }

  toolbarBottom(): number {
    return this.toolbar.element.getBoundingClientRect().bottom;
  }

  setAutopilot(enabled: boolean): void {
    this.zoom.setAutopilot(enabled);
  }

  offerAutopilot(offered: boolean): void {
    this.zoom.offerAutopilot(offered);
  }

  setTidiness(tidiness: number): void {
    this.tidy.setValue(tidiness);
  }

  setTool(tool: Tool): void {
    this.tools.reflect(tool);
  }

  setBoards(boards: readonly BoardListing[], currentId: string): void {
    this.boards.setBoards(boards, currentId);
  }

  setPersistence(state: PersistenceState | null): void {
    this.persistence.show(state);
  }

  showRoomCard(card: RoomCard | null): void {
    this.roomCard.show(card);
  }

  promptText(client: Vec): Promise<string | null> {
    return this.prompt.ask(client);
  }

  /** A shared page has one menu, the share affordance; the board menu stands aside for it. */
  setShare(share: ShareInfo | null): void {
    this.share.show(share);
    this.shared = share !== null;
    this.showMenu();
  }

  setMenu(menu: MenuKind): void {
    this.menu = menu;
    this.showMenu();
  }

  private showMenu(): void {
    this.boards.element.hidden = this.shared || this.menu === "run";
    this.page.showRestart(this.menu === "run");
  }

  showTitleCard(card: ModeCard): void {
    this.card.show(card);
  }

  announce(line: string): void {
    this.spoken.say(line);
  }

  dispose(): void {
    for (const detach of this.detachers) detach();
    this.overlay.remove();
  }
}
