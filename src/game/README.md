# game/

The browser game on one device. `Game` (`game.ts`) is the only class other areas construct: it is
the canvas input sink, the HUD and laws-panel handler, and the frame loop. It owns no behaviour of
its own beyond wiring; each concern lives in a part that shares one `GameContext` (`context.ts`):
the modules, the `GameClock`, the mode director, the store, the note book, the ink ledger, the
party, the camera and the id mint. The board being played is read through the context, never
copied, because opening a board replaces it.

## Epochs

Every board opened turns the page (`GameClock.turnPage`). Anything asynchronous — a model answer, a
load, a tidy — takes `clock.pageGuard()` before it awaits and drops its result when the guard is
false, so nothing from a board already left lands on the next one.

## Parts

| Part | File | Does |
|---|---|---|
| `Voice` | `kami/voice.ts` | Where Kami's handwriting goes (clear of the HUD, the ground, Alice and the tear), remarks, recitals, pondering |
| `Funnel` | `kami/funnel.ts` | Words, typed or read from ink: help → law → place → wish → name → model → shrug |
| `Lawgiver` | `kami/lawgiver.ts` | Enacting, refusing under the mode's policy, repealing and folding laws; the Sumikui's summoning lore |
| `Naming` | `kami/naming.ts` | Guesses beside fresh ink, naming, labels; the body a waiting soul is offered |
| `Conjurer` | `kami/conjurer.ts` | Kami's own drawings: summoned things, a scene's props, the sketch in an idea |
| `Tidier` | `kami/tidier.ts` | Tidying named drawings at the slider's firmness |
| `Glimpses` | `kami/glimpses.ts` | Best guesses while the pen is still drawing |
| `Reactions` | `kami/reactions.ts` | Sim events and embodiment transitions: remarks, wins, losses, incarnation, zone intros |
| `PageSync` | `pageSync.ts` | Restoring a loaded page and folding in other devices' changes |
| `Presence` | `presence.ts` | Following a shared page, other devices' Alices, the share link |
| `NoteKeeping` | `noteKeeping.ts` | Which notes are saved, and which this device answers for |
| `Eraser` | `eraser.ts` | Taking drawings and notes off the page for good |
| `Party` | `party.ts` | One pilot per Alice; the page is charted only when a pilot drives |

`Voice` and `Tidier` take narrow dependencies so they can be tested alone; the other parts take the
context. Parts that need to call back into `Game` (reopening a board, the player's own writing) get a
small interface (`Reopener`, `Writer`) rather than the `Game` itself.

`testing/player.ts` drives a real `Game` with a real sim and fakes for rendering, handwriting and
storage; the `game.*.test.ts` files are written against it.
