import { createAutopilot } from "../autopilot";
import { boardFor, DEMO_BOARD_ID } from "../board";
import { createCat } from "../cat";
import { createHandwriting } from "../handwriting";
import { createInkSession, findDrawingAt } from "../ink";
import { createBoardStore, createRemoteRuleCompiler } from "../persistence";
import { createRecognizer } from "../recognition";
import { createRenderer } from "../render";
import { createRuleCompiler, resolvePhysics } from "../rules";
import { createSimulation } from "../sim";
import { attachCanvasInput, createHud } from "../ui";
import { Game } from "./game";

const BOARD_PARAM = "board";
const AUTOPILOT_PARAM = "autopilot";
const AUTOPILOT_MEMORY = "kami.autopilot";
const OFF = "off";

const remembered = (): string | null => {
  try {
    return window.localStorage.getItem(AUTOPILOT_MEMORY);
  } catch {
    return null;
  }
};

/** `?autopilot=off` (or `on`) wins; otherwise whatever the player last chose on this device. */
const startsSelfDriving = (): boolean =>
  (new URLSearchParams(window.location.search).get(AUTOPILOT_PARAM) ?? remembered()) !== OFF;

const rememberSelfDriving = (enabled: boolean): void => {
  try {
    window.localStorage.setItem(AUTOPILOT_MEMORY, enabled ? "on" : OFF);
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
  const game = new Game(
    {
      sim: createSimulation(),
      autopilot: createAutopilot(),
      cat: createCat(createRecognizer()),
      renderer,
      handwriting,
      compiler: createRuleCompiler(),
      thinker: createRemoteRuleCompiler(),
      store: createBoardStore(),
      resolvePhysics,
      boardFor,
      createInkSession,
      createHud: (handlers) => createHud(root, handlers),
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
