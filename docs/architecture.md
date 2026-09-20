# Kami — Software Demo Architecture

**Direction (19 Sept, supersedes the page-by-page build):** Kami is the original *Paper* idea (`archive/ideation-v1.md`) made playable with the Alice demo from `spec.md`. One endless whiteboard. You sketch; ink is solid. You write a note beside a sketch and it *is* that thing. You write a note anywhere else — "g = the moon's gravity" — and the world obeys. Kami answers by writing on the board in his own hand. Everything is remembered in MongoDB. The Alice in Wonderland puzzles are one pre-sketched board; a new game is a blank board plus your sketches and notes.

Carried over from the original design, unchanged: **compile once, run forever** — text becomes a small deterministic rule; no model is ever in the frame loop. **One funnel** — a name, a rule and a remark all enter the same way and position decides the target. **Show the gloss** — Kami writes back what he understood.

## Look

A clean whiteboard, not a book page. White board, black marker, no pictures, no textures, no gradients, no panels with drop shadows. Colour is what a whiteboard tray holds and is used sparingly: **black** the player, **blue** Kami's handwriting, **green** understood, **red** confused / hazards / no-ink, plus one marker tint per nature once a drawing wakes. Pre-sketched board geometry is black roughjs marker line with light hatching. Every word on the board — the player's notes, Kami's replies, the "kami 紙" wordmark near each board's spawn — is pen strokes from the handwriting module, never a DOM bubble. The only DOM is a small floating toolbar, zoom buttons and the board menu, styled like Excalidraw's: thin, light, quiet.

## Shape

```
 pointers/wheel ─► ui/attachCanvasInput ─► game ─┬─ draw ─► ink/InkSession ─ commit ─► sim (solid NOW)
 autopilot.drive(scene) ─► sim.setWalkIntent ──►│              │ every pen-lift  ├─► recognition ─► cat.guess ─► Kami writes 3 tappable guesses
                                                 │              └─► reading/PenReader ─► server /api/transcribe ─► words? ─► the funnel below (the ink lifts off)
 arrow keys (override) ─► ui/Hud ──────────────►│
 write tool ────► hud.promptText ─► text ────────┤
                                                 ├─ rules.compile(text) ─► Rule ─► resolvePhysics ─► sim.setPhysics
                                                 ├─ else near a drawing ─► cat.name ─► Ruling ─► sim.applyRuling
                                                 └─ else ─► Kami shrugs, in ink
                       every change ─► persistence/BoardStore ─► server ─► MongoDB
                       every frame  ─► render (camera, board, inks, notes via handwriting.reveal, Alice)
```

`game/` is the only module that knows the others. Everything else depends on `core/` and on other modules' **`types.ts` only**. `server/` shares types with `src/` but nothing in `src/` imports `server/`.

| Module | Owns | Entry points |
|---|---|---|
| `core/` | `Vec`, `Rect`, `Stroke`, `Pose`, geometry, constants | — |
| `board/` | `BoardDefinition`, the Wonderland board, the blank board | `boardFor` |
| `ink/` | Pen input → committed `Drawing`s, placement rules, eraser hit-test | `createInkSession`, `findDrawingAt` |
| `sim/` | matter-js: board solids, ink bodies, Alice, natures and roles, world physics | `createSimulation` |
| `autopilot/` | Alice's own legs: charts solids + ink, plans key → door → goal, waits when there is no way | `createAutopilot` |
| `cat/` | Name → `Ruling`, guesses (recognizer first, geometry second), hint ladder | `createCat` |
| `rules/` | Text → `CompiledRule` (offline grammar), `resolvePhysics` | `createRuleCompiler`, `chainCompilers`, `resolvePhysics` |
| `handwriting/` | Text → timed pen strokes in a single-stroke font | `createHandwriting` |
| `notes/` | The `Note` type | — |
| `recognition/` | Client for Quick, Draw! recognition | `createRecognizer` |
| `persistence/` | Client for the board store, the remote rule compiler and the handwriting reader | `createBoardStore`, `createRemoteRuleCompiler`, `createHandwritingReader` |
| `reading/` | Pen strokes → words while the player is still writing: a read per pen-lift, newest strokes win | `createPenReader`, `couldBeWriting` |
| `render/` | Canvas 2D: camera, board, ink, notes, Alice, props | `createRenderer` |
| `ui/` | Toolbar, zoom, board menu, text prompt; pointers → pen/tap/pan/zoom | `createHud`, `attachCanvasInput` |
| `game/` | The frame loop, the funnel, the camera, all wiring | `startGame` |
| `server/` | Bun HTTP API, MongoDB, Quick, Draw! k-NN, model-backed compile and handwriting reading | `bun run server` |

## Conventions

- **World space** is endless, y-down, px. Only `render/` and `game/` convert to client px, through a `Camera`.
- **Fixed step.** `game/` accumulates real time and calls `sim.step()` in 1/60 s steps.
- **Poses.** Strokes are stored where drawn and never mutated; the sim reports a `Pose` per drawing.
- **No module-level mutable state.** Factories return objects; tests build their own.
- **Ids** are branded strings minted without `crypto.randomUUID` (absent on plain-HTTP LAN origins, which is how the iPad loads the dev server).

## ink/

As before (3 px point filter, one drawing per 900 ms pause, placement verdicts, 8 px minimum), plus `penCancel()` which drops the stroke in progress and refunds it. `reset(Infinity)` is an endless marker: `budget.remaining` stays `Infinity`. `no-ink-zone` and `overlaps-alice` still reject.

## sim/

matter-js 0.20. What changed from the page build:

- `loadBoard(board)`; no page-edge walls; nothing clamps to a page. Alice or ink further than `LOST_DISTANCE` from every solid, or below `board.killY`, is lost: Alice respawns (`fell`), ink is left to fall.
- **Checkpoints.** Alice respawns at the checkpoint of the zone she most recently entered, else `board.spawn`; a drawing ruled `spawn` overrides both from then on. Entering a zone for the first time emits `zone-entered` — including the zone she spawns in.
- **Goal.** `board.goal` overlap → `goal-reached`, once per load. So does touching ink ruled `goal`.
- **Roles.** `solid` ink is static exactly where it was drawn, anchored or not. `goal` and `spawn` ink is static and does not collide with Alice. `hazard` ink is static; touching it respawns her (`fell`).
- **World physics.** `setPhysics(p)` persists across `loadBoard`: `gravity` (g, either axis, zero and negative allowed) drives `engine.gravity`; `wind` is a per-body force in g on every dynamic body including Alice; `timeScale` multiplies with bullet-time; `airDrag`, `friction` and `bounciness` scale or set `frictionAir`, `friction` and `restitution` on ink and Alice. Alice's walk stays a set horizontal velocity; under sideways or zero gravity she may drift — that is the point.
- **Creatures.** `walker`, `hopper` and `flier` are natures with a per-drawing `Mind` (facing, clock, rest) that is reset whenever the ruling changes; their bodies are kept upright (infinite inertia) and never anchor. Each tick the nature's `beforeStep` hook feels the world through `Feelers` — the same nudge probes Alice uses, plus a thin probe dropped ahead of the front foot — and sets a velocity: walkers pace and turn at walls, drops and Alice; hoppers rest, then leap about `HOP_REACH` and turn if there is no ground where they would land; fliers cancel gravity, bob, and turn back beyond `FLY_ROAM_PX` from where they were drawn. Alice standing on a walker or flier is carried (`alice.ride`). Speeds scale with the ruling's strength. The autopilot's chart stamps creatures where they stand right now; the plan is redrawn every few ticks as they move.
- **Vehicles.** `vehicle` is a creature-shaped nature (upright, never anchored) driven by the player instead of a mind: `drive` (`vehicles.ts`) boards Alice once both her feet are over the body and keeps her the driver while she stands on it, ramps `mind.speed` toward `intent.x × VEHICLE_SPEED × strength` by `VEHICLE_ACCELERATION` a tick, sets the body's velocity, and `alice.drive`s her along with it so she rides instead of walking against it. Letting go brakes; pointing the other way reverses; jumping (`takeOff` clears her footing) or stepping off an end leaves it where it stands. The stick and the autopilot both drive it, because both are the one `intent`. The chart treats it as a creature: never a wall in Alice's own square.
- **Load-bearing strokes.** Only `bearingStrokes(drawing)` (`src/ink/bearing.ts`) become body parts and chart stamps: every straight, near-level span at least `MIN_SPAN` wide, and every stroke reaching past or below one; strokes wholly above and within a span — a bridge's towers and cables — are scenery. Rendering, hit-testing and erasing still use every stroke, and a lone stroke is always solid.
- **Laws on Alice and the world** (`docs/laws.md`). `flight` makes her `climbing` wherever she is, so air holds her like a ladder; `walkSpeed` and `aliceSize` multiply her pace and body scale (`applyPhysics` re-runs the resize tween); `attraction` calls `pullToward(alice, g, dynamicInks)` each tick (`attraction.ts`, `1/r²` past 160 px, capped inside); `clones` keeps `Twins` — extra `AliceController`s in the same negative collision group, driven by the same intent, recalled to her feet if they fall — at the folded count; `temperature` runs `weather.ts`, which heats `slippery` above 30 °C and `floaty` above 60 °C until they `perished`. `attractor` is a nature whose `beforeStep` pulls everything but itself; `lantern` is inert in the sim and only matters to the renderer.
- **The Sumikui, the ink eater** (`sumikui.ts`). Off by default; `inkEater = 1` puts one in the world (`BoardWorld.sumikui`), `0` removes it, so erasing the summoning note or writing a banishment seals it through the same fold as every other law. It is not a Matter body: a point that drifts behind Alice's shoulder, stirs once the board holds two drawings, and hunts only the drawings Alice has touched in the last 20 s (`BoardWorld.touchedAt`, written by `resolveAliceTouches`) or stands on — so untouched scribbles are never bait — and never roles (`pinned` natures). It sits on its prey for 1.5 s then `inks.remove`s it and emits `devoured`. Its pace doubles every 20 s awake, clamped to `SUMIKUI_MAX_SPEED`. `sumikuiPainter.ts` draws it (a breathing blot with one pale eye and a dripping trail; the halo darkens with time awake) and `game.ts` recites the summoning lore over three notes, remarks when it wakes and feeds, and says the sealing line in place of "struck from the laws" when its law goes. The player's strokes are never touched: presentation only, and only `InkLayer.remove` takes ink out of the world.
- Everything else (ink compounds, anchoring on `marker` solids only, step-assist, slope limit, resize, natures, key, door) is unchanged. The three Wonderland puzzles must stay solvable on the continuous board — `sim/rooms.test.ts` holds that line, plus one test that moon gravity makes a bounce go higher.

## rules/

`createRuleCompiler()` is an offline grammar; `null` means "not a rule", which lets the funnel fall through to naming. It must feel generous about phrasing and strict about meaning:

| Says | Effect | Gloss |
|---|---|---|
| `g = moon` · `set g equal to the moon's gravity` · `gravity like mars` · `jupiter gravity` | gravity y = 0.165 / 0.38 / 2.53 (table of Sun, planets, Moon, Pluto) | `gravity = 0.17 g (the Moon)` |
| `g = 3.7` · `g = 3.7 m/s^2` · `gravity = 0.5g` · `half gravity` · `double gravity` | m/s² ÷ 9.81, or a multiple of g | `gravity = 0.38 g` |
| `no gravity` · `zero g` · `g = 0` | 0 | `gravity off` |
| `gravity up` · `gravity sideways` · `gravity points left` · `flip gravity` | direction, keeping 1 g unless a size is given | `gravity = 1 g, upward` |
| `slow motion` · `time = 0.5` · `half speed` · `time x2` | timeScale, clamped 0.1–3 | `time runs at 0.5×` |
| `no friction` · `everything is ice` · `friction = 2` | friction | `friction off` |
| `everything is bouncy` · `bounciness = 0.8` | bounciness 0–1 | |
| `no air` · `thick air` · `air resistance = 3` | airDrag | |
| `wind blows right` · `strong wind left` · `wind = 0.3` | wind | |
| `normal gravity` · `reset time` · `back to earth` | that setting's EARTH value (`back to earth` → gravity) | |
| `make alice fly` · `alice walks twice as fast` · `alice is huge` · `clone alice` · `alice attracts everything` | Alice's dials: flight, walkSpeed, aliceSize, clones, attraction | `Alice can fly` |
| `it's hot` · `temperature = 100` · `freezing` · `it's night` · `morning` | temperature (°C), daylight (0–1) | `temperature = 100 °C` |
| `ink eater` · `summon the Sumikui` · `banish the ink eater` | inkEater (0 sealed, 1 loose) | `the Sumikui, the ink eater, is loose` |

The last two rows come from one table-driven recogniser (`recognisers/dials.ts`): a `Dial` row per scalar governs, with its vocabulary, word→value readings and an implied value. New scalar dials are new rows. The formal model — rules as morphisms on `WorldPhysics`, the fold, repeal by refolding, systems — is `docs/laws.md`.

A bare noun phrase with no physics word ("a mushroom", "rock") is never a rule. `resolvePhysics` folds rules over `EARTH`, newest per `governs` wins, so erasing the newest gravity note restores the one before it. `chainCompilers([offline, remote])` lets the server's model try what the grammar can't.

## autopilot/

Alice walks herself; the player only draws. `game/` hands the pilot a `Scene` every step — the board, Alice's snapshot, every committed drawing with its live `Pose` and its nature, key/door progress, and the sim's own figures (`walkSpeed`, `bounceArc(strength)`, `jumpArc`) so plans are made with the world's actual physics — and gets back a `WalkIntent`.

Alice's snapshot carries the law's desired `sizeMultiplier` and the granted `headingScale`. Current planning footprints cover both the live body and its active resize target, allowing Alice to leave a low ceiling while law growth is deferred; hypothetical meals use the same law-scaled dimensions as simulation growth clearance. Plans expire when the multiplier or footprint changes. Growth checks the full target body against fixed solids, excluding the meal being consumed, for Alice and her twins.

- **Chart.** An 8 px grid over the board's extent (plus margin) stamped with board solids, the closed door, the goal and every drawing's transformed strokes, flagged by nature: `solid`, `climbable`, `bouncy` (with strength), `edible` (grow/shrink, remembering the owning drawing), `hazard`, `goal`.
- **Planning limits.** Chart construction accepts at most 4096 cells per axis, 1,000,000 cells total (5 MB of typed arrays), 50,000 geometry items (solids, drawings, strokes and points), and 2,000,000 stamping operations (samples and cell writes). Non-finite/unsafe grid bounds or any exceeded budget return no chart; the pilot waits with `stuck=true` and retries at its normal waiting interval. Artwork and manual control remain intact. Search stances and landing candidates stay inside the chart; jump clearance uses the full arc through known empty air above its extent. Path keys use coordinate pairs rather than a fixed numeric stride. These construction limits are independent of the A* node budget.
- **Pathfinder.** A* over foot positions for her current footprint (`small` / `normal` / `big`): walk with small steps up, fall onto anything landable, climb through climbable ink, bounce off bouncy ink to wherever the arc's apex and drift reach, and jump — up onto a ledge too tall to step, or level across a ditch or a hazard too wide to step — wherever her standing jump's arc lands on something and the parabola in between is clear. A jump costs more per cell than walking, so she walks to the very edge and only jumps where walking fails. Hazards are never entered. Bounded by a node budget.
- **Errands.** Key → door → goal. If the objective is unreachable but a grow/shrink drawing would make it reachable, the errand is to eat it. Otherwise she `wait`s at the nearest reachable stance short of the obstacle (a few body widths back) and `status.stuck` is set; `game/` has Kami write *"She can't see a way on. Draw her one."* once.
- **Replanning.** Every ¼ s, plus immediately on `invalidate()` — `game/` calls it whenever a drawing commits, is named, ruled, erased or eaten, a rule is enacted or repealed, or a board opens — and whenever her size or key/door progress changes. A route that stops making progress for four seconds is dropped and she sulks briefly before trying again.
- **Override.** The thumbstick bottom-left and the arrow keys still walk her; while either is held the pilot is bypassed, and she resumes on release. ↑ (stick or key) on climbable ink climbs; ↑ on the ground jumps, once per press.

## cat/

As before, plus: creature words — every animal (and *robot, knight, person*) is a `walker`, `hopper` or `flier` by how it moves, and *walking / hopping / flying* as adjectives put any noun there; vehicle words — *car, cart, boat, bicycle, train, skateboard…* and *drivable / wheeled* → `vehicle`; role words — *ground, floor, wall, platform, block* → `solid`; *goal, finish, flag, exit, rabbit hole, home* → `goal`; *lava, spikes, fire, danger, acid* → `hazard`; *start, spawn, "alice starts here"* → `spawn`. `createCat(recognizer)`: `guess` asks the recognizer first and maps Quick, Draw! words onto names he knows ("birthday cake" → "a cake", "hot air balloon" → "a balloon"), filling up to three with the geometric hunch; with no recognizer or an empty answer it is the hunch alone.

## handwriting/

A single-stroke handwriting font — **EMS Felix** (SIL OFL, from the `hersheytext` package's `svg_fonts/`) — converted at build time by `scripts/buildStrokeFont.ts` into a compact JSON glyph table that is committed (`handwriting/fonts/`), with the licence notice beside it. `write` lays text out (word wrap at `maxWidth`, unknown characters → a fallback glyph), scales to `size`, and adds seeded human wobble: baseline drift, per-glyph jitter, slight slant variation. Timing: pen speed roughly constant along each stroke, short lifts between strokes, longer between words, so a line takes about as long as a person would. `reveal` returns finished strokes whole and cuts the one in progress at the right arc length. Pure and deterministic — fully unit-testable.

## recognition/ and persistence/

Thin HTTP clients for the server, same origin (`/api`, proxied by Vite in dev). Both swallow every failure: `recognize` → `[]`, `load` → an empty snapshot, writes → dropped with one console warning. `createRemoteRuleCompiler` → `null` when the server has no model.

## render/

Canvas 2D at device pixel ratio (cap 2). `toWorld(client, camera)` and `viewport()` are the only geometry it exports. Per frame: clear to white → faint dot grid that thins out as you zoom away → the board's pre-sketched solids (roughjs, seeded, cached per board as drawables and replayed under the camera transform; glass pale blue; no-ink zones red hatching; goal a scribbled black hole; door; key) → inks (perfect-freehand, black until awake, then the nature's marker tint, ~500 ms shiver) → notes (`handwriting.reveal(script, now - writtenAtMs)` through perfect-freehand, thinner than ink; blue for Kami, black for the player, green/red by tone; tappable ones underlined; `opacity`) → her twins, then Alice (black marker stick doodle, two-frame walk, scales with size, holds the key) → active strokes (red when the verdict isn't `ok`) → night (`NightPainter`: when `frame.daylight < 1`, a dark layer on an offscreen canvas with radial pools cut out around Alice and every `lantern` ink, composited over the board). Cull anything whose bounds miss the viewport. Depends on `handwriting/types` only; `createRenderer(canvas, handwriting)`.

## ui/

`touch-action: none` and every iPad guard from before. Floating **toolbar** top-centre: draw ✎ · write T · erase ⌫ · pan ✋ (`aria-pressed`, keys `D` `T` `E` `H`; holding Space pans temporarily). Alice walks herself; a translucent **thumbstick** bottom-left (`Joystick`: one pointer, pen, finger or mouse, dead zone then the pushed axis, a real diagonal takes both, springs back on lift or window blur) and the arrow keys are the manual override. A physical arcade stick is a third source of the same `WalkIntentMerger`: `controller/` (`createRemoteStick` → `RemoteStick`) listens to the server's event stream for the controller `?controller=` names (`arcade` by default, `off` for none) and reports its held directions, button A counting as ↑; it lets go of everything when the stream errors — the protocol is in `docs/controllers.md`. **Zoom** − / + / ⌖ recentre bottom-right. **Board menu** top-left: the wordmark "kami", current board, a list of boards, "new board", "clear board". No bubbles, meters, title cards or modals.

Every control activates on `pointerup` (`activateOnTap`), so Apple Pencil, finger and mouse taps all work; the click a browser then synthesises is swallowed, while clicks with no pointer behind them (Enter, Space, `.click()`) still activate. A press that is cancelled or lifts off the control does nothing.

`promptText(client)`: an absolutely positioned single-line input at the tap, handwriting-style CSS font, ≥16 px, transparent with a marker underline, `enterkeyhint="done"`; Enter commits, Escape or blur with no text abandons; works with Apple Pencil Scribble since it is a real text field. While it is open, keys never walk Alice or switch tools.

`attachCanvasInput`: one primary pointer → pen events for draw/erase, `panBy` for pan, nothing for write; a press that never travels 6 px ends as `penCancel` + `tap`; a second touch cancels the stroke and starts pan + pinch (`zoomAt` about the midpoint) until all fingers lift; wheel pans, ctrl/meta-wheel (trackpad pinch) zooms about the cursor; `getCoalescedEvents`; pointer capture; `Detach` removes everything.

## server/

Bun, `Bun.serve`, the official `mongodb` driver, zod at the boundary. `MONGODB_URI` (Atlas at the hackathon); without it, `mongodb-memory-server` runs a real `mongod` with its data in `.kami-data/` so memory survives restarts with zero setup. Database `kami`.

| Route | |
|---|---|
| `GET /api/boards` | summaries |
| `GET /api/boards/:board` | `{ drawings, notes, rules }` |
| `PUT` / `DELETE /api/boards/:board/{drawings,notes,rules}/:id` | upsert / remove one document |
| `DELETE /api/boards/:board` | clear the board |
| `POST /api/recognize` `{ strokes }` | `{ guesses: string[] }` |
| `POST /api/compile` `{ text }` | `{ rule: CompiledRule \| null }` |
| `POST /api/transcribe` `{ strokes }` | `{ text: string \| null }` |

**Quick, Draw!** `bun run quickdraw:ingest` range-fetches the first few hundred drawings of ~40 curated categories (mushroom, ladder, cloud, cake, stairs, key, door, …) from the public simplified ndjson into the `quickdraw` collection, each with a precomputed feature: strokes normalised to their bounds, rasterised to a small grid, blurred, L2-normalised. `/api/recognize` builds the same feature from the player's strokes and answers by cosine k-NN over the in-memory set, voting by category. No ingest yet → `[]`, and the Cat falls back to geometry. The ASUS Ascent GX10 can replace k-NN with a trained classifier behind the same route.

**Model-backed compile.** If `KAMI_LLM_URL` (any OpenAI-compatible `/v1/chat/completions`, e.g. vLLM or Ollama on the GX10) and `KAMI_LLM_MODEL` are set, `/api/compile` asks the model for a `RuleEffect` as JSON, validates it with zod, clamps it, and returns it; otherwise `{ rule: null }`. Compile once: the result is stored as a `Rule` and never asks the model again.

**Handwriting reading.** With the same model, `/api/transcribe` draws the strokes into a small PNG and asks it, as a vision model, whether they are words or a drawing (`server/README.md` → "Handwriting reading"). `null` means a drawing.

## reading/

The player writes with the pen like they draw with it; nothing is selected first. `PenReader` sits between the ink session and the funnel: at every pen-lift `game.penUp` shows it the strokes so far, and if they `couldBeWriting` (not a lone straight line, not taller than a line of writing, not dozens of strokes) it asks the `HandwritingReader` and aborts the read of the strokes before — only the newest strokes can turn out to be the whole word, and a prefix of a word is a different word, so an answer is only ever trusted for exactly the strokes it was asked about (keyed by stroke and point counts, which only grow within one drawing). By the time the ink commits ~900 ms after the last lift the answer is usually in (`recall`) or about to be (`settle` hands back the in-flight promise). Nothing waits: the drawing lands as ink at once and, if the words arrive later, `game.liftWords` takes it back off the board (unless it has been named meanwhile), refunds the ink and puts the text through the funnel at the strokes' top-left. Strokes the placement rules rejected still get read (`onReject` carries them), so writing over glass or a no-ink zone works. Without a reader (`GameModules.penReader` unset, or the server has no model) ink is only ink and the text prompt is the only way to write.

## game/

- **Funnel** for written text at a world point: `rules.compile` → a `Rule` (note turns green, Kami writes the gloss beneath, `sim.setPhysics(resolvePhysics(rules))`); else the nearest drawing within ~160 px → `cat.name` → `applyRuling` (Kami writes his line); else Kami writes a shrug and the note stays as plain writing.
- **Law precedence** is captured when the player submits the note, before compilation. `createdAt` is a logical millisecond timestamp: at least wall time and strictly greater than the preceding submission or any restored note/rule. Same-millisecond submissions therefore keep their order across out-of-order responses, reload and repeal. Existing equal timestamps retain the rule-id tie-breaker.
- **Guesses.** While the pen is down, each stroke asks `cat.glimpse` (`sight(strokes, { partial: true })`, calls coalesced so at most one is in flight) and Kami pencils his current best guess beside the ink; an empty answer keeps the last one. On commit, `cat.look` asks once more without `partial`: a `certain` first sighting names the drawing at once and Kami writes the label himself (writing another name still renames it); otherwise Kami writes three tappable guesses beside the drawing; tapping one names it; they vanish when it is named, erased, or after ~20 s. Where the local lexicon only sees "ink", the sighting's `name`, `nature`, `strength` and `line` rule the drawing. Nothing blocks and nothing holds time still.
- **Eraser** removes drawings (and their guesses) and notes; erasing a rule's note repeals the rule. The standing laws are also listed top-right (`ui/lawsPanel`) long after their notes fade; tapping a law twice repeals it through the same path.
- **Layout.** No note is written on top of another. `NoteBook.write` measures the script where it was asked for and, if that overlaps existing writing, slides it whole line-heights clear (`noteLayout.settle`): Kami's remarks above Alice drift up, replies beneath a note and guess chips drift down, and the player's own notes drift down off Kami's glosses. The placed position is what gets persisted.
- **Camera** follows Alice loosely when she walks outside a central dead-zone; any manual pan or zoom suspends following until she walks again or ⌖ is pressed. Zoom 0.25–4.
- **Walking.** Before every sim step: a held arrow key wins, else `autopilot.drive(scene)`. The pilot is reset on board open and invalidated on every ink or rule change (see `autopilot/`).
- **Boards.** `?board=<id>` in the URL; default `wonderland`. On load: `store.load` → re-add drawings and rulings, notes, rules. A loading note is shown while simulation and editing are paused; panning, switching boards and clearing remain available. Clearing starts an editable empty board immediately. An older load cannot restore or unlock a newer board. Held walk input survives a board load.
- **Bullet-time** only while the pen is down.
- On `goal-reached` Kami writes a closing line; play continues.

**Tidying.** When a drawing gets its name (tapped, written, or Kami's own when he is `certain`),
`Game.tidy` asks `LiveRecognizer.complete(strokes, name)` once. The answer is the player's own strokes,
point for point, each nudged a bounded distance toward a clean drawing of the same thing, plus any parts
theirs was missing (`ml/CONTRACT.md`, "Completion"). `InkLedger.retrace` swaps the strokes in and keeps the
old ones as a `Retrace`; for `RETRACE_MS` `views()` shows `retracedStrokes(from, to, progress)` — the ink
glides into place, then what was added is drawn in — and the tidied drawing is saved. No answer, a late
answer on another board, or ink that changed meanwhile: nothing happens. The sim keeps the body it built
from the ink as drawn (the two differ by less than a pen's width) and builds from the tidied strokes
the next time the board opens, so an added part is solid from then on.

## Known limits of the demo

- **Alice rides nothing.** The pilot plans over ink where it currently rests; she will not wait for a floating or falling drawing to line up. A blank board with no goal leaves her idle until one is drawn and named.
- **Poses are not remembered.** A drawing is stored where it was drawn, so after a reload dynamic ink reappears there and settles again.
- **One effect per rule.** "low gravity and slow time" is two notes. Relative phrasings ("flip", "double") are relative to Earth, not to the current value.
- **Clamps differ** between the offline grammar (`rules/`) and the model-backed compiler (`server/compile/effectRanges.ts`); the latter is wider.
- **The model-backed compiler has never met a real model.** It is tested against an injected fetch and a fake OpenAI-compatible server only.
- **Recognition is k-NN**, good on distinctive shapes (mushroom, ladder) and weak on scribbly ones (zigzag, bird); measured accuracy is in `server/README.md`. Restart the server after an ingest.
- **No eraser cursor**, since the renderer is never told where the pointer is.
- **Not yet touched by a real finger.** Gestures and palm rejection are unit-tested with synthetic pointers, and the page renders correctly in iPadOS Safari (simulator), but nobody has drawn on it with an Apple Pencil.
