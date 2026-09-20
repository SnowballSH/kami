import { createRemoteStick } from "../controller";
import type { Vec } from "../core/geometry";
import type { ModeCard, RoomCard } from "../modes/types";
import type { PersistenceState } from "../persistence/types";
import { BoardMenu } from "./boardMenu";
import { el } from "./dom";
import { Joystick } from "./joystick";
import { KeyboardWalk } from "./keyboard";
import { homeUrl, PageActions } from "./pageActions";
import { PersistenceStatus } from "./persistenceStatus";
import { paintQr } from "./qr";
import { RoomCardView } from "./roomCard";
import { SharePanel } from "./sharePanel";
import { TalkButton } from "./talkButton";
import { TextPrompt } from "./textPrompt";
import { TidySlider } from "./tidySlider";
import { TitleCard } from "./titleCard";
import { Toolbar } from "./toolbar";
import { ToolHotkeys } from "./toolHotkeys";
import { ToolSelection } from "./toolSelection";
import { installTouchGuards } from "./touchGuards";
import type { BoardListing, Detach, Hud, HudHandlers, ShareInfo, Tool } from "./types";
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
  private readonly talk: TalkButton;
  private readonly tidy: TidySlider;
  private readonly roomCard = new RoomCardView();
  private readonly share = new SharePanel(paintQr);
  private readonly page: PageActions;
  private readonly card = new TitleCard();
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
    this.toolbar = new Toolbar(
      (tool) => this.tools.pick(tool),
      () => handlers.onClearBoard(),
    );
    this.toolbar.show(this.tools.inForce);
    this.boards = new BoardMenu(handlers);
    this.page = new PageActions(() => host.location.assign(homeUrl(host.location)));
    this.persistence = new PersistenceStatus(() => handlers.onRetryPersistence());
    this.boards.element.append(this.persistence.element);
    this.prompt = new TextPrompt(host);
    this.stick = new Joystick(walk.source());
    this.talk = new TalkButton(handlers);
    this.tidy = new TidySlider((tidiness) => handlers.onTidinessChanged(tidiness));
    const remoteStick = createRemoteStick(walk.source());
    this.overlay.append(
      el("div", { className: "kami-top-left" }, [
        this.page.element,
        this.boards.element,
        this.share.element,
      ]),
      this.card.element,
      this.toolbar.element,
      this.stick.element,
      this.talk.element,
      this.tidy.element,
      this.zoom.element,
      this.prompt.element,
      this.prompt.feedback,
      this.roomCard.mark,
      this.roomCard.card,
    );
    root.append(this.overlay);
    this.detachers = [
      new KeyboardWalk(walk.source()).attach(host),
      ...(remoteStick === null ? [] : [remoteStick.attach()]),
      this.stick.attach(host),
      this.talk.attach(host),
      new ToolHotkeys(this.tools).attach(host),
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

  setTidiness(tidiness: number): void {
    this.tidy.setValue(tidiness);
  }

  setTool(tool: Tool): void {
    this.tools.reflect(tool);
  }

  setBoards(boards: readonly BoardListing[], currentId: string): void {
    this.boards.setBoards(boards, currentId);
  }

  setPersistence(state: PersistenceState): void {
    this.persistence.show(state);
  }

  showRoomCard(card: RoomCard | null): void {
    this.roomCard.show(card);
  }

  promptText(client: Vec): Promise<string | null> {
    return this.prompt.ask(client);
  }

  setListening(listening: boolean): void {
    this.talk.setListening(listening);
  }

  setWaking(waking: boolean): void {
    this.talk.setWaking(waking);
  }

  /** A shared page has one menu, the share affordance; the board menu stands aside for it. */
  setShare(share: ShareInfo | null): void {
    this.share.show(share);
    this.boards.element.hidden = share !== null;
  }

  showTitleCard(card: ModeCard): void {
    this.card.show(card);
  }

  dispose(): void {
    for (const detach of this.detachers) detach();
    this.overlay.remove();
  }
}
