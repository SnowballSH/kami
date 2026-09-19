import type { RuleCompiler } from "../rules/types";
import type { BoardStore } from "./types";

export type * from "./types";

/** Talks to the Kami server's REST API, which keeps everything in MongoDB. */
export function createBoardStore(): BoardStore {
  throw new Error("not implemented");
}

/** `POST /api/compile`: the server's model-backed compiler (the GX10). Null when it has none. */
export function createRemoteRuleCompiler(): RuleCompiler {
  throw new Error("not implemented");
}
