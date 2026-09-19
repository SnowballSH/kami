import { BUTTONS, type Button, type ControllerMessage, type ControllerReading } from "./types";

const PROTOCOL_WORD = "kami";
const CONTROLLER_ID = /^[a-z0-9-]{1,32}$/;
const NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
export const FULL_TRAVEL = 100;

export const isControllerId = (id: string): boolean => CONTROLLER_ID.test(id);

const tokensOf = (text: string): readonly string[] =>
  text.split(/\s+/).filter((token) => token.length > 0);

const withoutNegativeZero = (value: number): number => (value === 0 ? 0 : value);

const axisFrom = (token: string | undefined): number | null => {
  if (token === undefined || !NUMBER.test(token)) return null;
  const travel = Math.max(-FULL_TRAVEL, Math.min(FULL_TRAVEL, Math.round(Number(token))));
  return withoutNegativeZero(travel);
};

const buttonsFrom = (tokens: readonly string[]): readonly Button[] => {
  const letters = new Set(tokens.join("").toLowerCase());
  return BUTTONS.filter((button) => letters.has(button));
};

const readingFrom = (tokens: readonly string[]): ControllerReading | null => {
  const [xToken, yToken, ...buttonTokens] = tokens;
  const x = axisFrom(xToken);
  const y = axisFrom(yToken);
  return x === null || y === null ? null : { x, y, buttons: buttonsFrom(buttonTokens) };
};

/** `<x> <y> [buttons]` — the body of `POST /api/controllers/:id/state`. */
export const parseControllerReading = (body: string): ControllerReading | null =>
  readingFrom(tokensOf(body));

/** `kami <controller> <x> <y> [buttons]` — one line from UDP or serial. */
export const parseControllerLine = (line: string): ControllerMessage | null => {
  const [word, controller, ...rest] = tokensOf(line);
  if (word !== PROTOCOL_WORD || controller === undefined || !isControllerId(controller)) {
    return null;
  }
  const reading = readingFrom(rest);
  return reading === null ? null : { controller, reading };
};
