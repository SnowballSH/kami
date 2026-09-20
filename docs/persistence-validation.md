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
Callers should catch this error and present a load failure; game/UI handling and
network/save-state reporting belong to the client lifecycle and R07 work.

Older compatible entities (including notes with no optional action) remain valid.
Unknown additive entity fields are retained, but unknown discriminators are not
interpreted. Rule numeric domains and ruling strength constraints are R01's
shared-schema policy; this PR does not change the model/offline range distinction.
