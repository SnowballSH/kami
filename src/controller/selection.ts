import { CONTROLLER_ID_PATTERN, DEFAULT_CONTROLLER_ID } from "./types";

export const CONTROLLER_PARAM = "controller";

const OFF = "off";

/** The controller a page address asks for: `arcade` unless `?controller=` names another; null for `off` or a bad name. */
export const selectedControllerId = (search: string): string | null => {
  const requested = new URLSearchParams(search).get(CONTROLLER_PARAM) ?? DEFAULT_CONTROLLER_ID;
  return requested !== OFF && CONTROLLER_ID_PATTERN.test(requested) ? requested : null;
};
