import { distance, type Rect, type Vec } from "../core/geometry";
import { INK_THICKNESS } from "../core/world";
import type { DrawingId } from "../ink/types";
import { SUMIKUI_LOSES_HER_PX } from "../sim/constants";
import type { AliceSnapshot, SumikuiSnapshot } from "../sim/types";
import { boundsOfInk } from "./chart";
import type { Scene, SceneInk } from "./types";

/** Closer than this, with its eye on her or the ground under her, and she drops everything to run. */
export const DREAD_PX = 200;
/** How much of a lead she runs for: past where it gives up the chase, with room to spare. */
export const SAFE_PX = SUMIKUI_LOSES_HER_PX + 120;

const holdsUp = (ink: Rect, alice: AliceSnapshot): boolean => {
  const feet = { x: alice.center.x, y: alice.center.y + alice.height / 2 };
  return (
    feet.x >= ink.x - INK_THICKNESS &&
    feet.x <= ink.x + ink.width + INK_THICKNESS &&
    feet.y >= ink.y - INK_THICKNESS &&
    feet.y <= ink.y + ink.height + INK_THICKNESS
  );
};

/** True while its teeth are in her, in the ground under her, or in the ink she stands on. */
const onHer = (sumikui: SumikuiSnapshot, { alice, inks }: Scene): boolean => {
  if (sumikui.phase !== "hunting" && sumikui.phase !== "feeding") return false;
  if (sumikui.quarry === "alice" || sumikui.quarry === "paper") return true;
  const chewed = inks.find((ink) => ink.drawing.id === sumikui.chewing);
  return chewed !== undefined && holdsUp(boundsOfInk(chewed), alice);
};

/** Where the Sumikui is while it is close and after her or her footing; null when she may go about her errand. */
export const dreadIn = (scene: Scene): Vec | null => {
  const { alice, sumikui } = scene;
  return sumikui !== null &&
    onHer(sumikui, scene) &&
    distance(sumikui.centre, alice.center) <= DREAD_PX
    ? sumikui.centre
    : null;
};

/** The drawing dissolving between its teeth, which no route should count on. */
export const chewedIn = (scene: Scene): DrawingId | null => scene.sumikui?.chewing ?? null;

/** The scene as it will be once the Sumikui finishes the drawing it is chewing. */
export const afterTheMeal = (scene: Scene): Scene => {
  const chewed = chewedIn(scene);
  if (chewed === null) return scene;
  const inks: readonly SceneInk[] = scene.inks.filter((ink) => ink.drawing.id !== chewed);
  return inks.length === scene.inks.length ? scene : { ...scene, inks };
};
