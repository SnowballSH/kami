import type { Deafness } from "../voice/types";

/** The box also listens on https here (scripts/gx10/box/start.sh), which is where microphones work. */
const SECURE_PORT = 8443;

/** What Kami writes when a press or a waking could not hear at all (`docs/voice.md`). */
export const deafLine = (reason: Deafness, hostname: string): string => {
  switch (reason) {
    case "insecure":
      return `No microphone on a plain http page. Open https://${hostname}:${SECURE_PORT} and I can listen.`;
    case "refused":
      return "I have no microphone to listen with. Allow it, and try again.";
    case "server":
      return "My ears are not attached — the server has no voice. Write to me instead.";
  }
};
