import { z } from "zod";
import { DIRECTIONS, type Direction } from "../ui/walkIntent";
import { CONTROLLER_BUTTONS, type ControllerButton, type ControllerState } from "./types";

const JUMP_BUTTON: ControllerButton = "a";
const CAT_BUTTON: ControllerButton = "x";

const eventSchema = z.object({
  x: z.number(),
  y: z.number(),
  held: z.array(z.unknown()),
  buttons: z.array(z.unknown()),
});

const knownOnly = <T extends string>(known: readonly T[], values: readonly unknown[]): T[] =>
  known.filter((candidate) => values.includes(candidate));

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Null for anything that is not a controller event; unknown directions and buttons are dropped. */
export const parseControllerState = (data: unknown): ControllerState | null => {
  if (typeof data !== "string") return null;
  const event = eventSchema.safeParse(parseJson(data));
  if (!event.success) return null;
  const { x, y, held, buttons } = event.data;
  return {
    x,
    y,
    held: knownOnly(DIRECTIONS, held),
    buttons: knownOnly(CONTROLLER_BUTTONS, buttons),
  };
};

export const pressedDirections = (state: ControllerState): ReadonlySet<Direction> =>
  new Set<Direction>(state.buttons.includes(JUMP_BUTTON) ? [...state.held, "up"] : state.held);

/** The cabinet's CAT button arrives as `x` (docs/controllers.md). */
export const holdsCat = (state: ControllerState): boolean => state.buttons.includes(CAT_BUTTON);
