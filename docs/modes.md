# Game modes

A **mode** is a way to play a board. The board says what is sketched on the paper; the mode says what the *player* is when the room opens, how they come to have a body, what winning and losing mean, which laws and natures the page will take, whether the board id names a room or an endless page, when Kami helps, and whether other devices share the page. Two modes are playable: `EMBODIED_MODE` — Alice stands at the spawn of a room and you draw for her — and `SANDBOX_MODE` — an endless page with no edges that everyone who opens it draws on together. The third, `SPIRIT_MODE`, is a contract for a game nobody has built yet: you open the room as a spirit with no body, draw Alice, name her, and she is yours.

This document is the architecture. The embodied and sandbox modes are playable; everything the spirit mode needs that does not exist yet is listed at the end.

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
- keeps Alice from walking herself when `autopilot` is `"forbidden"`, whatever the HUD switch says;
- reads the board id as `endlessBoard(id)` when `page` is `"endless"`, and as `boardFor(id)` otherwise;
- runs the stuck detector and the hint ladder only when `help` is `"offered"`; with `"on-request"` Kami answers written requests for help instead (`counsel/`);
- follows the board through `BoardLink` when `sharing` is `"live"`, applies what arrives, reports Alice's position, paints the other devices' Alices as ghosts, and swaps the board menu for the share affordance;
- shows the title card from `mode.card` when the mode is not the embodied one.

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

| | `EMBODIED_MODE` | `SANDBOX_MODE` | `SPIRIT_MODE` (contract only) |
|---|---|---|---|
| opening | `body` — she stands at the spawn | `body` — on the strip of ground | `spirit`, incarnation `drawn`, names `alice · her · me` |
| win | `reach-goal` | `endless` | `reach-goal` |
| loss | `respawn` — the sim's own checkpoint path | `respawn` — onto the last ink she stood on | `unmade` — the body is gone; you are a spirit again |
| laws | `all` | `except inkEater` — *"Nothing hungry lives on this page."* | `except clones` — one body at a time |
| natures | `all` | `all` | `all` |
| autopilot | `allowed` | `allowed` — explores toward the newest ink | `forbidden` — a body you drew is a body you steer |
| page | `room` | `endless` | `room` |
| help | `offered` | `on-request` | `offered` |
| sharing | `alone` | `live` | `alone` |

## What the spirit mode still needs

None of this is built; each is a seam that already exists, named so it can be built in order.

1. **A board with nobody on it.** `Simulation.loadBoard(board)` always stands Alice at the spawn. It needs a way to open with her *absent* — no Alice body, no twins, no Sumikui quarry — and `WorldSnapshot.alice` becomes nullable, which the renderer, the camera (`CameraRig.frame` on the spawn instead), the autopilot `Scene` and the Sumikui must all tolerate.
2. **Incarnation by drawing.** The game calls `director.named` at the naming seam and `director.witness` on every sim event, and enacts the transitions. A `SpiritDirector.named(drawingId, ruling)` that answers `{ kind: "incarnated", by: "drawing", drawingId }` when the ruling's name is one of the mode's `names`. The game then asks the sim to `incarnate(drawingId)`: the drawing's strokes are taken out of the ink layer and become her body — `AliceController` built from the drawing's bounds, its strokes drawn as her (a new `AliceLook` for the painter), the drawing's own nature discarded. Her walk speed and jump scale with the body she was given, within the `aliceSize` clamps.
3. **Being unmade.** Where the embodied mode's `fell` / `alice-devoured` respawn her, the spirit director answers `{ kind: "unmade" }` and the game removes her body (a little ink dust where she stood; Kami: *"She's gone back into the pen. Draw her again."*), the player is a spirit, and the room goes on with its ink where it was.
4. **A spirit's hand.** While a spirit, the pen is the only presence. The camera needs a subject that is not Alice (the last pen position, or the spawn); the stuck detector and the hint ladder need to know there is nobody to be stuck.
5. **Choosing the mode.** `?mode=spirit` in the URL, `modeFor(id)` in `startGame`, and a title card from `mode.card` in `ui/` before the room opens.
6. **Persistence.** A body made from a drawing is a drawing that is no longer ink: the `BoardStore` needs to remember which drawing became her, or a reload puts her back as a sketch.

Everything else — laws, natures, the Sumikui, creatures, vehicles — works unchanged on whatever body she has, because none of it knows how she came to have one.
