import type { PeerId } from "./wire";

/** A name for this tab on shared pages; not an account, and forgotten when the tab closes. */
export const mintPeerId = (random: () => number = Math.random): PeerId =>
  `peer-${Date.now().toString(36)}-${Math.floor(random() * 36 ** 6).toString(36)}` as PeerId;
