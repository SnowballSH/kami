import type { Deafness } from "../voice/types";

/** What Kami writes when a press or a waking could not hear at all (`docs/voice.md`). */
export const DEAF_LINES: Record<Deafness, string> = {
  insecure: "No microphone on a plain http page. Open Kami's https address, and I can listen.",
  refused: "I have no microphone to listen with. Allow it, and try again.",
  server: "My ears are not attached — the server has no voice. Write to me instead.",
};
