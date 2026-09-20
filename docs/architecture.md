# Kami — Software Demo Architecture

This is the current integration guide, checked against main **`1b2ceed` (20 September 2026)**.
[spec.md](spec.md) is authoritative for product requirements. This guide describes the code;
differences from the spec are tracked [below](#product-scope-and-verification), not approved by
changing a description. [Archived engineering notes](archive/engineering-notes-v3.md) and the
other archive plans are historical proposals.

The demo is one endless whiteboard. You sketch, name drawings and write laws. Kami answers in
handwriting. The Wonderland puzzles are one pre-sketched board; a new board starts blank.
Drawings, persistent notes and laws are saved through MongoDB; transient guesses, live poses and
unacknowledged edits are not durable.

**Compile once, run forever:** text becomes a deterministic rule; no model is called from the
simulation step. Typed, handwritten and spoken text share the same
[ordered funnel](#game). Known laws take priority over position; a known nearby name takes priority
over model fallback. Kami writes the gloss of what was understood.

## Contract map and ownership

| Contract | Source and detail |
|---|---|
| Every component, its files, status and contract | [components.md](components.md) |
| Browser wiring and text dispatch | [game/index.ts](../src/game/index.ts), [game/game.ts](../src/game/game.ts) |
| HTTP payloads, configuration and failure responses | [server API contract](../server/README.md#api-contract-what-the-client-may-rely-on) |
| Rule types, persistence domains and model clamps | [rules/types.ts](../src/rules/types.ts), [effectDomains.ts](../src/rules/effectDomains.ts), [persistence/schemas.ts](../src/persistence/schemas.ts), [effectRanges.ts](../server/compile/effectRanges.ts); [laws](laws.md) |
| Sketch input budgets and browser model answers | [inputLimits.ts](../src/core/inputLimits.ts), [recognition/types.ts](../src/recognition/types.ts) |
| Training/serving tensor, artifact and completion contract | [ml/CONTRACT.md](../ml/CONTRACT.md) |
| Board response validation and ordering | [validation](persistence-validation.md), [ordering](persistence-ordering.md) |
| Physical controller protocol and speech | [controllers](controllers.md), [voice](voice.md) |

Follow [AGENTS.md](../AGENTS.md): the client owns gameplay under `src/`; the server owns
`server/`, deployment, ML and the two HTTP-client areas `src/persistence` and `src/recognition`.
Coordinate additive changes across this seam. `RuleEffect` changes require the shared persistence
schema (re-exported by `server/schemas.ts`), effect domains and model clamp to stay compatible;
coordinate the model prompt and remote decoder as well. Typechecking catches schema/type drift;
it does not prove model output quality. Specialist docs above expand this guide.

## Look

A clean whiteboard, not a book page. White board, black marker, no pictures, no textures, no gradients, no panels with drop shadows. Colour is what a whiteboard tray holds and is used sparingly: **black** the player, **blue** Kami's handwriting, **green** understood, **red** confused / hazards / no-ink, plus one marker tint per nature once a drawing wakes. Pre-sketched board geometry is black roughjs marker line with light hatching. Every word on the board — the player's notes, Kami's replies, the "kami 紙" wordmark near each board's spawn — is pen strokes from the handwriting module, never a DOM bubble. Controls and status use a light, quiet DOM overlay.

## Shape

```
 pointer → InkSession → PenReader → words? → text funnel
                         └ no words → sim + ledger + store → Cat.look → naming
 typing / voice transcript ───────────────→ text funnel
 text funnel: offline compile → scene → summons → nearby non-ink naming → remote compile
               └ law              └ laws + props   └ Kami inks an exemplar   └ ruling     └ law / plain-ink name / shrug
 keyboard / stick / controller SSE → WalkIntentMerger → sim
 optional autopilot ──────────────────────────────────→ sim (when manual input is idle)
 persistent entities → BoardStore → Bun API → MongoDB
 each frame → render (camera, simulation, ink ledger, handwritten notes)
```

`game/` coordinates the modules. Shared geometry, validation and domain helpers also have runtime
consumers across module boundaries; this is not a types-only dependency graph. `server/` imports
browser-safe contracts from `src/`; the browser does not import server implementation.

| Module | Owns | Entry points |
|---|---|---|
| `core/` | `Vec`, `Rect`, `Stroke`, `Pose`, geometry, constants | — |
| `board/` | `BoardDefinition`, the Wonderland board, the blank board, the endless page | `boardFor`, `endlessBoard` |
| `ink/` | Pen input → committed `Drawing`s, placement rules, eraser hit-test | `createInkSession`, `findDrawingAt` |
| `sim/` | matter-js: board solids, ink bodies, Alice, natures and roles, world physics | `createSimulation` |
| `autopilot/` | Alice's own legs: charts solids + ink, plans key → door → goal, waits when there is no way | `createAutopilot` |
| `cat/` | Name → `Ruling`, guesses (recognizer first, geometry second), hint ladder | `createCat` |
| `rules/` | Text → `CompiledRule` (offline grammar), `resolvePhysics` | `createRuleCompiler`, `chainCompilers`, `resolvePhysics` |
| `handwriting/` | Text → timed pen strokes in a single-stroke font | `createHandwriting` |
| `modes/` | `GameMode`: what the player is when a room opens, win/loss, which laws and natures the page takes, room or endless page, help offered or on request, shared or alone; `EMBODIED_MODE` is today's play, `PUZZLE_MODE` seven staged rooms with the Sumikui loose (`modes/puzzle/`, `docs/puzzles.md`), `SANDBOX_MODE` the endless shared page, `SPIRIT_MODE` opens as a soul, `BOSS_MODE` is the two-player fight (`docs/modes.md`, `docs/boss.md`); `SpiritDirector` incarnates a drawing named as a body (`bodyNames.ts`) | `createDirector`, `modeFor`, `allowsLaw`, `refusalLine`, `namesABody`, `PUZZLE_ROOMS` |
| `counsel/` | Kami's help on request: what is around Alice (a gap, a wall, a drop, open page) → a line and, where a picture helps, a sketch to summon | `isHelpRequest`, `isIdeaRequest`, `surroundingsOf`, `counselFor`, `placeSketch` |
| `sync/` | The wire for shared pages (`BoardChange`, `FeedMessage`, zod mirrors shared with the server) and `BoardLink`: follows a board's event stream, hands changes and presence to the game, reports Alice's position | `BoardLink`, `mintPeerId`, `parseFeedMessage` |
| `notes/` | The `Note` type | — |
| `recognition/` | HTTP recognition, structured sightings and validated completion | `createRecognizer` |
| `controller/` | Server event stream → held directions, released on error | `createRemoteStick` |
| `persistence/` | Client for the board store, the remote rule compiler and the handwriting reader | `createBoardStore`, `createRemoteRuleCompiler`, `createHandwritingReader` |
| `reading/` | Pen strokes → words while the player is still writing: a read per pen-lift, newest strokes win | `createPenReader`, `couldBeWriting` |
| `render/` | Canvas 2D: camera, board, ink, notes, Alice, props | `createRenderer` |
| `ui/` | Toolbar, zoom, board menu, text prompt, hold-to-talk, the share panel and the mode's title card; pointers → pen/tap/pan/zoom | `createHud`, `attachCanvasInput` |
| `voice/` | Hold-to-talk or wake-word mic → the server's Deepgram proxy → words for the funnel; Kami's lines spoken back (`docs/voice.md`) | `createVoice` |
| `game/` | The frame loop, the funnel, the camera, all wiring | `startGame` |
| `server/` | Bun API, MongoDB, Eye → k-NN recognition, completion proxy, model compile/transcription, controller hub and Deepgram proxy | `bun run server` |

## Conventions

- **World space** is endless, y-down, px. Only `render/` and `game/` convert to client px, through a `Camera` — `center`, `zoom` and `angle` (degrees clockwise the paper is turned on screen). `toWorld`/`toClient` rotate about the centre, `deviceTransform` is the matching canvas matrix (`applyDeviceTransform`), and `visibleWorld` is the world rectangle that covers the turned viewport, so drawing, erasing, tapping and zoom-about-the-pencil all work whichever way the paper is turned.
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
- **Tempers.** A creature's `Ruling` may carry a `temper` (`follows` | `flees`), resolved by `cat/temper.ts` from the player's words first (`FOLLOWING_WORDS`, `FLEEING_WORDS`) and the animal's nature second (`FOLLOWERS`, `FLEERS`); `applyRuling` writes it into the drawing's own motion as the `heed` dial (`heedOf`: follows = 1, flees = −1), and `InkEntity.temper` reads the folded `motion.heed` back, so a law written later — `recognisers/heed.ts`: "the cat chases me", "the dog follows Alice", "the mouse runs away from her", "the cat ignores me" — overrules the name and its repeal restores it. The Eye's sightings carry the same born temper (`sight.ts:rulingOf`), so a dog Kami recognises heels like a written one. Each creature strategy asks `urgeOf(ink, world)` once a tick — `heel` (a follower within `HEEL_PX` of Alice waits), `toward`, `away` (a fleer within `FLEE_RADIUS_PX`, at `FLEE_HASTE`) or `roam` (no temper, or a fleer she has left behind) — and the same walk/hop/fly code runs with the facing set toward or away from her instead of by the roam rules. Fliers that follow head for a perch `PERCH_ABOVE_PX` over her head. Alice's own steering is untouched; the creatures read her position, never her intent.
- **Portals.** `portal` is a role (`solidToAlice: false`, charted as air) whose `onAliceTouch` calls `world.warp(ink)`. `sim/portals.ts` orders portals by the ink layer (drawing order) and sends her out of the next one, the last leading back to the first, with `alice.warpTo(centre)` keeping her velocity. The portal she came out of refuses her until a tick in which she no longer touches it, so she cannot ping-pong; a lone portal emits `portal-lonely` (throttled by `PORTAL_LONELY_COOLDOWN_MS`) and does nothing else. The game answers `warped` with a Kami line and an autopilot replan.
- **Vehicles.** `vehicle` is a creature-shaped nature (upright, never anchored) driven by the player instead of a mind: `drive` (`vehicles.ts`) boards Alice once both her feet are over the body and keeps her the driver while she stands on it, ramps `mind.speed` toward `intent.x × VEHICLE_SPEED × strength` by `VEHICLE_ACCELERATION` a tick, sets the body's velocity, and `alice.drive`s her along with it so she rides instead of walking against it. Letting go brakes; pointing the other way reverses; jumping (`takeOff` clears her footing) or stepping off an end leaves it where it stands. The stick and the autopilot both drive it, because both are the one `intent`. The chart treats it as a creature: never a wall in Alice's own square.
- **Load-bearing strokes.** Only `bearingStrokes(drawing)` (`src/ink/bearing.ts`) become body parts and chart stamps: every straight, near-level span at least `MIN_SPAN` wide, and every stroke reaching past or below one; strokes wholly above and within a span — a bridge's towers and cables — are scenery. Rendering, hit-testing and erasing still use every stroke, and a lone stroke is always solid.
- **Laws on Alice and the world** (`docs/laws.md`). `flight` makes her `climbing` wherever she is, so air holds her like a ladder; `walkSpeed` and `aliceSize` multiply her pace and body scale (`applyPhysics` re-runs the resize tween); `attraction` calls `pullToward(alice, g, dynamicInks)` each tick (`attraction.ts`, `1/r²` past 160 px, capped inside); `clones` keeps `Twins` — extra `AliceController`s in the same negative collision group, each hearing her own intent (`setWalkIntent(intent, who)`; `AliceIndex` 0 is Alice herself, twins follow in spawn order), each with her own portal memory, goal and fall, recalled to Alice's feet only when she strays `TWIN_STRAY_DISTANCE` sideways — at the folded count; `temperature` runs `weather.ts`, which heats `slippery` above 30 °C and `floaty` above 60 °C until they `perished`. `attractor` is a nature whose `beforeStep` pulls everything but itself. `lantern` is inert to physics, but in **pitch dark** (`nightfall.ts`: `daylight` below `PITCH_DARK_BELOW`) an Alice will not take a step outside `LANTERN_LIGHT_PX` of one — the same radius the night painter cuts out — and the sim says so once per board (`in-the-dark`); her intent still counts, she just does not follow it.
- **Motion on drawings** (`motion.ts`, `docs/laws.md` §2.1). Every `InkEntity` carries a `Motion` — spin (turns/s), thrust (g), mass, bounce, grip — resolved by `InkLayer` from what its *name* asked for (`Ruling.motion`, e.g. "a spinning wheel") under every standing `BodyLaw` in `physics.bodies` that speaks of it (`rules/motion.ts`: `all`, or a `named` word shared with the drawing's name; later laws win). `moveOfItself` runs before the engine step: `spin` sets a loose body's angular velocity or turns a held body in place (creatures and roles are exempt); `thrust` is `push(body, g)`. `materialMoved` folds mass, grip and bounce into the body's density, friction and restitution over the world material, so "the rock is heavier" really does sink a see-saw. The powers — `pace`, `wings`, `size` — are the same dials Alice has, on any drawing: creatures and vehicles multiply their own speed by `pace`; `stepOf` (`natures.ts`) swaps a winged walker's or hopper's step for `fly` (which climbs to perch height from the ground) and cancels gravity for anything else winged, so a rock hangs and a car takes off once rolling (`vehicles.ts: liftsHer` — up and down then steer it, and Alice does not jump off mid-air); `size` scales the strokes about the drawing's origin in `Pose.scale`, so rendering, hit-testing, culling and the rebuilt Matter body all agree, and `InkLayer.resize` keeps the feet where they were.
- **The Sumikui, the ink eater** (`sumikui.ts`). Off by default; `inkEater = 1` puts one in the world (`BoardWorld.sumikui`), `0` removes it, so erasing the summoning note or writing a banishment seals it through the same fold as every other law. It is not a Matter body: a point that drifts behind Alice's shoulder, stirs once the board holds two drawings, and hunts only the drawings Alice has touched in the last 20 s (`BoardWorld.touchedAt`, written by `resolveAliceTouches`) or stands on — so untouched scribbles are never bait — and never roles (`pinned` natures). It sits on its prey for 1.5 s then `inks.remove`s it and emits `devoured`. Its pace doubles every 20 s awake, clamped to `SUMIKUI_MAX_SPEED`. `sumikuiPainter.ts` draws it (a breathing blot with one pale eye and a dripping trail; the halo darkens with time awake) and `game.ts` recites the summoning lore over three notes, remarks when it wakes and feeds, and says the sealing line in place of "struck from the laws" when its law goes. The player's strokes are never touched: presentation only, and only `InkLayer.remove` takes ink out of the world.
- **The paper's turn** (`paper.ts`). `PaperTurn` holds the angle the page is turned on screen: the `tilt` law plus what the `worldSpin` law has accumulated tick by tick (under `timeScale`; a new tilt restarts the count), wrapped to ±180°. `Simulation.paperAngle()` exposes it and `Game` hands it to `CameraRig.turnTo` each frame, so the *camera* turns — the engine's gravity and every body stay in paper coordinates and nothing about Alice, creatures, vehicles, portals, the Sumikui or the autopilot changes. Only loose ink (`isLooseInk`: not a walker, hopper, flier or vehicle, not static) feels the room: `tumble` pushes each such body by the difference between the room's down seen on the turned paper and the paper's own gravity, so a pebble slides off a sideways page and falls up off an upside-down one while Alice keeps walking on it. Body-level `spin` (a drawing turning) is unrelated to `worldSpin` (the page turning).
- **The Sumikui, the ink eater** (`sumikui.ts`). Off by default; `inkEater = 1` puts one in the world (`BoardWorld.sumikui`), `0` removes it, so erasing the summoning note or writing a banishment seals it through the same fold as every other law. It is not a Matter body: a point that drifts behind Alice's shoulder and stirs once the board holds two drawings. Everything on the paper is ink to it, so each tick it scores a `Quarry` over a `HuntingGround` and returns what it has finished eating: **ink** — drawings Alice or a clone has touched in the last 20 s (`BoardWorld.touchedAt`) or stands on, never roles (`pinned` natures), chewed for 1.5 s and then `inks.remove`d (`devoured`); **paper** — the board's own solid under an Alice's feet, chewed for 1.5 s and then bitten out (`paper-bitten`); **Alice** herself, held for 0.7 s and swallowed (`alice-devoured`, which sets `aliceLost` so she respawns through the ordinary `fell` path; it is gorged for 8 s afterwards and its pace starts over). Where Kami sets her down (spawn and checkpoints, `SUMIKUI_HALLOWED_PX`) is hallowed: neither that paper nor an Alice standing on it is prey. Untouched scribbles are never bait — until it has been awake `SUMIKUI_SWEEPS_AFTER_MS`, after which nameless clutter she never used is swept up in one gulp instead of stalked; named things are still spared unless she leaned on them. Its pace doubles every 20 s awake, clamped to `SUMIKUI_MAX_SPEED`, and it only holds a meal while it can keep up with it, so a moving Alice is safe from a slow Sumikui and not from a quick one. `BoardProps` owns the bitten paper: each solid is split into the rectangles left around its `Scar`s and rebuilt as static bodies, scars heal after `SUMIKUI_SCAR_HEALS_MS` (`paper-healed`), and `WorldSnapshot.bites` carries the holes to the chart (`Scene.bites`, cleared from the solid cells) and the renderer. `sumikuiPainter.ts` draws it (a breathing blot with one pale eye whose pupil widens with what it hunts, a dripping trail, a halo that darkens with time awake); `inkPainter` dissolves the drawing between its teeth stroke by stroke as `SumikuiSnapshot.bite` climbs, Alice fades as it closes on her, and `boardPainter` paints the ragged holes. `game.ts` recites the summoning lore over three notes, remarks when it wakes, feeds, bites the ground and swallows her, and says the sealing line in place of "struck from the laws" when its law goes. The player's strokes are never touched: presentation only, and only `InkLayer.remove` takes ink out of the world.
- **Retuning under a new law.** `setPhysics` re-materialises every ink body (`worldPhysics.ts:retune`); a body that has settled static keeps its density, because Matter's `setDensity` on a static body leaves its inertia unsound and the next dynamic step goes `NaN`.
- **A soul and a drawn body** (`body/drawnBody.ts`, `docs/boss.md`). `disembody()` takes Alice off the board: `WorldSnapshot.alice` is `null` and `soul` is a heart at the spawn; twins, the Sumikui, the autopilot `Scene`, the night lights and the camera all tolerate her absence. `incarnate(drawingId, name)` takes the drawing out of the ink layer and hands its strokes to a fresh `AliceController.wear`: the strokes, kept in body space and scaled with `aliceSize`, stay authoritative — the body is built from their bounds, cut along them, painted from them (`AliceLook` `drawn`). Each stroke is segmented into a `BodyPartKind` by where it sits against the heart; `abilitiesOf` turns the living parts into `walk / jump / climb / fly / see` and the controller gates its own movement by them. `snip(cut)` removes every stroke a segment crosses (`Snipped.heartCut` when it passes the heart); `graft(strokes)` rejoins committed ink that touches the body, glowing while fresh.
- **The tear and its servants** (`boss/tear.ts`, `boss/snipper.ts`, `boss/weapons.ts`, `boss/tuning.ts`). `openTear()` rips the page above the body; the `Tear` sends the servant, keeps the mercy window after a landed snip, sends the lesser waves as the servant's health falls, and closes when it perishes (`tear-closed`). A `Snipper` is not a Matter body: a point with a phase (`arriving → circling → winding → lunging → recovering`, or `perishing`) whose wind-up fixes the `Cut` it will make; when a lunge ends, `Simulation.suffer` judges it once — a drawing across the cut is cut instead (`shielded`), else the body is snipped (`snipped`, `heart-swallowed`) or the blades close on nothing (`snip-missed`). `blowFrom` turns drawings touching a snipper into damage: hazards on contact, anything else only while moving, more when heavy or spinning. Presentation in `render/bossPainter.ts`; Kami's lines in `game/bossLines.ts`.
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
| `tilt the world 90°` · `the paper is upside down` · `the world is sideways` · `tilt the world to the left` · `the world is upright` | tilt (°, clockwise) | `the paper is turned 90°` |
| `the world spins` · `the world spins slowly` · `spin the world counterclockwise` · `the world rotates at 10 degrees per second` · `stop the world spinning` | worldSpin (°/s) | `the paper turns at 15°/s` |
| `the wheel spins` · `the wheel spins backwards at 3 turns per second` · `everything spins` · `the wheel stops spinning` | spin, of `named(wheel)` / `all` | `the wheel: spin = 1 turns/s` |
| `the cart accelerates` · `the rocket accelerates upward at 2g` | thrust (g, either axis), of a target | `the cart: thrust = 0.5 g, to the right` |
| `the rock is heavier` · `every rock weighs 3 times more` · `the rock is weightless` · `the ball is bouncy` · `the ramp is slippery` · `the ramp is sticky` | mass, bounce, grip, of a target | `the rock: weight = 2x` |
| `the dog can fly` · `the dog cannot fly anymore` · `the cat is twice as fast` · `the dog is slow` · `the rabbit is huge` · `the rabbit is tiny` · `everything is 3 times bigger` | wings, pace, size, of a target (Alice's own sentences keep her dials) | `the dog: can fly` |

The two paper rows are `recognisers/paper.ts`, which only fires when the sentence names the paper (`world`, `paper`, `page`, `board`, `screen`, `view`, `camera`, `scene`, `room`…) so `the wheel spins` and `everything spins` stay body-level spin and `flip gravity` stays gravity; a stated number is degrees, or degrees per second when a rate word follows it. The Alice/ambience/Sumikui rows come from one table-driven recogniser (`recognisers/dials.ts`): a `Dial` row per scalar governs, with its vocabulary, word→value readings and an implied value. New scalar dials are new rows. The last four rows are `recognisers/motion.ts`, the same table plus a target: the noun after "the"/"every" that is not a physics word, or "everything"; sentences about Alice fall through to her own dials, and the world's recognisers run first so "everything is bouncy" is still world `bounciness`. The formal model — rules as morphisms on `WorldPhysics`, the fold, repeal by refolding, systems — is `docs/laws.md`.

A bare noun phrase with no physics word ("a mushroom", "rock") is never an offline rule.
`resolvePhysics` folds rules over `EARTH`; erasing the newest gravity note restores the one before
it. Body laws retain their named/all targets. Although `chainCompilers` exists, the game wires
offline `compiler` and remote `thinker` separately so nearby naming runs between them.

## autopilot/

Alice is manually controlled by default. `?autopilot=on|off` overrides the device's remembered
HUD choice; only `"on"` enables self-driving, and a mode can forbid it. When enabled and no manual
intent is held, `game/` hands the pilot a `Scene` — the board, Alice's snapshot, drawings with live
poses, key/door progress, the Sumikui's snapshot if it is loose, and the sim's `walkSpeed`,
`bounceArc(strength)` and `jumpArc` — and gets back a `WalkIntent`.

- **One pilot per Alice** (`game/party.ts`, see `docs/agency.md`). `Party` hires a `Pilot` for every body the sim reports (`sim.alices()`), keeps them matched to the `clones` fold, and each frame gives every pilot her own `Scene` — `alice` is that body, `others` are the rest — and sets that body's intent. The chart is built once per frame per set of inks and shared (`Charter` in `PilotOptions`); plans, stuck detectors and route memory are per pilot. Alice bodies are never stamped solid: `others` widen the chart's extent and any creature ink overlapping an Alice is skipped, so no Alice walls another in. A twin's pilot `wanders` when there is no errand — a deterministic stroll seeded by her index, turning about every `WANDER_PX` — so clones spread out rather than idle in a stack; Alice herself waits as before.

Alice's snapshot carries the law's desired `sizeMultiplier` and the granted `headingScale`. Current planning footprints cover both the live body and its active resize target, allowing Alice to leave a low ceiling while law growth is deferred; hypothetical meals use the same law-scaled dimensions as simulation growth clearance. Plans expire when the multiplier or footprint changes. Growth checks the full target body against fixed solids, excluding the meal being consumed, for Alice and her twins.

- **Endless pages** (`board.page === "endless"`). The chart's extent is a `WINDOW_PX` window around every Alice on the page, never the board's (there is none). With no objective and no threat the errand is `explore`: `frontierOf(scene)` is the top of the newest ink, or `WINDOW_PX.x` ahead in the direction she faces when nothing has been drawn; the pilot walks to the reachable stance nearest it, standing back from the end of the strip on an empty page. A goal drawn and named on the page is an objective as in a room.
- **Chart.** An 8 px grid over the board's extent (plus margin) stamped with board solids, the closed door, the goal and every drawing's transformed strokes, flagged by nature: `solid`, `climbable`, `bouncy` (with strength), `edible` (grow/shrink, remembering the owning drawing), `hazard`, `goal`.
- **Planning limits.** Chart construction accepts at most 4096 cells per axis, 1,000,000 cells total (5 MB of typed arrays), 50,000 geometry items (solids, drawings, strokes and points), and 2,000,000 stamping operations (samples and cell writes). Non-finite/unsafe grid bounds or any exceeded budget return no chart; the pilot waits with `stuck=true` and retries at its normal waiting interval. Artwork and manual control remain intact. Search stances and landing candidates stay inside the chart; jump clearance uses the full arc through known empty air above its extent. Path keys use coordinate pairs rather than a fixed numeric stride. These construction limits are independent of the A* node budget.
- **Pathfinder.** A* over foot positions for her current footprint (`small` / `normal` / `big`): walk with small steps up, fall onto anything landable, climb through climbable ink, bounce off bouncy ink to wherever the arc's apex and drift reach, and jump — up onto a ledge too tall to step, or level across a ditch or a hazard too wide to step — wherever her standing jump's arc lands on something and the parabola in between is clear. A jump costs more per cell than walking, so she walks to the very edge and only jumps where walking fails. Hazards are never entered. Bounded by a node budget.
- **Portals.** The chart keeps `gateways` — every portal once there are two, with the centre of the one it lets out of (`sim/portals.ts` order: next in drawing order, the last back to the first). A stance inside a gateway grows a `warp` edge (`WARP_COST`) to the landing below the twin's centre, and the pilot steers into the ring rather than at the far stance. A lone portal is air.
- **Errands.** Key → door → goal. If the objective is unreachable but a grow/shrink drawing would make it reachable, the errand is to eat it. Otherwise she `wait`s at the nearest reachable stance short of the obstacle (a few body widths back) and `status.stuck` is set; `game/` has Kami write *"She can't see a way on. Draw her one."* once.
- **The Sumikui** (`dread.ts`). While it is hunting or feeding on her or on the paper under her within `DREAD_PX`, the errand becomes `flee`: `Pathfinder.awayFrom` finds the cheapest stance at least `SAFE_PX` (past where it gives up the chase) from it, or failing that the reachable stance farthest from it, flagged unsafe so `status.stuck` reports her cornered (*"Nowhere left to run. Draw her a way out, quickly."*). Fleeing replans every 10 ticks, never sulks, and ends the moment it loses interest (sated, or after other ink). A Sumikui merely prowling, or chewing ink she does not stand on, does not distract her. Ordinary routes are planned on the board `afterTheMeal` — without the drawing it is chewing — so she never sets out over a dissolving bridge; already standing on one, she races across while it stands.
- **Replanning.** Every ¼ s, plus immediately on `invalidate()` — `game/` calls it whenever a drawing commits, is named, ruled, erased or eaten, a rule is enacted or repealed, or a board opens — and whenever her size or key/door progress changes. A route that stops making progress for four seconds is dropped and she sulks briefly before trying again.
- **Override.** The thumbstick bottom-left and the arrow keys walk the *selected* Alice (`Party.steer`); while either is held her pilot is bypassed and the others keep walking on their own, and she resumes on release. Tapping an Alice selects her (`Game.selectAliceAt`, ahead of the write prompt; Kami says *"Alice 2, then. Lead on."*), the camera resumes following her, and her number is what the remarks and the goal line name. Self-driving off parks the unselected Alices. ↑ (stick or key) on climbable ink climbs; ↑ on the ground jumps, once per press.

## cat/

`ScriptedCat.name` applies the offline noun/adjective lexicon, room restrictions and any remembered
matching sighting for an unknown name. Creature, vehicle and role words map to the natures in
`cat/types.ts`. `look` uses structured sightings from `LiveRecognizer`, filling up to three choices
with geometric hunches. Tapped guesses and certain finished sightings go through `Cat.accept`:
the offered `name`, `nature`, `strength` and `line` survive rather than being reparsed by the
typed-name lexicon. Restrictions still apply. A recognizer with only the legacy string-list
interface uses the older name mapping; empty/unavailable recognition uses geometry alone.

## handwriting/

A single-stroke handwriting font — **EMS Readability** (SIL OFL, from the `hersheytext` package's `svg_fonts/`) — converted at build time by `scripts/buildStrokeFont.ts` into a compact JSON glyph table that is committed (`handwriting/fonts/`), with the licence notice beside it. `write` lays text out (word wrap at `maxWidth`, unknown characters → a fallback glyph), scales to `size`, and adds seeded human wobble: baseline drift, per-glyph jitter, slight slant variation. Timing: pen speed roughly constant along each stroke, short lifts between strokes, longer between words, so a line takes about as long as a person would. `reveal` returns finished strokes whole and cuts the one in progress at the right arc length. Pure and deterministic — fully unit-testable.

## recognition/ and persistence/

Thin HTTP clients for the server, same origin (`/api`, proxied by Vite in dev). Recognition falls back to `[]`; `createRemoteRuleCompiler` returns `null` when the server has no model.

`BoardStore.state(boardId)` exposes loading, saving, the number of unacknowledged mutations, and typed load/save/list failures. HTTP requests (including response bodies) have a 10-second abort deadline. An unavailable board rejects its first load; a previously opened or edited board can reopen its in-memory snapshot with its load failure still visible. The board menu retains known boards when listing fails. Drawing remains available after a failed load.

Failed writes remain in a per-board in-memory outbox. **Retry** below the board menu explicitly retries the latest mutation per entity through the same write queue; erase supersedes an older save, clear supersedes all older mutations, and writes after a failed clear wait for its successful retry. There is no automatic retry loop. Load failures retry by reopening that board after retrying its writes. `whenIdle()` only means settled; `unsaved === 0` means all current writes were acknowledged. Switching boards preserves unsaved edits during this session. Closing/reloading the tab loses the in-memory outbox: the indicator says to keep the tab open and a `beforeunload` guard requests the browser's confirmation while any board has unsaved work. Browser confirmation is best-effort, not durable offline storage. An HTTP timeout cannot establish whether the server already committed a request; PUT/DELETE retries are idempotent.

Reads wait behind preceding writes and clears for that board; other boards remain independent.
Nested snapshots and summaries are validated by shared schemas before restoration. A malformed
snapshot fails as a whole without deleting stored data; an existing in-session snapshot can remain
available with the load error visible. `Note.drawingId` preserves label cleanup on rename, erase,
consumption and devouring after reload. Legacy labels without an association are not guessed.
There is no cross-tab transaction/revision protocol.

## render/

Canvas 2D at device pixel ratio (cap 2). `toWorld(client, camera)` and `viewport()` are the only geometry it exports. Per frame: clear to white → faint dot grid that thins out as you zoom away → the board's pre-sketched solids (roughjs, seeded, cached per board as drawables and replayed under the camera transform; glass pale blue; no-ink zones red hatching; goal a scribbled black hole; door; key) → inks (perfect-freehand at half the physical ink thickness, thinning by the pen's own pressure when the pointer reported it and by speed otherwise; black until awake, then the nature's marker tint, ~500 ms shiver) → notes (`handwriting.reveal(script, now - writtenAtMs)` through perfect-freehand, thinner than ink; blue for Kami, black for the player, green/red by tone; tappable ones underlined; `opacity`) → her twins, then Alice (black marker stick doodle, two-frame walk, scales with size, holds the key; drawn from an `AliceFigure` that `render/animation/aliceAnimator.ts` composes per Alice from her snapshot deltas and `frame.events` — hop into a seat, landing squash, flip on turning, swell on growing, portal pop, ink-drip and re-ink after a fall — presentation only, the sim is never touched; each twin wears a tinted, numbered ribbon — `alicePainter.ts:AliceBadge`, colour by index — and the selected Alice a small caret over her head, `frame.selectedAlice`; a Sumikui closing on one of them fades only its prey, `SumikuiSnapshot.prey`; a drawn body is her own strokes filled with the pose, fresh grafts haloed blue) or, when nobody is on the board, the soul (a pulsing blue heart) → the tear, its snippers, their telegraphs and the cut marks (`bossPainter.ts`) → held inks (settled strokes still being read, fading once they were words) → active strokes (red when the verdict isn't `ok`) → night (`NightPainter`: when `frame.daylight < 1`, a dark layer on an offscreen canvas with radial pools cut out around Alice and every `lantern` ink, composited over the board). Cull anything whose bounds miss the viewport. Depends on `handwriting/types` only; `createRenderer(canvas, handwriting)`.

## ui/

The canvas uses `touch-action: none`. The floating toolbar picks draw/write/erase/pan
(`aria-pressed`, keys `D`/`T`/`E`/`H`). Space holds the on-screen CAT speech input; it is no longer a
temporary pan shortcut. A thumbstick, arrow keys and the remote controller feed independent
sources into `WalkIntentMerger`; manual input overrides enabled autopilot. The HUD also owns zoom,
recentre/self-driving controls, the board menu, save/retry status, the text prompt and voice controls.
The standing laws panel is DOM; board notes are canvas handwriting.

Every control activates on `pointerup` (`activateOnTap`), so Apple Pencil, finger and mouse taps all work; the click a browser then synthesises is swallowed, while clicks with no pointer behind them (Enter, Space, `.click()`) still activate. A press that is cancelled or lifts off the control does nothing.

`promptText(client)`: an absolutely positioned single-line input at the tap, handwriting-style CSS font, ≥16 px, transparent with a marker underline, `enterkeyhint="done"`; Enter commits, Escape or blur with no text abandons; works with Apple Pencil Scribble since it is a real text field. While it is open, keys never walk Alice or switch tools.

`attachCanvasInput`: one primary pointer → pen events for draw/erase, `panBy` for pan, nothing for write; a press that never travels 6 px ends as `penCancel` + `tap`; a second touch cancels the stroke and starts pan + pinch (`zoomAt` about the midpoint) until all fingers lift; wheel pans, ctrl/meta-wheel (trackpad pinch) zooms about the cursor; `getCoalescedEvents`; a pen's `pressure` rides along on each point (`PenPoint`) and a mouse or finger leaves it out; pointer capture; `Detach` removes everything.

## server/

Bun, `Bun.serve`, the official `mongodb` driver, zod at the boundary. `MONGODB_URI` (Atlas at the hackathon); without it, `mongodb-memory-server` runs a real `mongod` with its data in `.kami-data/` so memory survives restarts with zero setup. Database `kami`.

| Route | |
|---|---|
| `GET /api/boards` | summaries |
| `GET /api/boards/:board` | `{ drawings, notes, rules }` |
| `PUT` / `DELETE /api/boards/:board/{drawings,notes,rules}/:id` | upsert / remove one document |
| `DELETE /api/boards/:board` | clear the board |
| `POST /api/recognize` `{ strokes, partial? }` | Parallel `guesses`, `confidence`, `names`, `natures`, `strengths`, `lines`, plus `certain`; adapted to `Sighting[]` |
| `POST /api/beautify` `{ strokes, name? }` | Upstream completion JSON (or another model's image); the browser accepts only validated stroke completion |
| `POST /api/compile` `{ text }` | `{ rule: CompiledRule \| null }` |
| `POST /api/transcribe` `{ strokes }` | `{ text: string \| null }` |
| `GET /api/controllers`, `POST /api/controllers/:id/state`, `GET /api/controllers/:id/events` | Controller discovery, whole-state reports and SSE |
| `GET /api/boards/:board/events?peer=<id>`, `POST /api/boards/:board/presence` | A board's changes and who is on it, as SSE (`server/sync/`); where Alice is on this device |
| `WS /api/voice/listen`, `POST /api/voice/speak` | Deepgram transcription stream and speech audio |

These are summaries; request limits and full wire shapes live in the
[API contract](../server/README.md#api-contract-what-the-client-may-rely-on).

**Recognition.** `KAMI_RECOGNIZER_URL` selects Kami's Eye on GX10, with a short-timeout/circuit-breaker
fallback to the built-in Quick, Draw! k-NN. Without a sidecar, k-NN answers alone; without ingested
samples it returns no guesses and the Cat uses geometry. `quickdraw:ingest` defaults to 300 samples
for each of 42 curated categories; restart the API to load a changed index. The reviewed nature
table covers all 345 categories, independently of which recognizer supplied them. Aliases are
merged before selecting the best three and calculating certainty.

**Model-backed compile.** If `KAMI_LLM_URL` (any OpenAI-compatible `/v1/chat/completions`, e.g. vLLM or Ollama on the GX10) and `KAMI_LLM_MODEL` are set, `/api/compile` asks the model for a `RuleEffect` as JSON, validates it with zod, clamps it, and returns it; otherwise `{ rule: null }`. Compile once: the result is stored as a `Rule` and never asks the model again.

**Handwriting reading.** `KAMI_TRANSCRIBE_MODEL` selects the vision reader, falling back to
`KAMI_LLM_MODEL`; URL/key are shared with compilation. Startup must correctly read a known image
before the route becomes ready. Until then, or without a reader, it returns `501`. A ready reader
returns words or `null`; the client treats failure as no words and keeps the ink. See
[handwriting reading](../server/README.md#handwriting-reading).

## reading/

The player writes with the pen like they draw with it; nothing is selected first. `PenReader` sits between the ink session and the funnel: at every pen-lift `game.penUp` shows it the strokes so far, and if they `couldBeWriting` (not a lone straight line, not taller than a line of writing, not dozens of strokes, and from four strokes on wider than tall — a short word may be squarish, a longer one runs along the line) it asks the `HandwritingReader` and aborts the read of the strokes before — only the newest strokes can turn out to be the whole word, and a prefix of a word is a different word, so an answer is only ever trusted for exactly the strokes it was asked about (keyed by stroke and point counts, which only grow within one drawing). By the time the ink commits ~900 ms after the last lift the answer is usually in (`recall`) or about to be (`settle` hands back the in-flight promise). Nothing that could be words lands before the answer: `game.settleWords` holds the settled strokes weightless where they were drawn (`HeldInkBook`, painted at full ink but outside the world, with bullet time held for as long as the read is out); a drawing is let down into the world when the reader sees no words, and words fade out over half a second while the ink is refunded and the text goes through the funnel at the strokes' top-left. What the gate already rules out lands at once. Strokes the placement rules rejected still get read (`onReject` carries them), so writing over glass or a no-ink zone works. Without a reader (`GameModules.penReader` unset, or the server has no model) ink is only ink and the text prompt is the only way to write.

## game/

- **Funnel** (`Game.interpret`): reject oversized text/invalid position; answer help locally; write the
  player note; try the offline compiler first. If it returns a law, apply the mode policy and stop.
  Otherwise a wish (`summoning/`: the lexicon is built once from `GET /api/exemplars`; the grammar
  reads "summon a rabbit", "draw me a bridge here", "three rabbits", "a house and a tree", "a forest
  with a river", with counts, plurals, aliases and scene words) → `LiveRecognizer.exemplar(category)`
  per thing → Kami's own drawings, fitted to `SUMMONED_SIZE` in rows (`layoutBoxes`, `fitSketch`),
  stood over the words and clear of Alice (`standOver`), solid at once (`sim.addDrawing`), inked in
  over `ARRIVAL_MS` (`InkLedger.conjure`) and named by the server's word through the same
  `cat.name` → `name` path as the player's ink, minus the tidy they do not need — or Kami asks the
  player to draw what he has never seen. A bare name ("a rabbit") beside a drawing names it instead,
  and words beside unnamed ink always name it, even "draw a ladder". Laws come first so "summon the
  ink eater" stays a law.
  Before a summons, a scene (`rules/scenes/`: `destinationOf` reads "teleport us to the moon",
  "let's go underwater", "welcome to Candy Land"; `AtlasSceneCompiler` answers from the offline
  atlas of ~25 places and otherwise asks the remote `scenes` compiler, `POST /api/scene`) →
  `Game.travel`: the scene's laws become rules all sharing the travel note (`enactAll`; the mode
  policy is applied to the bundle, so a scene is enacted whole or refused whole) and listed as one
  entry in the laws panel; then `dress` fetches an exemplar per prop and conjures each above the
  words, clear of Alice, staggered by `PROP_STAGGER_MS`, named by its word. Erasing the note repeals
  every rule of the scene at once (`RuleBook.repealByNote` returns them all); the props stay as
  ordinary ink. A travel sentence nobody can make falls through the rest of the funnel and ends in
  "I don't know the way" instead of a shrug.
  Otherwise try `cat.name` on the nearest drawing. A non-`ink` ruling wins immediately. Only then
  ask the remote `thinker`; if it returns a law, apply the mode policy and stop. If it returns
  `null`, use the available plain-ink ruling or write a shrug. A forbidden law remains plain
  writing with a refusal, not a naming attempt. Every asynchronous return checks the board epoch
  and that its source note still exists.
- **Naming geometry:** `NAMING_REACH = 190` world px, measured as rectangle gap from the laid-out
  note bounds to bounds of the drawing's strokes transformed by its current pose, including
  rotation. This is neither a distance from Alice nor a five-second naming window.
- **Law precedence** is captured when the player submits the note, before compilation. `createdAt` is a logical millisecond timestamp: at least wall time and strictly greater than the preceding submission or any restored note/rule. Same-millisecond submissions therefore keep their order across out-of-order responses, reload and repeal. Existing equal timestamps retain the rule-id tie-breaker.
- **Guesses.** Prefix `cat.glimpse` calls use `partial: true`, coalesced to at most one in flight.
  An empty answer retains the current guess. Prefixes only display a suggestion; automatic naming
  requires the finished `cat.look`. A certain first sighting is accepted directly; otherwise Kami
  offers tappable structured rulings, removed on naming/erasure or after about 20 seconds.
- **Eraser** removes drawings (and their guesses) and notes; erasing a rule's note repeals the rule. The standing laws are also listed top-right (`ui/lawsPanel`) long after their notes fade; tapping a law twice repeals it through the same path.
- **Layout.** No note is written on top of another. `NoteBook.write` measures the script where it was asked for and, if that overlaps existing writing, slides it whole line-heights clear (`noteLayout.settle`): Kami's remarks above Alice drift up, replies beneath a note and guess chips drift down, and the player's own notes drift down off Kami's glosses. The placed position is what gets persisted.
- **Camera** follows the selected Alice loosely when she walks outside a central dead-zone, leaning `COMPANY_LEAN` of the way toward any other Alice within half a screen so close company stays in frame; any manual pan or zoom suspends following until she walks again or ⌖ is pressed. Zoom 0.25–4. Its angle is the simulation's paper angle (tilt and world-spin laws); pans are taken along the screen, so dragging still moves the page the way the finger goes.
- **Walking.** Before each sim step `Party.drive` sets every Alice's intent: the selected one takes
  the held manual intent, the rest their own pilots, and pilots are used only when self-driving is
  enabled and allowed by the mode. The party resets on board open and invalidates on ink or rule
  changes.
- **Boards.** `?board=<id>` in the URL; default `wonderland`. On load: `store.load` → re-add drawings and rulings, notes, rules. A loading note is shown while simulation and editing are paused; panning, switching boards and clearing remain available. Clearing starts an editable empty board immediately. An older load cannot restore or unlock a newer board. Held walk input survives a board load.
- **Bullet-time** while the ink session is drawing or settled ink is held awaiting transcription.
- On `goal-reached` (any Alice; the event carries `who`) Kami writes a closing line naming her — *"Alice 2 found the rabbit hole. One of you was enough."* — and the mode's `won` seam decides the room; play continues. `fell` and `alice-devoured` likewise name one Alice, and only she respawns; the stuck detector listens to the selected one.
- **Mode.** `GameModules.mode` (default `EMBODIED_MODE`; `?mode=puzzle`, `?mode=sandbox`, `?mode=spirit` and `?mode=boss` in the URL pick the others through `modeInUrl`) picks a `ModeDirector` that is asked on room open, on every naming (`named`) and every sim event (`witness`, `won`); the game enacts the `EmbodimentTransition`s it answers — `sim.disembody` / `incarnate` / `openTear`, and the mode's `LossRule` when she is unmade (`board-restarts` reopens the room after `RESTART_AFTER_MS`). While the player is a soul `sim.alices()` is empty, so the `Party` drives nobody and the camera holds on the soul; a drawn body is Alice herself's alone (twins wear Kami's sketch) and the servant hunts her, not her twins. In a spirit-opening mode ink may touch her and a committed drawing that reaches her body is a graft, not a drawing. Laws the mode forbids stay plain writing with Kami's refusal beneath (`refusalLine`: the mode's own line for that dial, else the stock one); `autopilot: "forbidden"` keeps her from walking herself; `page: "endless"` reads the board id as `endlessBoard(id)`; `help: "on-request"` turns the stuck detector off and routes *help* / *give me an idea* through `counsel/`; `sharing: "live"` follows the page (below). Any mode but the embodied one introduces itself on open — its `card` as a title card in the HUD, the card and its `roles` lines written under the wordmark, and Kami's first line (`card.opening`, or the soul's own line while nobody is on the board) — unless the room it opens is staged with a card of its own. See `docs/modes.md`, `docs/boss.md`.
- **Staged rooms.** A director may answer `open(board)` with a `RoomStaging`: the room's own world (laws fold over it instead of Earth — `resolvePhysics(rules, base)`), a law policy narrower than the mode's, a title card with a progress mark (`ui/roomCard.ts`), a closing line and the next board. The game shows the card on open, writes the closing line on a win and opens the next room after `NEXT_ROOM_DELAY_MS`. Puzzle mode stages every room with `inkEater: 1` and plays through a `ForgetfulBoardStore`, so nothing a player draws in a room is saved.
- **Endless pages.** An endless board has `killY` of infinity and one strip of ground. `LastFooting` (`sim/footing.ts`) remembers where Alice last stood; `FALL_LIMIT` below that is `fell`, and she is set down on that footing once — if it is gone and she falls again, on the spawn. A twin who falls off the page returns to the same footing. Ink and Alices further than `LOST_DISTANCE` from every solid are lost as in a room, so a page keeps only what someone can stand on or reach.
- **Shared pages** (`sync/boardLink.ts`). With `sharing: "live"` the game `follow`s the board: `BoardLink` opens `GET /api/boards/:board/events?peer=<id>` (an `EventSource`; the browser sends `Last-Event-ID` on reconnect) and every `put` / `delete` / `clear` that arrives — another device's or this one's echoed back — lands through the same seams a load does: `placeDrawing` (add, or retrace changed strokes and re-rule), `placeNote`, `placeLaw` (the rule book `place`s it in chronological order and refolds; Kami's gloss is rewritten), `dropDrawing`, `dropNote`, `dropLaw` (repeal), and `clear` reopens the page. A change identical to what is already on the board is ignored, so echoes are free. A `resync` (the server's log does not reach back to our cursor) reloads the board. Every `PRESENCE_INTERVAL_MS` the link `POST`s Alice's snapshot to `/api/boards/:board/presence`; other peers' snapshots arrive as `presence` messages and are painted as **ghosts** (`GHOST_ALPHA`, culled offscreen, never in the sim: a ghost is a picture of someone else's Alice, not a body). The peer id (`mintPeerId`) is a name for the tab, not an account. The HUD swaps the board menu for the share panel — board id, `?board=<id>&mode=sandbox` link, its QR (`qrcode`), and how many others are on the page.

**Tidying.** When a drawing gets its name (tapped, written, or Kami's own when he is `certain`),
`Game.tidy` asks `LiveRecognizer.complete(strokes, name)` once. The answer is the player's own strokes,
point for point, each nudged a bounded distance toward a clean drawing of the same thing, plus any parts
theirs was missing (`ml/CONTRACT.md`, "Completion"). `InkLedger.retrace` swaps the strokes in and keeps the
old ones as a `Retrace`; for `RETRACE_MS` `views()` shows `retracedStrokes(from, to, progress)` — the ink
glides into place, then what was added is drawn in — and the tidied drawing is saved. No answer, a late
answer on another board, or ink that changed meanwhile: nothing happens. The browser requires the
same stroke/point counts in `tidied`, finite bounded coordinates and a combined drawing within
the input budget; images and old replacement-only responses are ignored. Its return type is
`{ tidied, added, word, confidence } | null`. How firmly is the player's choice: the bead on the line at the bottom of the HUD (`ui/tidySlider.ts`, remembered per device as `kami.tidiness`) is sent as `strength`; all the way left, `tidy()` does not ask at all and the ink stays exactly as drawn, in the middle Kami tidies as lightly as he is sure, and all the way right the drawing becomes the dataset's own (every point on the exemplar, every missing part added). Every tidying starts from the strokes as drawn (`InkRecord.drawn`, which is also what the autopilot charts), so it is never tidying squared; when the slider comes to rest (`RETIDY_AFTER_MS`) the named drawings on the board are tidied again at the new firmness — back to the ink as drawn at zero — and the latest request for a drawing wins. A tidied point keeps the pressure the pen had there.

The sim and pilot keep the original collision geometry until reload, when the saved tidied/added
strokes become bodies. Visual ink can therefore differ from collision geometry during play.
The current morph bounds displacement by the drawing diagonal, not a pen width; the browser
does not independently enforce that displacement cap. This is an implementation limit requiring
gameplay/model validation, not a change to the drawing-preservation requirement.

## Controllers and voice

```
UDP :8788 / USB serial / HTTP state report
  → server/controllers hub → SSE /api/controllers/:id/events
  → src/controller/RemoteStick → WalkIntentMerger → Game → sim
```

The current serial/UDP protocol is `kami <id> <x> <y> [buttons]`; HTTP sends the same axes/buttons
without the prefix/id. Reports are whole held state. The hub applies dead zones and releases stale
input after one second; serial discovery rescans every three seconds. `?controller=arcade` is the
default, `off` disables it. Button A counts as up (jump/climb); other buttons have no gameplay
binding. SSE error releases the remote source, and EventSource reconnects. Keyboard/touch remain
independent sources. See [controllers.md](controllers.md).

The cabinet firmware's `S,dir,ink,cat,px,py` frames are **not accepted by this base's generic
parser**. [R19 / #41](https://github.com/SnowballSH/kami/pull/41) adds the server-side adapter,
firmware debounce/framing checks and pinned compilation. Its supported integration is movement
relay. Knob drawing, INK gestures, physical CAT-to-speech binding, game-driven LED feedback and a
visible reconnect UI remain deferred even with R19. The browser Web Serial example and full-panel
behavior in [hardware.md](hardware.md) are historical design, not the current browser path; #41
replaces them. Do not treat its reported firmware compilation as physical acceptance.

The on-screen CAT button/Space and wake-word mode use browser microphone capture →
`/api/voice/listen` WebSocket → Deepgram → the text funnel. Replies use `/api/voice/speak`.
The Deepgram key stays on the server. Missing credentials/upstream failure leaves written play
available. LAN microphone capture needs a secure context; plain HTTP LAN play does not verify
voice. See [voice.md](voice.md).

## Deployment and security status

At the base revision above, the API/Vite are LAN-oriented, API CORS is wildcard, and there is no
client authentication, board/controller authorization or aggregate model quota. Anyone who can
reach the API can modify boards, submit controller state and consume configured upstreams.
Use this build only on an isolated trusted network; keeping a service key off the browser does
not protect an unauthenticated proxy.

[R12 / #40](https://github.com/SnowballSH/kami/pull/40) is **open at this documentation review**.
Its [access guide](https://github.com/SnowballSH/kami/blob/38d480dc1577ac1cf89d810ea917259218e0eb0b/docs/access.md)
defines these modes; setting these variables on the base revision does **not** install them:

| R12 mode | Trust and deployment contract |
|---|---|
| `KAMI_ACCESS_MODE=demo` (default) | Trusted reachable LAN peers; explicit browser-origin checks, no participant authentication. API/Vite remain LAN-accessible unless explicitly bound to loopback. |
| `KAMI_ACCESS_MODE=shared` | Loopback API default behind a same-origin HTTPS proxy; exact allowed HTTPS origins; credentials grant exact boards/controllers and model permission. Browser token exchange uses an HttpOnly/Secure/SameSite cookie; non-browser clients use bearer credentials. Unauthenticated UDP is disabled; local serial is trusted host input. |

The inspected R12 revision also protects voice: sketch/text model routes, `voice/speak` and
voice-listening upgrades share a per-process request/concurrency budget in both modes. A listening
socket holds a concurrency slot until closed, including continuous wake-word listening.
Its upgrade path checks origin, credentials and model permission through the same access object;
the WebSocket transport does not pass through the ordinary HTTP router. These are process-local
limits; cold-start pen traffic plus an active microphone still needs GX10 capacity testing.

After security integration, an operator must still verify actual bind addresses/firewall,
private database/model ports, HTTPS certificates, origin handling and SSE/WebSocket proxying
on the intended iPad/booth network. No live GX10 configuration is established by repository tests.
The user has [kept #40 open for their deployment gate](https://github.com/SnowballSH/kami/pull/40#issuecomment-5746417102):
demo-mode deployment on GX10, live guessing under the limits, controller SSE and iPad cold start.
Its local access/voice tests do not release that hold or establish production readiness.

## Product scope and verification

The spec's chapter progression, NPC/guard behaviors, teacup scoring and full cabinet are product
targets, not promises made by this endless-board build. [Modes](modes.md) likewise separates the
playable embodied director from the unimplemented spirit-mode contract. Preserve those product
requirements and record mismatches explicitly; archived room/store/edge-function code is not a
mandate to reconstruct the old design.

| Verification layer | What it establishes; what remains |
|---|---|
| Local `bun run check`, `bun run build`, documentation links | TypeScript/Biome, unit/headless regressions and a production bundle. Does not establish a working microphone, deployed service, real tablet or cabinet. |
| [R18 / #42](https://github.com/SnowballSH/kami/pull/42), open at review | Adds frozen Bun CI and isolated Python/shell checks. `check:lightweight` and `check:gx10` are not commands on this base yet; see its [check guide](https://github.com/SnowballSH/kami/blob/55341ca320b318de355880e89d8ed0636ea73a6e/scripts/ci/README.md). |
| GX10-only model checks | All training, model inference (including tiny-model tests), full ML tests and heavy work stay on GX10. R18's explicit `bun run check:gx10 <full-commit-sha> <artifact-name>` records source/artifact identity; a local or hosted green gate does not replace golden parity, model quality or live latency checks. |
| Cabinet and booth acceptance | R19 reports native/TypeScript regressions and UNO R4 WiFi compilation. Wiring/power, firmware upload, held/released controls, unplug/replug, feedback and the real host/browser/proxy still require physical verification. |
| This documentation review | Source/contract inspection and local repository gates only. No live model, GX10 service, browser, microphone, Apple Pencil or physical cabinet was exercised. Existing benchmark figures describe their original runs, not this revision's readiness. |

## Known limits of the demo

- **Alice rides nothing.** The pilot plans over ink where it currently rests; she will not wait for a floating or falling drawing to line up. A blank board with no goal leaves her idle until one is drawn and named.
- **Poses are not remembered.** A drawing is stored where it was drawn, so after a reload dynamic ink reappears there and settles again.
- **One effect per rule.** "low gravity and slow time" is two notes. Relative phrasings ("flip", "double") are relative to Earth, not to the current value.
- **Clamps differ** between the offline grammar (`rules/`) and the model-backed compiler (`server/compile/effectRanges.ts`); the latter is wider.
- **Model quality is separate from transport correctness.** Mock/fake OpenAI-compatible tests validate parsing and fallback, not real compilation, handwriting or completion quality.
- **Recognition depends on configured artifacts/data.** Eye falls back to k-NN; published k-NN measurements in `server/README.md` do not measure a current trained release. Restart the server after ingest.
- **No eraser cursor**, since the renderer is never told where the pointer is.
- **Real-device interaction remains a verification gap.** Synthetic pointer tests do not establish Apple Pencil/palm rejection, microphone permission or booth browser behavior.
