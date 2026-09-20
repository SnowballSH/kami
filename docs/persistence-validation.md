# Saved board responses

`src/persistence/schemas.ts` is the runtime contract for both API writes and HTTP
board responses. It imports only Zod and browser-safe value/type definitions;
`server/schemas.ts` re-exports the entity contracts for existing server callers.
Drawing, ruling, note/action, rule/effect, identifier, coordinate, and summary
fields are validated before `HttpBoardStore` returns them. Entity IDs must be
unique within each collection; summary counts must be nonnegative safe integers.

An invalid snapshot rejects the entire load with `BoardResponseError`, including
the request path and invalid field paths, and emits a console warning. It is not
returned as an empty board or partially restored. No request deletes or repairs
the saved data. Invalid summary lists likewise reject rather than hide boards.
Successful responses containing invalid JSON also reject with this error.
`HttpBoardStore` records the load error and preserves an existing in-session snapshot when one
exists; otherwise it rejects. The game keeps the load failure visible and offers retry. See the
[current integration guide](architecture.md#recognition-and-persistence) for save-state recovery.

Older compatible entities (including notes with no optional action) remain valid.
Unknown additive entity fields are retained, but unknown discriminators are not
interpreted. Rule numeric domains and ruling strength constraints are shared-schema policy;
raw model effects are validated structurally before clamping into those domains. The offline
grammar and model compiler intentionally retain different ranges.
