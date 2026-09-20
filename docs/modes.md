# Game modes

A **mode** is a way to play a board. The board says what is sketched on the paper; the mode says what the *player* is when the room opens, how they come to have a body, what winning and losing mean, and which laws and natures the page will take. Today there is one way to play — Alice stands at the spawn and you draw for her — and it is written down as `EMBODIED_MODE`. The second, `SPIRIT_MODE`, is a contract for a game nobody has built yet: you open the room as a spirit with no body, draw Alice, name her, and she is yours.

This document is the architecture. Only the embodied mode is playable; everything the spirit mode needs that does not exist yet is listed at the end.

## The contract (`src/modes/types.ts`)

```ts
interface GameMode {
  id: GameModeId;
  card: { title; tagline; opening };        // the title card and Kami's first line
  opening: Opening;                         // what the player is when the room opens
  win: WinRule;                             // reach-goal | endless | outlast(ms)
  loss: LossRule;                           // respawn | unmade | board-restarts
  laws: LawPolicy;                          // all | only(dials) | except(dials)
  natures: NaturePolicy;                    // "all" | Nature[] — narrows the room's own list
  autopilot: "allowed" | "forbidden";       // may she walk herself
}

type Opening =
  | { player: "body" }                                  // Alice stands at the spawn; the player is her
  | { player: "spirit"; incarnation: Incarnation };     // nobody on the board until the player makes her

type Incarnation =
  | { kind: "born" }                                    // she appears at the spawn
  | { kind: "drawn"; names: string[] };                 // a drawing named one of these becomes her body
```

Modes are **data**. Adding one is a new constant in `modes.ts`, not new code, until it asks for an `Incarnation`, `LossRule` or `WinRule` variant nobody has built. The types are closed unions on purpose: the game can `switch` over them exhaustively, and a new variant is a type error everywhere it must be handled.

### The director

The mode's referee for one open room is a `ModeDirector`. The game calls it at the seams where modes could differ and enacts whatever it answers (today only `open` and `won` are called; `witness` and `named` exist for the spirit mode and answer nothing in the embodied one):

```ts
interface ModeDirector {
  mode: GameMode;
  state: PlayerState;                                    // body | spirit — what the player is *now*
  open(board): PlayerState;                              // board loaded, nothing stepped yet
  witness(event: SimEvent): EmbodimentTransition[];      // every sim event
  named(drawingId, ruling): EmbodimentTransition | null; // every naming
  won(event: SimEvent): boolean;                         // this mode's WinRule, judged on an event
  close(): void;
}

type EmbodimentTransition =
  | { kind: "incarnated"; by: "spawn" }
  | { kind: "incarnated"; by: "drawing"; drawingId }
  | { kind: "unmade"; cause: "fell" | "devoured" };
```

The director holds the player's state; the game does not. `createDirector(mode)` returns `EmbodiedDirector` for any mode that opens with a body, and `null` for openings nobody has built — the game then plays the board as embodied rather than refusing to open.

## What the game does with it today

`GameModules.mode` (default `EMBODIED_MODE`) picks the director. The game:

- calls `director.open(board)` after `sim.loadBoard`;
- asks `director.won(event)` before handling any sim event, and writes the closing line when it says so (so an `endless` sandbox never declares victory at the rabbit hole);
- runs every written law through `allowsLaw(mode.laws, effect.governs)` before enacting it — a forbidden law stays plain writing and Kami says *"Not in this game. The page won't take that law here."* beneath it;
- suspends saved laws the current mode forbids: they do not affect physics or appear as active laws, but remain saved for modes that allow them; erasing their note still repeals them;
- keeps Alice from walking herself when `autopilot` is `"forbidden"`, whatever the HUD switch says.

Nothing else changes. The embodied mode is exactly the game as it was.

## The modes

| | `EMBODIED_MODE` | `SPIRIT_MODE` (contract only) |
|---|---|---|
| opening | `body` — she stands at the spawn | `spirit`, incarnation `drawn`, names `alice · her · me` |
| win | `reach-goal` | `reach-goal` |
| loss | `respawn` — the sim's own checkpoint path | `unmade` — the body is gone; you are a spirit again |
| laws | `all` | `except clones` — one body at a time |
| natures | `all` | `all` |
| autopilot | `allowed` | `forbidden` — a body you drew is a body you steer |

## What the spirit mode still needs

None of this is built; each is a seam that already exists, named so it can be built in order.

1. **A board with nobody on it.** `Simulation.loadBoard(board)` always stands Alice at the spawn. It needs a way to open with her *absent* — no Alice body, no twins, no Sumikui quarry — and `WorldSnapshot.alice` becomes nullable, which the renderer, the camera (`CameraRig.frame` on the spawn instead), the autopilot `Scene` and the Sumikui must all tolerate.
2. **Incarnation by drawing.** The game calls `director.named` at the naming seam and `director.witness` on every sim event, and enacts the transitions. A `SpiritDirector.named(drawingId, ruling)` that answers `{ kind: "incarnated", by: "drawing", drawingId }` when the ruling's name is one of the mode's `names`. The game then asks the sim to `incarnate(drawingId)`: the drawing's strokes are taken out of the ink layer and become her body — `AliceController` built from the drawing's bounds, its strokes drawn as her (a new `AliceLook` for the painter), the drawing's own nature discarded. Her walk speed and jump scale with the body she was given, within the `aliceSize` clamps.
3. **Being unmade.** Where the embodied mode's `fell` / `alice-devoured` respawn her, the spirit director answers `{ kind: "unmade" }` and the game removes her body (a little ink dust where she stood; Kami: *"She's gone back into the pen. Draw her again."*), the player is a spirit, and the room goes on with its ink where it was.
4. **A spirit's hand.** While a spirit, the pen is the only presence. The camera needs a subject that is not Alice (the last pen position, or the spawn); the stuck detector and the hint ladder need to know there is nobody to be stuck.
5. **Choosing the mode.** `?mode=spirit` in the URL, `modeFor(id)` in `startGame`, and a title card from `mode.card` in `ui/` before the room opens.
6. **Persistence.** A body made from a drawing is a drawing that is no longer ink: the `BoardStore` needs to remember which drawing became her, or a reload puts her back as a sketch.

Everything else — laws, natures, the Sumikui, creatures, vehicles — works unchanged on whatever body she has, because none of it knows how she came to have one.
