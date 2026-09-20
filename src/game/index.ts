import { createAutopilot } from "../autopilot";
import { boardFor, DEMO_BOARD_ID } from "../board";
import { createCat } from "../cat";
import { createHandwriting } from "../handwriting";
import { createInkSession, findDrawingAt } from "../ink";
import {
  createBoardStore,
  createHandwritingReader,
  createRemoteRuleCompiler,
  createSketchCatalogue,
  guardUnsavedChanges,
} from "../persistence";
import { createPenReader } from "../reading";
import { createRecognizer } from "../recognition";
import { createRenderer } from "../render";
import { createRuleCompiler, resolvePhysics } from "../rules";
import { createSimulation } from "../sim";
import { Summoner } from "../summoning";
import { attachCanvasInput, createHud, createLawsPanel } from "../ui";
import { createVoice } from "../voice";
import { Game } from "./game";

const BOARD_PARAM = "board";
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
 * they last chose on this device with the HUD switch.
 */
const startsSelfDriving = (): boolean =>
  (new URLSearchParams(window.location.search).get(AUTOPILOT_PARAM) ?? remembered()) === ON;

const rememberSelfDriving = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(AUTOPILOT_MEMORY, enabled ? ON : "off");
  } catch {}
};

const boardInUrl = (): string =>
  new URLSearchParams(window.location.search).get(BOARD_PARAM) ?? DEMO_BOARD_ID;

const rememberBoardInUrl = (boardId: string): void => {
  const url = new URL(window.location.href);
  url.searchParams.set(BOARD_PARAM, boardId);
  window.history.replaceState(null, "", url);
};

export function startGame(root: HTMLElement): void {
  const canvas = document.createElement("canvas");
  root.prepend(canvas);
  const handwriting = createHandwriting();
  const renderer = createRenderer(canvas, handwriting);
  const store = createBoardStore();
  guardUnsavedChanges(window, store);
  const recognizer = createRecognizer();
  const game = new Game(
    {
      sim: createSimulation(),
      autopilot: createAutopilot(),
      cat: createCat(recognizer),
      finisher: recognizer,
      summoner: new Summoner(createSketchCatalogue(), recognizer),
      renderer,
      handwriting,
      compiler: createRuleCompiler(),
      thinker: createRemoteRuleCompiler(),
      store,
      penReader: createPenReader(createHandwritingReader()),
      resolvePhysics,
      boardFor,
      createInkSession,
      createHud: (handlers) => createHud(root, handlers),
      createVoice,
      createLawsPanel: (handlers) => createLawsPanel(root, handlers),
      findDrawingAt,
      onBoardOpened: rememberBoardInUrl,
      selfDriving: startsSelfDriving(),
      onSelfDrivingChanged: rememberSelfDriving,
    },
    boardInUrl(),
  );

  attachCanvasInput(canvas, () => game.currentTool, game);
  new ResizeObserver(() => renderer.resize()).observe(canvas);
  renderer.resize();

  const tick = (nowMs: number): void => {
    game.frame(nowMs);
    requestAnimationFrame(tick);
  };
  void game.start(performance.now());
  requestAnimationFrame(tick);
}
