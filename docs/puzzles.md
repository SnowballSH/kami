# Puzzle mode — the rooms

`?mode=puzzle` plays seven rooms in a row. Each is a board like any other (`src/board/boards/puzzles/`), staged by `PuzzleDirector` (`src/modes/puzzle/`) so that one drawn or written idea is the way through and nothing else will take. The Sumikui is loose in every room from the first frame: ink is precious, and a drawing left idle is a drawing that gets eaten. Reaching the rabbit hole writes Kami's closing line and, four seconds later, opens the next room. Nothing is saved: a room opens blank every time (`ForgetfulBoardStore`).

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
| 4 | The Dark Hall | `theDarkHall.ts` | `lantern` | — | she will not walk where she cannot see |
| 5 | The Twin Doors | `theTwinDoors.ts` | `portal` | — | boxed in; a door that is not in a wall, and its twin outside |
| 6 | The Shaft | `theShaft.ts` | none | `flight` | a shaft with no stairs, walls that take no ink |
| 7 | The Pit | `thePit.ts` | `bouncy` | `gravity` | two ideas at once: a spring *and* the Moon |

### 1. The Wall — *"Too tall to climb. She could fall up, if something threw her."*

A 200 px wall on flat ground, the rabbit hole beyond it. Only `bouncy` is granted, and `noInkZones` cover the 200 px approach to the wall from the sky down to 60 px above the ground, and the wall itself — so no ladder, ramp or bridge can be leaned against it. What is left is the floor at its foot: draw a blob there, name it *mushroom* / *spring* / *trampoline* (anything the Cat calls bouncy), and Alice, walking east, steps on and is thrown over. Teaches: a nature does what a shape cannot.

### 2. The Keyhole — *"A crack under the wall, about the size of a mouse."*

A lintel from the sky to a gap too low for Alice. Only `shrink` is granted and only `aliceSize` is writable. Either route is the same idea — change her, not the room: draw a *bottle* and let her drink it, or write *"alice is tiny"*. *"we are on the moon"* is refused here (tested): a lighter page does not make a lower crack. Teaches: laws can be about Alice.

### 3. The Moon Ledge — *"Her legs are fine. It's the ground that pulls too hard."*

The floor stops; a ledge stands higher than her jump and farther than her stride, and a `noInkZone` fills the gap so nothing can be built across. No nature is granted — every drawing is plain ink — and only `gravity` is writable. Write *"we are on the moon"* (or *"low gravity"*, *"gravity is half"*) and her ordinary hop clears it. Teaches: the room itself is a thing you can write about.

### 4. The Dark Hall — *"She won't take a step she can't see."*

A long corridor staged at `daylight: 0`. In pitch dark (`sim/nightfall.ts`, below `PITCH_DARK_BELOW`) Alice refuses every step outside a lantern's light (`LANTERN_LIGHT_PX`, the same radius the night painter draws) and Kami says so once. Only `lantern` is granted and `daylight` is *not* writable, so the sun cannot be written back on. The hall is longer than one pool of light: hang a lantern, walk to its edge, hang the next. Teaches: a drawing can change what she is willing to do, not only where she can stand.

### 5. The Twin Doors — *"No door in, no door out. So draw one. Doors come in pairs."*

Alice opens inside a closed box; the goal is outside. Only `portal` is granted. One ring is a lonely portal and leads nowhere (the pilot waits beside it); a second ring drawn outside the box pairs with it, the pathfinder charts a `warp` edge between them (`autopilot/chart.ts` gateways, `pathfinder.ts`), and she walks into one and out of the other. Teaches: some ideas take two drawings.

### 6. The Shaft — *"The Rabbit fell down here. He was in no hurry to fall back up."*

A tall shaft; the goal is at the top; a `noInkZone` fills the shaft from 160 px above the floor to its mouth, so no ladder or step can be stuck to the walls; no nature is granted. Only `flight` is writable. *"alice can fly"* and she flies up. Teaches: when nothing can be drawn, something can still be written.

### 7. The Pit — *"Deeper than any spring can throw her. Unless she weighed less."*

Alice opens at the bottom of a pit deeper than a spring's throw under Earth gravity. `bouncy` is granted and `gravity` is writable; either alone fails (tested), together they clear it: a spring *and* *"we are on the moon"*. Teaches the whole game in one room — a drawing and a law compose.

## The Sumikui

`PuzzleDirector` stages every room's world as `{ ...EARTH, inkEater: 1, ...room.world }`, so the ink eater is loose without a note to erase — a fact of the room, not a law on the page. The sim's own rules keep it from being cruel: the paper where Kami set her down is hallowed and it eats there neither ink nor Alice, it wakes slowly and takes time over a meal, and `rooms.test.ts` checks the one drawing a room needs is still there after 600 steps (ten seconds) with the Sumikui loose. Writing *"banish the ink eater"* seals it in any room; that law folds over the staged world like any other (`resolvePhysics(rules, base)`).

## Deliberately not built (yet)

The task's list of room ideas is longer than seven. Left out of this first set, with the reason:

- **The heavy door / counterweight** — there is no lever or counterweighted door prop in the board format; it would be a new `BoardProp`, not data.
- **"Gravity points left" and a wall to walk on** — sideways gravity is a single law, but Alice's controller (`AliceController`) stands on down-facing surfaces only; walking a wall is a controller change.
- **The slow-time room** — `timeScale` is a dial, but no board hazard is timed, so nothing in a room yet *needs* slowing.
- **The hopper-fetched key** — creatures do not carry keys; the key is picked up by Alice alone (`BoardProps`).

Each is a new sim or board capability; the mode, director and room list are ready to take a room once the capability exists (`PUZZLE_ROOMS` is data, in play order).
