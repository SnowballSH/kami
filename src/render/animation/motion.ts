const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** One live query per `matchMedia`: asked every frame, it must not build a new one each time. */
const queries = new WeakMap<Window["matchMedia"], MediaQueryList>();

export const motionAllowed = (): boolean => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  const { matchMedia } = window;
  let query = queries.get(matchMedia);
  if (query === undefined) {
    query = window.matchMedia(REDUCED_MOTION);
    queries.set(matchMedia, query);
  }
  return !query.matches;
};
