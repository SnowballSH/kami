import { createAutopilot } from "../autopilot";
import { boardFor } from "../board";
import { createCat } from "../cat";
import { createHandwriting } from "../handwriting";
import { createInkSession, findDrawingAt } from "../ink";
import { type GameMode, PUZZLE_MODE_ID } from "../modes";
import {
  type BoardStore,
  type Connection,
  createBoardStore,
  createHandwritingReader,
  createRemoteRuleCompiler,
  createRemoteSceneCompiler,
  createSketchCatalogue,
  guardUnsavedChanges,
} from "../persistence";
import { createPenReader } from "../reading";
import { createRecognizer } from "../recognition";
import { createRenderer } from "../render";
import { createRuleCompiler, createSceneCompiler, resolvePhysics } from "../rules";
import { createSimulation } from "../sim";
import { createStageSource, mirroredLaws, mirroredRenderer } from "../stage";
import { Summoner } from "../summoning";
import { createBoardLink } from "../sync";
import { attachCanvasInput, createHud, createLawsPanel } from "../ui";
import { ForgetfulBoardStore } from "./forgetfulStore";
import { DEFAULT_TIDINESS, Game } from "./game";
import { BOARD_PARAM, boardInUrl, modeInUrl, shareLink } from "./launch";

const AUTOPILOT_PARAM = "autopilot";
const AUTOPILOT_MEMORY = "kami.autopilot";
const ON = "on";

const remembered = (): string | null => {
  try {
    return window.localStorage.getItem(AUTOPILOT_MEMORY);
  } catch {
    return null;
  }
};

/**
 * The player walks Alice unless they ask otherwise: `?autopilot=on` (or `off`) wins, then whatever
 * they last chose on this device with the HUD switch. In the puzzle rooms she walks herself: the
 * player's part is the pen.
 */
const startsSelfDriving = (mode: GameMode): boolean =>
  (new URLSearchParams(window.location.search).get(AUTOPILOT_PARAM) ??
    (mode.id === PUZZLE_MODE_ID ? ON : remembered())) === ON;

const rememberSelfDriving = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(AUTOPILOT_MEMORY, enabled ? ON : "off");
  } catch {}
};

const TIDINESS_MEMORY = "kami.tidiness";

const rememberedTidiness = (): number => {
  try {
    const kept = Number.parseFloat(window.localStorage.getItem(TIDINESS_MEMORY) ?? "");
    return Number.isFinite(kept) ? kept : DEFAULT_TIDINESS;
  } catch {
    return DEFAULT_TIDINESS;
  }
};

const rememberTidiness = (tidiness: number): void => {
  try {
    window.localStorage.setItem(TIDINESS_MEMORY, String(tidiness));
  } catch {}
};

const rememberBoardInUrl = (boardId: string): void => {
  const url = new URL(window.location.href);
  url.searchParams.set(BOARD_PARAM, boardId);
  window.history.replaceState(null, "", url);
};

const storeFor = (mode: GameMode, connection: Connection): BoardStore =>
  connection.online && mode.id !== PUZZLE_MODE_ID ? createBoardStore() : new ForgetfulBoardStore();

/** Opens the chosen mode in `root`; without a server nothing is saved and nothing is shared. */
export function startGame(root: HTMLElement, connection: Connection): void {
  const canvas = document.createElement("canvas");
  root.prepend(canvas);
  const handwriting = createHandwriting();
  const stage = createStageSource();
  const renderer = mirroredRenderer(createRenderer(canvas, handwriting), stage);
  const mode = modeInUrl(window.location.search);
  const store = storeFor(mode, connection);
  guardUnsavedChanges(window, store);
  const recognizer = createRecognizer();
  const game = new Game(
    {
      sim: createSimulation(),
      autopilot: createAutopilot,
      cat: createCat(recognizer),
      finisher: recognizer,
      summoner: new Summoner(createSketchCatalogue(), recognizer),
      renderer,
      handwriting,
      compiler: createRuleCompiler(),
      thinker: createRemoteRuleCompiler(),
      scenes: createSceneCompiler(createRemoteSceneCompiler()),
      store,
      penReader: createPenReader(createHandwritingReader()),
      resolvePhysics,
      boardFor,
      createInkSession,
      createHud: (handlers) =>
        createHud(
          root,
          handlers,
          connection.signOut === undefined ? {} : { signOut: connection.signOut },
        ),
      createLawsPanel: (handlers) => mirroredLaws(createLawsPanel(root, handlers), stage),
      findDrawingAt,
      onBoardOpened: rememberBoardInUrl,
      ...(connection.online
        ? {
            link: createBoardLink(),
            shareLinkFor: (boardId: string) => shareLink(window.location.href, boardId, mode),
          }
        : {}),
      mode,
      selfDriving: startsSelfDriving(mode),
      onSelfDrivingChanged: rememberSelfDriving,
      tidiness: rememberedTidiness(),
      onTidinessChanged: rememberTidiness,
    },
    boardInUrl(window.location.search, mode),
  );

  attachCanvasInput(canvas, () => game.currentTool, game);
  new ResizeObserver(() => {
    renderer.resize();
    game.onResize();
  }).observe(canvas);
  renderer.resize();

  const tick = (nowMs: number): void => {
    game.frame(nowMs);
    requestAnimationFrame(tick);
  };
  void game.start(performance.now());
  requestAnimationFrame(tick);
}
