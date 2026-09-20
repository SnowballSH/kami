# Game modes

A **mode** is a way to play a board. The board says what is sketched on the paper; the mode says what the *player* is when the room opens, how they come to have a body, what winning and losing mean, which laws and natures the page will take, whether the board id names a room or an endless page, when Kami helps, and whether other devices share the page. The everyday way to play — Alice stands at the spawn and you draw for her — is written down as `EMBODIED_MODE`. `SANDBOX_MODE` (`?mode=sandbox`) is an endless page with no edges that everyone who opens it draws on together. `PUZZLE_MODE` (`?mode=puzzle`) plays seven rooms in a row, each staged so that one drawn or written idea is the way through, with the Sumikui loose from the first frame ([puzzles.md](puzzles.md)). `SPIRIT_MODE` opens the room as a spirit with no body: you draw Alice, name her, and she is yours. `BOSS_MODE` ([boss.md](boss.md)) is the spirit opening for two players, with a servant of the one under the page coming through a tear to snip the body apart; every opening is a fresh page that clears saved fight drawings and notes.

This document is the architecture. Embodied, sandbox, puzzle, spirit and boss are all playable; the columns at the end say which seams of the spirit groundwork are built and which are not.

## The contract (`src/modes/types.ts`)

```ts
interface GameMode {
  id: GameModeId;
  card: { title; tagline; opening; roles? }; // the title card, Kami's first line, one line per player
  opening: Opening;                         // what the player is when the room opens, and whether it starts fresh
  win: WinRule;                             // reach-goal | endless | outlast(ms) | defeat-foe
  loss: LossRule;                           // respawn | unmade | board-restarts
  laws: LawPolicy;                          // all | only(dials) | except(dials)
  natures: NaturePolicy;                    // "all" | Nature[] — narrows the room's own list
  autopilot: "allowed" | "forbidden";       // may she walk herself
  page: PageKind;                           // room | endless — what the board id names
  help: HelpPolicy;                         // offered (the hint ladder) | on-request (only when asked)
  sharing: SharingPolicy;                   // alone | live — other devices' ink, notes, laws and Alices
  refusals?: Partial<Record<Governs, string>>; // Kami's line instead of the stock refusal, per forbidden dial
}

type Opening =
  | { player: "body" }                                  // Alice stands at the spawn; the player is her
  | { player: "spirit"; incarnation: Incarnation };     // nobody on the board until the player makes her

type Incarnation =
  | { kind: "born" }                                    // she appears at the spawn
  | { kind: "drawn"; names: string[] };                 // a drawing named one of these becomes her body
```

Modes are **data**. Adding one is a new constant in `modes.ts` (or its own file beside it, as `sandboxMode.ts`), not new code, until it asks for an `Incarnation`, `LossRule` or `WinRule` variant nobody has built. The types are closed unions on purpose: the game can `switch` over them exhaustively, and a new variant is a type error everywhere it must be handled.

### The director

The mode's referee for one open room is a `ModeDirector`. The game calls it at the seams where modes could differ and enacts whatever it answers:

```ts
interface ModeDirector {
  mode: GameMode;
  state: PlayerState;                                    // body | spirit — what the player is *now*
  room: RoomStaging | null;                              // how this board is staged, when the mode stages rooms
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

interface RoomStaging {
  world: WorldPhysics;      // the room's own world; written laws fold over it instead of Earth
  laws: LawPolicy;          // narrows the mode's policy for this room only
  card: RoomCard;           // mode · title · Kami's line · "room n of m"
  closing: string;          // Kami's line when the room is won
  next: string | null;      // the board that opens after it, or the end of the run
}
```

The director holds the player's state; the game does not. `createDirector(mode)` (`src/modes/director.ts`) returns `PuzzleDirector` for the puzzle mode, `EmbodiedDirector` for any other mode that opens with a body and `SpiritDirector` for any that opens as a spirit. The embodied director answers nothing to `witness` and `named`; the spirit director (`src/modes/spiritDirector.ts`) answers `incarnated` to the first drawing whose name is a body (below), `unmade` when that body — hers, not a twin's — falls, is devoured or has its heart swallowed, and — when the mode wins by `defeat-foe` — `tear-opens` right after the incarnation.

A director that stages rooms fills `room` in `open(board)`; the others leave it `null` and the game plays the board plain. `PuzzleDirector` looks the board up in `PUZZLE_ROOMS` (`src/modes/puzzle/rooms.ts`, data in play order): the staged world is `{ ...EARTH, inkEater: 1, ...room.world }`, the law policy `only [...room.dials, "inkEater"]`, the card the board's title and first zone's intro.

### What names a body

`namesABody(name, mode.names)` (`src/modes/bodyNames.ts`) is deliberately open-ended: the mode's own names (`alice · her · me`), a pronoun for the player (*me*, *myself*, *this is me*), or any body noun — a person, a role, a creature, a doll, a robot (*a girl*, *the knight*, *my cat*, *a stick figure*). Things (*a sword*), places (*the moon*) and laws are not bodies. Articles and a few adjectives are stripped first.

## What the game does with it today

`GameModules.mode` (default `EMBODIED_MODE`) picks the director. The game:

- calls `director.open(board)` after `sim.loadBoard`, and `sim.disembody()` when it answers `spirit`: Alice is taken off the board and only her soul (`WorldSnapshot.soul`) waits at the spawn;
- asks `director.won(event)` before handling any sim event, and writes the closing line when it says so (so an `endless` sandbox never declares victory at the rabbit hole);
- shows `room.card` in the HUD (`ui/roomCard.ts`: a title card that fades, and a progress mark that stays), folds written laws over `room.world` rather than Earth, and on a win writes `room.closing` and opens `room.next` four seconds later;
- asks `director.witness(event)` for every sim event and `director.named(id, ruling)` for every naming, and enacts the transitions: `incarnated by drawing` → `sim.incarnate(id, name)` (the drawing leaves the ink layer and the store; its strokes are her body), `tear-opens` → `sim.openTear()`, `unmade` → whatever the mode's `LossRule` says (`unmade`: `sim.disembody()`, she is a soul again; `board-restarts`: the room reopens after a beat; `respawn`: the sim's own checkpoint path);
- in a spirit-opening mode lets ink touch her (elsewhere strokes over Alice are refused), and hands any committed drawing that reaches a drawn body to `sim.graft(strokes)` before it can become a drawing of its own — that is how a snipped part is redrawn;
- runs every written law through `allowsLaw(room?.laws ?? mode.laws, effect.governs)` before enacting it — a forbidden law stays plain writing and Kami says *"Not in this game. The page won't take that law here."* beneath it;
- suspends saved laws the current mode forbids: they do not affect physics or appear as active laws, but remain saved for modes that allow them; erasing their note still repeals them;
- keeps Alice from walking herself when `autopilot` is `"forbidden"`, whatever the HUD switch says;
- reads the board id as `endlessBoard(id)` when `page` is `"endless"`, and as `boardFor(id)` otherwise;
- runs the stuck detector and the hint ladder only when `help` is `"offered"` and somebody is on the board; with `"on-request"` Kami answers written requests for help instead (`counsel/`);
- follows the board through `BoardLink` when `sharing` is `"live"`, applies what arrives, reports Alice's position, paints the other devices' Alices as ghosts, and swaps the board menu for the share affordance;
- introduces any mode but the embodied one when the open room is not staged — a staged room opens on its own `room.card`, which already names the mode: the title card from `mode.card` in the HUD, the card's title, tagline and `roles` lines written under the wordmark, and Kami's first line, which is `card.opening` when she stands on the board and the soul's own line (*"Only a heart, so far…"*) while nobody does.

The embodied mode is exactly the game as it was.

## Sandbox (`src/modes/sandboxMode.ts`)

`?mode=sandbox`. The board id (`?board=<id>`, default `sandbox`) names an endless page rather than a room; everyone who opens the same id draws on the same paper.

- **An endless page** (`board/boards/endless.ts`). `PageKind` is `"room" | "endless"`. An endless board has one solid — a strip of ground `ENDLESS_GROUND` under the spawn — no zones, no goal, no rabbit hole and `killY` of infinity: there is no edge to fall off. Beyond the strip there is nothing until someone draws. The camera follows her to any coordinate (`cameraRig.test.ts` walks her to ±5,000,000). Falling `FALL_LIMIT` below the last place she stood is falling off the page; `LastFooting` (`sim/footing.ts`) puts her back on the ink she last stood on, once — if that ink is gone too, the second fall returns her to the spawn.
- **Wandering.** The chart is windowed `WINDOW_PX` around every Alice on the page, never board-sized. With no errand her pilot `explore`s: the errand is the top of the newest ink, or the edge of the paper she faces when nothing has been drawn; on an empty page she stands back from the end of the strip rather than walking off it. Threats and objectives (a goal someone draws and names) still take precedence, as in a room.
- **Shared.** `sharing: "live"` — see [architecture.md](architecture.md) `sync/` and `server/`. Every device has its own Alice; the others' are ghosts, faint and never solid.
- **Kami on request.** `help: "on-request"`. The stuck detector and hint ladder are off. Writing *help*, *what can I do?*, *how do I get across?*, *give me an idea*, *I'm bored* asks Kami to read what is around Alice (`counsel/surroundings.ts`: a `gap` in the ground ahead, a `wall` too tall to jump, a `drop` where the ink ends, or `open` page) and answer: for a gap he sketches the start of a bridge across it and says *"A gap. A bridge would do — here is the start of one. Draw it stronger."*; for a wall he leans a ladder against it; for a drop he suggests drawing the ground onward or writing *she can fly*; on open page he takes the next idea in turn — a friend to draw and name (he sketches one), a law to write (`g = moon`), a mushroom and *bouncy*, a cat that follows her, wind and a cloud. Sketches go through the same summoning path as the player's own *draw me a rabbit*.
- **No Sumikui.** `laws: except inkEater`. *ink eater* stays plain writing and Kami says the mode's refusal, `NOTHING_HUNGRY_LINE`: *"Nothing hungry lives on this page."* Saved `inkEater` laws are suspended, as any forbidden law is.
- **Title card and share.** The card (`ui/titleCard.ts`) shows `card.title` and `card.tagline` for `TITLE_CARD_SHOWN_MS` or until tapped. The board menu is replaced by one **share** button (`ui/sharePanel.ts`): the board id, the link `?board=<id>&mode=sandbox`, a QR of it, how many others are on the page, and copy.

**Not built.** Pages are as persistent as any board (the store keeps them); there is no list of shared pages, no names for peers, no chat, no conflict handling beyond last-write-wins per entity, and no cursor or pen trails for the other devices — only their Alices. Laws written on the page apply to every Alice on it, including the ghosts' owners, since a page has one physics.

## The modes

| | `EMBODIED_MODE` | `PUZZLE_MODE` | `SANDBOX_MODE` | `SPIRIT_MODE` | `BOSS_MODE` |
|---|---|---|---|---|---|
| status | built | built — [puzzles.md](puzzles.md) | built | groundwork built (below) | built — [boss.md](boss.md) |
| url | (default) | `?mode=puzzle` (`&board=<room id>` to start mid-run) | `?mode=sandbox` (`&board=<page id>`, default `sandbox`) | `?mode=spirit` | `?mode=boss` |
| opening | `body` — she stands at the spawn | `body` | `body` — on the strip of ground | `spirit`, incarnation `drawn`, names `alice · her · me` + any body noun | same as spirit |
| win | `reach-goal` | `reach-goal` → the next room | `endless` | `reach-goal` | `defeat-foe` — the tear closes |
| loss | `respawn` — the sim's own checkpoint path | `respawn` | `respawn` — onto the last ink she stood on | `unmade` — the body is gone; you are a spirit again | `board-restarts` — the heart is swallowed; the room reopens |
| laws | `all` | `only inkEater`, widened per room to its dials | `except inkEater` — *"Nothing hungry lives on this page."* | `except clones` — one body at a time | `except clones, inkEater` — the servant is foe enough |
| natures | `all` | `all` — each room's zone narrows to one or none | `all` | `all` | `all` |
| autopilot | `allowed` | `allowed`, on by default | `allowed` — explores toward the newest ink | `forbidden` — a body you drew is a body you steer | `forbidden` — the second player steers |
| page | `room` | `room` | `endless` | `room` | `room` |
| help | `offered` | `offered` | `on-request` | `offered` — quiet while nobody is on the board | `offered` — quiet while nobody is on the board |
| sharing | `alone` | `alone` | `live` | `alone` | `alone` |
| world | Earth | Earth with `inkEater: 1`, plus the room's own (the Dark Hall: `daylight: 0`) | Earth | Earth | Earth |
| persistence | saved | none — every room opens blank (`ForgetfulBoardStore`) | saved, and shared live | saved, but for the body (below) | saved, but for the body (below) |
| card | title, tagline, opening | the staged room's own card | title card, tagline and opening line | title, tagline; the soul's line | + two `roles` lines, one per player |

## The spirit groundwork: built and not

| Seam | Status | Where |
|---|---|---|
| A board with nobody on it: `WorldSnapshot.alice` nullable, `soul` where a body may be drawn; renderer, camera, autopilot `Scene`, Sumikui and night lights tolerate her absence; `sim.alices()` is empty so the `Party` drives nobody and a clone law makes no twins of a heart | built | `sim.disembody()`, `SoulSnapshot`; `Game.scene()` is null and autopilot idles; `Party.drive`; `paintSoul` |
| Incarnation by drawing: `director.named` → `sim.incarnate(id, name)`; `AliceController` from the drawing's bounds; strokes stay authoritative and are painted as her (`AliceLook` `drawn`); speed and jump scale with the body inside the `aliceSize` clamps; the drawing leaves the ink ledger, so it is never tidied | built | `src/sim/body/drawnBody.ts` (`incarnate`), `AliceController.wear`, `paintDrawnAlice` |
| Body parts and abilities: below the heart legs, beside it arms, above it head, up-and-out (or named winged) wings; legs walk and jump, arms climb, wings fly, head sees | built | `partOf`, `abilitiesOf`; `AliceController` gates control by them |
| Being unmade and grafted back: `unmade` on `fell` / `alice-devoured` / `heart-swallowed` of Alice herself (a twin's loss is her own); committed strokes that reach the body rejoin it (`sim.graft`) and glow while fresh | built | `SpiritDirector.witness`, `graft`, `BODY_TUNING.graftGlowMs` |
| Kami's lines for a soul, a body, a snip, a graft | built | `src/game/bossLines.ts` |
| Choosing the mode: `?mode=`, `modeFor`, the card written under the wordmark | built | `src/game/launch.ts` (`modeInUrl`), `Game.writeModeCard` |
| Start screen: an address with no `?mode=` offers Sandbox / Puzzle / Boss (nothing else); one tap writes the mode into the address and opens the page | built | `src/ui/startScreen.ts` (`chooseMode`, `START_CHOICES`) |
| The stuck detector and hint ladder stay quiet while nobody is on the board | built | `Game.frame` |
| A spirit's hand as the camera's subject | not built | the camera follows the soul where it sits, which is where the body will be drawn; a wandering pen is not followed |
| Persistence of the body | not built | the drawing that became her is deleted from the store; a reload opens the room as a soul again, with everything else where it was. Right for a boss fight; a longer spirit game would want the store to remember her |
| Twins of a drawn body | not built | under a clone law her twins wear Kami's plain sketch; the drawn strokes are one body's, and only that body can be snipped |
| Ink that touches a body but is not meant for it | not built | in spirit-opening modes any committed stroke that reaches her is a graft. A sword for her hand is drawn beside her, not on her |

Everything else — laws, natures, the Sumikui, creatures, vehicles — works unchanged on whatever body she has, because none of it knows how she came to have one.
