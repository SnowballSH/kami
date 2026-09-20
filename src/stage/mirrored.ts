import type { Renderer } from "../render/types";
import type { LawsPanel } from "../ui/types";
import type { StageSource } from "./source";

/** The game's renderer, and everything it is shown passed on to the stage. */
export const mirroredRenderer = (renderer: Renderer, stage: StageSource): Renderer => ({
  setBoard: (board) => {
    renderer.setBoard(board);
    stage.setBoard(board);
  },
  resize: () => renderer.resize(),
  toWorld: (client, camera) => renderer.toWorld(client, camera),
  viewport: () => renderer.viewport(),
  render: (frame) => {
    renderer.render(frame);
    stage.show(frame, renderer.viewport());
  },
});

export const mirroredLaws = (panel: LawsPanel, stage: StageSource): LawsPanel => ({
  setLaws: (laws) => {
    panel.setLaws(laws);
    stage.setLaws(laws);
  },
});
