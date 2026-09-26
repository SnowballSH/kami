import { DIRECTIONS, type Direction } from "../ui/walkIntent";
import { CONTROLLER_BUTTONS, type ControllerButton, type ControllerState } from "./types";

const JUMP_BUTTON: ControllerButton = "a";
const CAT_BUTTON: ControllerButton = "x";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const isAxis = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

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
  const state = parseJson(data);
  if (!isRecord(state)) return null;
  const { x, y, held, buttons } = state;
  if (!isAxis(x) || !isAxis(y) || !Array.isArray(held) || !Array.isArray(buttons)) return null;
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
