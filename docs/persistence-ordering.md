# Persistence ordering

`HttpBoardStore.load(boardId)` is a barrier in that board's write queue. It waits for
every preceding save, deletion, and clear, and subsequent writes wait for its response
body. Other boards continue independently. `listBoards()` remains an advisory,
unscoped summary read.

Every HTTP persistence request has a 10-second deadline, including JSON body reads.
The deadline aborts the transport and settles the client wait even when a custom
transport ignores cancellation. Failed writes still settle the queue; a barrier
does not imply that those writes succeeded. Failed mutations remain in the in-memory outbox;
`BoardStore.state` and the board menu expose unsaved changes and explicit retry. See the
[current integration guide](architecture.md#recognition-and-persistence). Cancellation cannot
retract a write already accepted by the server, and this queue does not coordinate different
browser tabs.
