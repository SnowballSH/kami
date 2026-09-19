import { createAutopilot } from "../autopilot";
import { createCat } from "../cat";
import { createInkSession, findDrawingAt, mintDrawingId } from "../ink";
import { createRenderer } from "../render";
import { createSimulation } from "../sim";
import { attachPen, createHud } from "../ui";
import { attachBoothKeys } from "./boothKeys";
import { Game } from "./game";
import { LEVELS } from "./levels";

export type * from "./types";

export function startGame(root: HTMLElement): void {
  const canvas = document.createElement("canvas");
  root.prepend(canvas);
  const renderer = createRenderer(canvas);
  const game = new Game({
    levels: LEVELS,
    sim: createSimulation(),
    cat: createCat(),
    autopilot: createAutopilot(),
    renderer,
    createInkSession,
    createHud: (handlers) => createHud(root, handlers),
    findDrawingAt,
    mintDrawingId,
  });

  attachPen(canvas, (clientX, clientY) => renderer.toWorld(clientX, clientY), game);
  attachBoothKeys(game, LEVELS.length);
  new ResizeObserver(() => renderer.resize()).observe(canvas);
  renderer.resize();

  const tick = (nowMs: number): void => {
    game.frame(nowMs);
    requestAnimationFrame(tick);
  };
  game.start(performance.now());
  requestAnimationFrame(tick);
}
