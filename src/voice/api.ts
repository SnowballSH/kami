import { API_BASE } from "../persistence/api";

export const speakPath = (): string => `${API_BASE}/voice/speak`;

export const listenPath = (): string => `${API_BASE}/voice/listen`;

/** Same origin as the game, with the matching WebSocket transport. */
export const listenSocketUrl = (
  sampleRate: number,
  location: Location,
  { wake = false } = {},
): string => {
  const url = new URL(listenPath(), location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("rate", String(Math.round(sampleRate)));
  if (wake) url.searchParams.set("wake", "1");
  return url.toString();
};
