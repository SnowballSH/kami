import { FULL_TRAVEL } from "./message";
import type { Button, ControllerMessage, Direction } from "./types";

const CABINET_FRAME = /^S,(\d{1,2}),([01]),([01]),(\d{1,4}),(\d{1,4})$/;
const CABINET_CONTROLLER = "arcade";
const MAX_POT = 4095;
const DIRECTION_BITS: Readonly<Record<Direction, number>> = { left: 1, right: 2, up: 4, down: 8 };
const ALL_DIRECTIONS = 0b1111;

export const parseCabinetLine = (line: string): ControllerMessage | null => {
  const fields = CABINET_FRAME.exec(line);
  if (fields === null) return null;
  const [, direction, ink, cat, px, py] = fields;
  const mask = Number(direction);
  if (mask > ALL_DIRECTIONS || Number(px) > MAX_POT || Number(py) > MAX_POT) return null;
  const pressed = (toward: Direction): number => (mask & DIRECTION_BITS[toward] ? 1 : 0);
  const buttons: Button[] = [];
  if (ink === "1") buttons.push("b");
  if (cat === "1") buttons.push("x");
  return {
    controller: CABINET_CONTROLLER,
    reading: {
      x: (pressed("right") - pressed("left")) * FULL_TRAVEL,
      y: (pressed("up") - pressed("down")) * FULL_TRAVEL,
      buttons,
    },
  };
};
