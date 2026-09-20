import { distance, type Vec } from "../core/geometry";
import type { DrawingId } from "../ink/types";
import { SUMIKUI_LOSES_HER_PX } from "../sim/constants";
import type { SumikuiSnapshot } from "../sim/types";
import type { Scene, SceneInk } from "./types";

/** Closer than this, with its eye on her or the ground under her, and she drops everything to run. */
export const DREAD_PX = 200;
/** How much of a lead she runs for: past where it gives up the chase, with room to spare. */
export const SAFE_PX = SUMIKUI_LOSES_HER_PX + 120;

const onHer = (sumikui: SumikuiSnapshot): boolean =>
  (sumikui.phase === "hunting" || sumikui.phase === "feeding") &&
  (sumikui.quarry === "alice" || sumikui.quarry === "paper");

/** Where the Sumikui is while it is close and after her or her footing; null when she may go about her errand. */
export const dreadIn = ({ alice, sumikui }: Scene): Vec | null =>
  sumikui !== null && onHer(sumikui) && distance(sumikui.centre, alice.center) <= DREAD_PX
    ? sumikui.centre
    : null;

/** The drawing dissolving between its teeth, which no route should count on. */
export const chewedIn = (scene: Scene): DrawingId | null => scene.sumikui?.chewing ?? null;

/** The scene as it will be once the Sumikui finishes the drawing it is chewing. */
export const afterTheMeal = (scene: Scene): Scene => {
  const chewed = chewedIn(scene);
  if (chewed === null) return scene;
  const inks: readonly SceneInk[] = scene.inks.filter((ink) => ink.drawing.id !== chewed);
  return inks.length === scene.inks.length ? scene : { ...scene, inks };
};
