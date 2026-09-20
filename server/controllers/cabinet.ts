import { FULL_TRAVEL } from "./message";
import type { Button, ControllerMessage } from "./types";

const CABINET_FRAME = /^S,(\d{1,2}),([01]),([01]),(\d{1,4}),(\d{1,4})$/;
const MAX_POT = 4095;

export const parseCabinetLine = (line: string): ControllerMessage | null => {
  const fields = CABINET_FRAME.exec(line);
  if (fields === null) return null;
  const [, direction, ink, cat, px, py] = fields;
  const mask = Number(direction);
  if (mask > 15 || Number(px) > MAX_POT || Number(py) > MAX_POT) return null;
  const buttons: Button[] = [];
  if (ink === "1") buttons.push("b");
  if (cat === "1") buttons.push("x");
  return {
    controller: "arcade",
    reading: {
      x: ((mask & 2 ? 1 : 0) - (mask & 1 ? 1 : 0)) * FULL_TRAVEL,
      y: ((mask & 4 ? 1 : 0) - (mask & 8 ? 1 : 0)) * FULL_TRAVEL,
      buttons,
    },
  };
};
