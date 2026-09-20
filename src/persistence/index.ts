import type { RuleCompiler } from "../rules/types";
import { HttpBoardStore } from "./httpBoardStore";
import { HttpHandwritingReader } from "./httpHandwritingReader";
import { RemoteRuleCompiler } from "./remoteRuleCompiler";
import type { BoardStore, HandwritingReader } from "./types";

export type * from "./types";
export { guardUnsavedChanges } from "./unsavedGuard";

/** Talks to the Kami server's REST API, which keeps everything in MongoDB. */
export function createBoardStore(): BoardStore {
  return new HttpBoardStore();
}

/** `POST /api/compile`: the server's model-backed compiler (the GX10). Null when it has none. */
export function createRemoteRuleCompiler(): RuleCompiler {
  return new RemoteRuleCompiler();
}

/** `POST /api/transcribe`: the server's vision model reads pen strokes as words (or not). */
export function createHandwritingReader(): HandwritingReader {
  return new HttpHandwritingReader();
}
