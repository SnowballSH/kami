# Game modes

A **mode** is a way to play a board. The board says what is sketched on the paper; the mode says what the *player* is when the room opens, how they come to have a body, what winning and losing mean, and which laws and natures the page will take. The everyday way to play — Alice stands at the spawn and you draw for her — is written down as `EMBODIED_MODE`. `SPIRIT_MODE` opens the room as a spirit with no body: you draw Alice, name her, and she is yours. `BOSS_MODE` ([boss.md](boss.md)) is the spirit opening for two players, with a servant of the one under the page coming through a tear to snip the body apart.

This document is the architecture. The spirit groundwork is built (the columns at the end say what is and is not); the boss is built on it.

## The contract (`src/modes/types.ts`)

```ts
interface GameMode {
  id: GameModeId;
  card: { title; tagline; opening; roles? }; // the title card, Kami's first line, one line per player
  opening: Opening;                         // what the player is when the room opens
  win: WinRule;                             // reach-goal | endless | outlast(ms) | defeat-foe
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

The mode's referee for one open room is a `ModeDirector`. The game calls it at the seams where modes could differ and enacts whatever it answers:

```ts
interface ModeDirector {
  mode: GameMode;
  state: PlayerState;                                    // body | spirit — what the player is *now*
  open(board): PlayerState;                              // board loaded, nothing stepped yet
  witness(event: SimEvent): EmbodimentTransition[];      // every sim event
  named(drawingId, ruling): EmbodimentTransition[];      // every naming
  won(event: SimEvent): boolean;                         // this mode's WinRule, judged on an event
  close(): void;
}

type EmbodimentTransition =
  | { kind: "incarnated"; by: "spawn" }
  | { kind: "incarnated"; by: "drawing"; drawingId; name }
  | { kind: "unmade"; cause: "fell" | "devoured" | "swallowed" }
  | { kind: "tear-opens" };                              // the boss's rip in the page
```

The director holds the player's state; the game does not. `createDirector(mode)` returns `EmbodiedDirector` for any mode that opens with a body and `SpiritDirector` for any that opens as a spirit. The embodied director answers nothing to `witness` and `named`; the spirit director (`src/modes/spiritDirector.ts`) answers `incarnated` to the first drawing whose name is a body (below), `unmade` when that body falls, is devoured or has its heart swallowed, and — when the mode wins by `defeat-foe` — `tear-opens` right after the incarnation.

### What names a body

`namesABody(name, mode.names)` (`src/modes/bodyNames.ts`) is deliberately open-ended: the mode's own names (`alice · her · me`), a pronoun for the player (*me*, *myself*, *this is me*), or any body noun — a person, a role, a creature, a doll, a robot (*a girl*, *the knight*, *my cat*, *a stick figure*). Things (*a sword*), places (*the moon*) and laws are not bodies. Articles and a few adjectives are stripped first.

## What the game does with it today

`GameModules.mode` (default `EMBODIED_MODE`) picks the director. The game:

- calls `director.open(board)` after `sim.loadBoard`, and `sim.disembody()` when it answers `spirit`: Alice is taken off the board and only her soul (`WorldSnapshot.soul`) waits at the spawn;
- asks `director.won(event)` before handling any sim event, and writes the closing line when it says so (so an `endless` sandbox never declares victory at the rabbit hole);
- asks `director.witness(event)` for every sim event and `director.named(id, ruling)` for every naming, and enacts the transitions: `incarnated by drawing` → `sim.incarnate(id, name)` (the drawing leaves the ink layer and the store; its strokes are her body), `tear-opens` → `sim.openTear()`, `unmade` → whatever the mode's `LossRule` says (`unmade`: `sim.disembody()`, she is a soul again; `board-restarts`: the room reopens after a beat; `respawn`: the sim's own checkpoint path);
- in a spirit-opening mode lets ink touch her (elsewhere strokes over Alice are refused), and hands any committed drawing that reaches a drawn body to `sim.graft(strokes)` before it can become a drawing of its own — that is how a snipped part is redrawn;
- runs every written law through `allowsLaw(mode.laws, effect.governs)` before enacting it — a forbidden law stays plain writing and Kami says *"Not in this game. The page won't take that law here."* beneath it;
- suspends saved laws the current mode forbids: they do not affect physics or appear as active laws, but remain saved for modes that allow them; erasing their note still repeals them;
- keeps Alice from walking herself when `autopilot` is `"forbidden"`, whatever the HUD switch says.

Nothing else changes. The embodied mode is exactly the game as it was.

## The modes

| | `EMBODIED_MODE` | `SPIRIT_MODE` | `BOSS_MODE` |
|---|---|---|---|
| url | (default) | `?mode=spirit` | `?mode=boss` |
| opening | `body` — she stands at the spawn | `spirit`, incarnation `drawn`, names `alice · her · me` + any body noun | same as spirit |
| win | `reach-goal` | `reach-goal` | `defeat-foe` — the tear closes |
| loss | `respawn` — the sim's own checkpoint path | `unmade` — the body is gone; you are a spirit again | `board-restarts` — the heart is swallowed; the room reopens |
| laws | `all` | `except clones` — one body at a time | `except clones, inkEater` — the servant is foe enough |
| natures | `all` | `all` | `all` |
| autopilot | `allowed` | `forbidden` — a body you drew is a body you steer | `forbidden` — the second player steers |
| card | title, tagline, opening | title, tagline, opening | + two `roles` lines, one per player |

## The spirit groundwork: built and not

| Seam | Status | Where |
|---|---|---|
| A board with nobody on it: `WorldSnapshot.alice` nullable, `soul` where a body may be drawn; renderer, camera, autopilot `Scene`, Sumikui and night lights tolerate her absence | built | `sim.disembody()`, `SoulSnapshot`; `Game.scene()` is null and autopilot idles; `paintSoul` |
| Incarnation by drawing: `director.named` → `sim.incarnate(id, name)`; `AliceController` from the drawing's bounds; strokes stay authoritative and are painted as her (`AliceLook` `drawn`); speed and jump scale with the body inside the `aliceSize` clamps | built | `src/sim/body/drawnBody.ts` (`incarnate`), `AliceController.wear`, `paintDrawnAlice` |
| Body parts and abilities: below the heart legs, beside it arms, above it head, up-and-out (or named winged) wings; legs walk and jump, arms climb, wings fly, head sees | built | `partOf`, `abilitiesOf`; `AliceController` gates control by them |
| Being unmade and grafted back: `unmade` on `fell` / `alice-devoured` / `heart-swallowed`; committed strokes that reach the body rejoin it (`sim.graft`) and glow while fresh | built | `SpiritDirector.witness`, `graft`, `BODY_TUNING.graftGlowMs` |
| Kami's lines for a soul, a body, a snip, a graft | built | `src/game/bossLines.ts` |
| Choosing the mode: `?mode=`, `modeFor`, the card written under the wordmark | built | `src/game/index.ts`, `Game.writeModeCard` |
| The stuck detector and hint ladder stay quiet while nobody is on the board | built | `Game.frame` |
| A spirit's hand as the camera's subject | not built | the camera follows the soul where it sits, which is where the body will be drawn; a wandering pen is not followed |
| Persistence of the body | not built | the drawing that became her is deleted from the store; a reload opens the room as a soul again, with everything else where it was. Right for a boss fight; a longer spirit game would want the store to remember her |
| Ink that touches a body but is not meant for it | not built | in spirit-opening modes any committed stroke that reaches her is a graft. A sword for her hand is drawn beside her, not on her |

Everything else — laws, natures, the Sumikui, creatures, vehicles — works unchanged on whatever body she has, because none of it knows how she came to have one.
