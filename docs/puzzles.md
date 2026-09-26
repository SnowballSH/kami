# Puzzle mode — the rooms

`?mode=puzzle` plays three rooms in a row. Each is a board like any other (`src/board/boards/puzzles/`), staged by `PuzzleDirector` (`src/modes/puzzle/`) so that one drawn or written idea is the way through and nothing else will take. The Sumikui is loose in every room from the first frame: ink is precious, and a drawing left idle is a drawing that gets eaten. Reaching the rabbit hole writes Kami's closing line and, four seconds later, opens the next room when one remains; the third room shows a Solved card and completes the run. If Alice is eaten, Kami says so and the room restarts under a Lost card (`PUZZLE_MODE.loss` is `board-restarts`); if she only falls, she is set down at the checkpoint with the room as it was. Nothing is saved: a room opens blank every time (`ForgetfulBoardStore`).

The design rule for every room: **the fun is the "aha"**, so the room must make the lazy answer impossible and the intended one obvious *in hindsight*. Two levers do that:

- **`allowedNatures`** on the room's one zone — the natures Kami will grant a drawing here. Anything else drawn is plain ink (solid, climbable only if it is a ladder-shaped nothing — and most rooms wall that off with `noInkZones`).
- **the room's dials** (`PuzzleRoom.dials`) — the physics settings a written law may turn here. Every other law stays plain writing with Kami's *"Not in this game"* beneath it. `inkEater` is always writable, so *"banish the ink eater"* works in every room, at the price of a sentence's worth of ink.

Autopilot is on by default: Alice walks toward the goal herself, so the player's whole job is the idea. Every room has a playthrough test in `src/modes/puzzle/rooms.test.ts` that drives the sim with drawings and laws through the autopilot, plus a negative test showing the room is *not* beatable without its idea.

## The rooms

| # | Room | Board | Natures | Dials | The idea |
|---|---|---|---|---|---|
| 1 | The Wall | `theWall.ts` | `bouncy` | — | a spring at the foot of a wall too tall to climb |
| 2 | The Keyhole | `theKeyhole.ts` | `shrink` | `aliceSize` | make *her* smaller, not the gap bigger |
| 3 | The Moon Ledge | `theMoonLedge.ts` | none | `gravity` | a ledge only reachable if the page pulled less |

### 1. The Wall — *"Too tall to climb. She could fall up, if something threw her."*

A 200 px wall on flat ground, the rabbit hole beyond it. Only `bouncy` is granted, and `noInkZones` cover the 200 px approach to the wall from the sky down to 60 px above the ground, and the wall itself — so no ladder, ramp or bridge can be leaned against it. What is left is the floor at its foot: draw a blob there, name it *mushroom* / *spring* / *trampoline* (anything the Cat calls bouncy), and Alice, walking east, steps on and is thrown over. Teaches: a nature does what a shape cannot.

### 2. The Keyhole — *"A crack under the wall, about the size of a mouse."*

A lintel from the sky to a gap too low for Alice. Only `shrink` is granted and only `aliceSize` is writable. Either route is the same idea — change her, not the room: draw a *bottle* and let her drink it, or write *"alice is tiny"*. *"we are on the moon"* is refused here (tested): a lighter page does not make a lower crack. Teaches: laws can be about Alice.

### 3. The Moon Ledge — *"Her legs are fine. It's the ground that pulls too hard."*

The floor stops; a ledge stands higher than her jump and farther than her stride, and a `noInkZone` fills the gap so nothing can be built across. No nature is granted — every drawing is plain ink — and only `gravity` is writable. Write *"we are on the moon"* (or *"zero gravity"*) and her ordinary hop clears it; a merely *"low"* or *"half"* gravity (0.4–0.5 g, a 140–160 px hop) still falls short of the 200 px ledge, so the answer rung names the Moon. Teaches: the room itself is a thing you can write about.

## The Sumikui

`PuzzleDirector` stages every room's world as `{ ...EARTH, inkEater: 1, ...room.world }`, so the ink eater is loose without a note to erase — a fact of the room, not a law on the page. The sim's own rules keep it from being cruel: the paper where Kami set her down is hallowed and it eats there neither ink nor Alice, it starts at half her pace and takes time over a meal (longer the more ink there is), and `rooms.test.ts` checks the one drawing a room needs is still there after 600 steps (ten seconds) with the Sumikui loose. Writing *"banish the ink eater"* seals it in any room; that law folds over the staged world like any other (`resolvePhysics(rules, base)`).

## Deliberately not built (yet)

The task's list of room ideas is longer than three. Left out of this first set, with the reason:

- **The heavy door / counterweight** — there is no lever or counterweighted door prop in the board format; it would be a new `BoardProp`, not data.
- **"Gravity points left" and a wall to walk on** — sideways gravity is a single law, but Alice's controller (`AliceController`) stands on down-facing surfaces only; walking a wall is a controller change.
- **The slow-time room** — `timeScale` is a dial, but no board hazard is timed, so nothing in a room yet *needs* slowing.
- **The hopper-fetched key** — creatures do not carry keys; the key is picked up by Alice alone (`BoardProps`).

Each is a new sim or board capability; the mode, director and room list are ready to take a room once the capability exists (`PUZZLE_ROOMS` is data, in play order).
