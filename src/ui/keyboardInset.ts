import type { Detach } from "./types";

const INSET_PROPERTY = "--kami-keyboard-inset";

/**
 * Safari draws the on-screen keyboard over fixed content instead of resizing the layout.
 * Publishes how much of the bottom is covered so the naming panel can sit above it.
 */
export const trackKeyboardInset = (host: Window, target: HTMLElement): Detach => {
  const viewport = host.visualViewport ?? null;
  if (viewport === null) return () => undefined;

  const listeners = new AbortController();
  const publish = (): void => {
    const covered = Math.max(0, host.innerHeight - viewport.height - viewport.offsetTop);
    target.style.setProperty(INSET_PROPERTY, `${Math.round(covered)}px`);
  };
  viewport.addEventListener("resize", publish, { signal: listeners.signal });
  viewport.addEventListener("scroll", publish, { signal: listeners.signal });
  publish();
  return () => listeners.abort();
};
