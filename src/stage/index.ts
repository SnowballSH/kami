import { dialBrowser } from "./line";
import { StageSource } from "./source";
import { DEFAULT_STAGE, stageNameOf, stageSocketUrl } from "./wire";

export { mirroredLaws, mirroredRenderer } from "./mirrored";
export { isScreen, startScreen } from "./screen";
export type { StageSource } from "./source";

export const STAGE_PARAM = "stage";

/** This device's place on a stage: `?stage=<name>` names it, otherwise the one every screen shows by default. */
export const createStageSource = (host: Window = window): StageSource => {
  const asked = new URLSearchParams(host.location.search).get(STAGE_PARAM);
  return new StageSource(
    dialBrowser(
      stageSocketUrl(asked === null ? DEFAULT_STAGE : stageNameOf(asked), "source", host.location),
    ),
  );
};
