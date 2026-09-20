# Kami — every component, and how they fit

A living map of the whole system: what each part is for, where it lives, what it promises the
parts around it, and how far along it is. Keep it current in every PR that adds, renames or
retires a component. [spec.md](spec.md) is the product's source of truth; [architecture.md](architecture.md)
is the integration guide with per-module detail; this page is the index that ties them together.

Status words used throughout: **built** (in main, tested), **contract** (types and docs exist,
no gameplay), **planned** (agreed, not started), **external** (owned by the server side / Claude).

## 1. The idea

Kami (紙, paper) is an endless whiteboard that is also a world. Alice walks it on her own; the
player never steers her by default — they *draw* what she needs (a bridge, a rope, a rabbit) and
*write* the laws the world runs on ("gravity is weak", "the cat chases me", "teleport us to the
moon"). Kami, the paper spirit, answers in handwriting. Ink is the lifeblood of the paper; the
Sumikui, a shard of the one under the page, drinks it. Everything drawn — Alice, the ground, the
creatures — is ink, and is on the menu.

Principles the components enforce:

- **The player's strokes are the truth.** Physics, collision, hit-testing, erasing, chewing and
  persistence all read the original vector strokes. Model-made art (beautify, exemplars) is either
  drawn *as strokes* into the same ledger or is presentation only.
- **Compile once, run forever.** Text becomes a deterministic typed rule; the simulation step never
  calls a model. Laws fold chronologically and refold on repeal ([laws.md](laws.md)).
- **Open vocabulary.** Any noun can be a name; any creature can be the target of a law; the
  grammar takes the obvious sentence and the model takes the rest, into the same typed shape.
- **Magic first.** "Stupid" ideas must work: a flying teapot, a loyal mouse, an upside-down world,
  a car that takes off. If the law is expressible as a dial, the sentence should reach it.
- **Heavy compute lives on the GX10**, never in the browser and never on a dev laptop.

## 2. Ownership and the seam

| Side | Owns | Docs |
|---|---|---|
| Client (Devin) | `src/` — game loop, sim, render, autopilot, ink, board, Cat, UI, rules | this page, [architecture.md](architecture.md), [laws.md](laws.md), [modes.md](modes.md) |
| Server (Claude) | `server/`, `ml/`, scripts, persistence and recognition HTTP clients (`src/persistence`, `src/recognition`), deployment on the GX10 | [server/README.md](../server/README.md), [access.md](access.md), [voice.md](voice.md), [controllers.md](controllers.md) |

The seam is the HTTP API ([server/README.md § API contract](../server/README.md#api-contract-what-the-client-may-rely-on))
plus `src/rules/types.ts`. Whenever `RuleEffect` changes, five places move together:
`src/rules/types.ts` (the type), `src/rules/effectDomains.ts` (client ranges),
`src/persistence/schemas.ts` (zod, re-exported by `server/schemas.ts`),
`server/compile/effectRanges.ts` (model clamp) and `server/compile/prompt.ts` (what the model is
told it may emit), plus `src/persistence/remoteRuleCompiler.ts` (how the model's JSON is decoded).
`tsc` catches type drift; the schema tests catch shape drift.

**GX10 boundary.** The ASUS GX10 outpost (`gx10`) runs training, the Eye sidecar and the deployed
server on `:8787`. All of that is Claude's; do not restart, retrain or redeploy from a client PR.

## 3. Startup and the frame

```
main.ts → game/index.ts:startGame(canvas, options)
  builds: board, sim, ink session, ledger, cat, rule compilers, autopilot, renderer, hud,
          board store, recognizer, summoner, scenes, mode director, voice, controller stick
  runs:   fixedStepLoop → each tick: inputs → sim.step (1/60 s) → events → game reacts
          each frame: camera → renderer.draw(world)
```

| Component | Files | Status | Notes |
|---|---|---|---|
| Entry & wiring | `src/main.ts`, `src/game/index.ts` | built | resolves options (board id, mode, API base), builds every module, attaches DOM |
| Fixed-step loop | `src/game/fixedStepLoop.ts` | built | accumulates real time, steps the sim in 1/60 s, caps catch-up |
| The game | `src/game/game.ts` | built | the orchestrator: the text funnel (`interpret`), rule enactment and repeal, notes, camera, sim events → Kami lines, autopilot hand-off, persistence |
| Camera rig | `src/game/cameraRig.ts`, `src/render/camera.ts` | built | follows the selected Alice outside a dead-zone, leaning toward other Alices close by; manual pan/zoom suspends following; arena pages pin the camera to the screen-sized Boss stage; angle = the paper's turn (world-rotation law) |
| Id mint | `src/game/idMint.ts` | built | branded ids without `crypto.randomUUID` (plain-HTTP LAN) |
| Stuck detector | `src/game/stuckDetector.ts` | built | notices Alice not progressing → hint ladder / replan |
| Lines | `src/game/lines.ts`, `src/cat/lines.ts` | built | Kami's dialogue tables (warp, devoured, lore, refusals…) |

## 4. The board and the room

| Component | Files | Status | Notes |
|---|---|---|---|
| Board definition | `src/board/types.ts`, `src/board/index.ts` | built | `BoardDefinition`: pre-sketched solids, zones with checkpoints, spawn, goal, `killY`, no-ink zones |
| Wonderland | `src/board/boards/wonderland.ts` | built | the demo's puzzle board: seven zones in the spec's page order — Riverbank (ditch: a bridge), Shelves (plateau: bouncy/ladder), Hall of Doors (glass table, key, tiny door: grow → key → shrink), Pool of Tears (a glass bowl nothing anchors to: spring or grow out), Croquet Ground (red no-ink lawn, ink only in the margins: grow and hop the dais, or portals), Trial (low jury box only small Alice passes, then a gap in the cards: heavy object or a jump when big), Mad Tea Party (free play; the rabbit hole is here). Built from the existing contract only — `marker`/`glass` solids, `noInkZones`, one key/door/goal |
| Blank | `src/board/boards/blank.ts` | built | a new room: a patch of ground under Alice, `killY` 4000 below it |
| Endless page | `src/board/boards/endless.ts`, `src/sim/footing.ts` | built | `page: "endless"`: a strip of ground, no edges, `killY` infinite; a fall of `FALL_LIMIT` below her last footing puts her back on it (`LastFooting`), bringing her ridden vehicle back under her feet; the sandbox's board |
| Board props | `src/sim/boardProps.ts`, `src/sim/paper.ts` | built | the board's own solids as static bodies; `paper.ts` holds bites the Sumikui takes out of the ground and heals them |

## 5. Ink: from pen to drawing

| Component | Files | Status | Notes |
|---|---|---|---|
| Ink session | `src/ink/session.ts`, `stroke.ts`, `constants.ts` | built | pointer → filtered strokes (3 px), one `Drawing` per 900 ms pause, `penCancel` |
| Budget | `src/ink/budget.ts` | built | per-board ink allowance; `Infinity` for endless boards |
| Placement | `src/ink/placement.ts` | built | verdicts: `no-ink-zone`, `overlaps-alice`, too small |
| Bearing | `src/ink/bearing.ts` | built | which strokes of a drawing are **load-bearing**: a flat span is the deck; non-flat strokes drawn above it are scenery (no collider, not charted) — so a suspension bridge's cables are not a ceiling |
| Hit test | `src/ink/hitTest.ts` | built | erasing and tapping find drawings by their original strokes under the current pose |
| Ink ledger | `src/game/inkLedger.ts` | built | the authoritative list of drawings (strokes never mutated), rulings, art overlays |
| Held ink | `src/game/heldInk.ts` | built | a drawing picked up by the pencil rides with it until dropped |
| Retrace | `src/game/retrace.ts` | built | the tidy animation: per-point tween from the player's strokes toward Claude's `complete()` (`tidied` + `added`), body rebuilt after |
| Ids | `src/ink/ids.ts` | built | branded `DrawingId` |

## 6. Naming: the Cat

`cat/` turns a word next to a drawing into a `Ruling` — name, nature, strength, tags, temper, own
motion, and Kami's line.

| Component | Files | Status | Notes |
|---|---|---|---|
| The Cat | `src/cat/cat.ts`, `index.ts` | built | `name(text, drawing)`, `look(drawing)` (recognizer sightings → three guesses or one certain), `accept(ruling)`, `hint()` |
| Phrase | `src/cat/phrase.ts` | built | words → stems, subjects, adjectives; shared with the grammar |
| Lexicon | `src/cat/lexicon.ts` | built | nouns → natures (walker/hopper/flier/vehicle/…), `FOLLOWERS`/`FLEERS` born tempers, role words |
| Natures | `src/cat/natures.ts`, `natureResolver.ts` | built | the player's verb/adjective outranks the noun ("a flying pig") |
| Ruling | `src/cat/ruling.ts` | built | builds the ruling; `withTemper` adds a temper from words ("a shy dog") or birth |
| Temper | `src/cat/temper.ts` | built | `temperOf(phrase, nature)`; `heedOf(temper)` → `{ heed: ±1 }` own-motion edit; `temperOfHeed` back |
| Motion words | `src/cat/motion.ts` | built | "a spinning wheel", "a powered cart" → own motion at naming time |
| Sight | `src/cat/sight.ts` | built | a recognizer `Sighting` → ruling, **with** the born temper, so an auto-named dog heels |
| Guesses & hints | `src/cat/guesses.ts`, `hintLadder.ts`, `shapeGuesser.ts`, `shape.ts` | built | geometry fallback when the Eye is silent; escalating hints when stuck |
| Refusals | `src/cat/scriptedRefusals.ts`, `strength.ts`, `tidyName.ts` | built | polite no's, strength words ("very"), name tidying |

## 7. Laws: typed rules, fold and repeal

The formal model is [laws.md](laws.md). In brief: a sentence compiles to an `Edit : World → World`
on a product of dials; rules fold in `createdAt` order; repeal refolds the rest.

| Component | Files | Status | Notes |
|---|---|---|---|
| Types (the seam) | `src/rules/types.ts` | built | `World`, `Alice`, `Motion`/`STILL`, `RuleEffect`, `Target`, `BodyLaw`, `Physics` |
| Effects & glosses | `src/rules/effects.ts` | built | constructors per dial, Kami's gloss per value, `bodyRule(governs, of, value)` |
| Domains | `src/rules/effectDomains.ts` | built | client ranges; `isValidEffect` |
| Grammar compiler | `src/rules/grammarCompiler.ts`, `recogniser.ts`, `normalise.ts`, `vocabulary.ts`, `amounts.ts`, `directions.ts`, `subjects.ts`, `targets.ts` | built | offline; runs a list of recognisers in order; `targetOf`/`besides` pick "the cat"/"everything" out of a sentence |
| Recognisers | `src/rules/recognisers/*.ts` | built | `reset`, `paper` (tilt/spin the page), `gravity`, `time`, `friction`, `bounciness`, `air`, `wind`, `dials` (table: Alice, ambience, Sumikui), **`heed`** (follow/flee/ignore Alice), `motion` (spin/thrust/mass/grip/pace/wings/size with a target) |
| Fold | `src/rules/resolvePhysics.ts`, `motion.ts`, `bodies.ts` | built | `resolvePhysics(rules)`; `motionOf(own, bodies, name)` — a drawing's own motion, then every law that speaks of it, oldest first |
| Chained compiler | `src/rules/chainedCompiler.ts` | built | grammar first, remote model second, same `CompiledRule` |
| Remote compiler | `src/persistence/remoteRuleCompiler.ts` | external | `POST /api/compile` → validated JSON → `RuleEffect` |
| Rule book | `src/game/ruleBook.ts` | built | standing rules, enact/repeal, refold, note ↔ rule link |
| Laws panel | `src/ui/lawsPanel.ts` | built | top-right list of standing laws; tap twice to repeal (notes fade, laws don't) |
| Mode policy | `src/modes/policy.ts` | built | `allowsLaw(mode, effect)` — a mode may refuse a dial (no Sumikui in sandbox); `refusalLine` is the mode's own line for it, else the stock one |

### Dials today

| On | Dials | Sentences |
|---|---|---|
| the world | gravity (vector), wind, airDrag, friction, bounciness, timeScale, temperature, daylight, tilt, spin (of the paper), inkEater | "gravity points left", "it's night", "tilt the world 90°", "summon the ink eater" |
| Alice | flight, walkSpeed, aliceSize, jumpHeight, attraction, clones | "Alice can fly", "Alice is twice as fast", "there are three Alices" |
| a drawing (`of: named \| all`) | spin, thrust, mass, bounce, grip, pace, wings, size, **heed** | "the wheel spins", "the rock is heavier", "the dog can fly", "the cat is huge", "the cat chases me", "the mouse runs away from her", "the dog leaves me alone" |

## 8. Simulation

matter-js under `src/sim/`; `createSimulation` is the only entry.

| Component | Files | Status | Notes |
|---|---|---|---|
| Simulation | `src/sim/simulation.ts`, `types.ts`, `constants.ts` | built | `loadBoard`, `addDrawing`, `applyRuling`, `setPhysics`, `step`, events (`fell`, `goal-reached`, `warped`, `devoured`, `paper-bitten`…) |
| Ink bodies | `src/sim/inkBody.ts`, `inkEntity.ts`, `inkLayer.ts`, `bodyBounds.ts`, `anchoring.ts` | built | strokes → compound body (load-bearing strokes only); `InkEntity` holds ruling, own motion, mind, pose; `temper` is derived from the folded `motion.heed` |
| Alice | `src/sim/alice.ts`, `flight.ts`, `contacts.ts`, `checkpoints.ts` | built | controller body, walk/jump/climb, headroom check (respects `aliceSize`), riding (`ride`/`drive`), respawn at checkpoint or `spawn` ink |
| World physics | `src/sim/worldPhysics.ts`, `motion.ts`, `weather.ts`, `attraction.ts` | built | applies folded dials: gravity/wind/drag/time; per-body spin/thrust/mass/grip/bounce; temperature melts/burns natures; attraction pulls |
| Natures & roles | `src/sim/natures.ts`, `roles.test.ts` | built | `solid`, `goal`, `spawn`, `hazard`, `portal` roles; `bouncy`, `floaty`, `heavy`, `slippery`, `attractor`, `lantern`; creature natures below |
| Creatures | `src/sim/creatures.ts` | built | walker / hopper / flier minds with `Feelers`; `urgeOf` → `heel` / `toward` / `away` / `roam` from the creature's temper; `HEEL_PX`, `FLEE_RADIUS_PX`, `FLEE_HASTE`, `PERCH_ABOVE_PX` |
| Powers | `src/sim/powers.test.ts` (+ in `creatures.ts`, `vehicles.ts`, `inkLayer.ts`) | built | `pace` scales self-motion; `wings` lifts walkers/hoppers/vehicles/plain ink; `size` rescales strokes+body about the centre |
| Vehicles | `src/sim/vehicles.ts` | built | Alice boards when both feet are on it; stick/autopilot drive it; driven vehicles rotate and tumble off footing while keel damping keeps them level on ground; jump dismounts; winged vehicles take off once rolling |
| Portals | `src/sim/portals.ts` | built | drawings named "portal" link in drawing order; exit refuses re-entry until she leaves it |
| Twins | `src/sim/twins.ts`, `src/sim/independentAlices.test.ts` | built | `clones` dial keeps N extra Alices, each with her own intent (`setWalkIntent(intent, who)`), portal memory and `fell`/`goal-reached`/`alice-devoured` (events carry `who`); sideways strays are recalled to Alice |
| Party | `src/game/party.ts` | built | one pilot per Alice sharing a chart per step; the selected Alice takes the stick, the rest drive themselves; twins wander when there is no errand |
| Sumikui | `src/sim/sumikui.ts` | built | summoned by law and awake on the spot; hunts nameless drawings for the first 20 s, then eats every drawing that is not a board role (`pinned`) or a scene prop (`provenance: "scenery"`), the ground under Alice, and Alice; prefers what she depends on (ink underfoot, her ground, her when close, ink beside her) over far clutter; meal time grows with the drawing's ink (pebble ~1.5 s, bridge several); starts at half her walking pace and doubles every 20 s to a cap; lore recital |
| Soul and drawn body | `src/sim/body/drawnBody.ts`, `types.ts` | built | `disembody`/`incarnate`/`graft`; strokes segmented into head / torso / arms / legs / wings by place against the heart; parts → abilities (walk, jump, climb, fly, see); `snip` removes crossed strokes and the ability with them |
| Tear and snippers | `src/sim/boss/tear.ts`, `snipper.ts`, `weapons.ts`, `tuning.ts` | built | the boss: arriving → circling → winding (telegraphed cut) → lunging → recovering; mercy window; speed ramp; hurt by moving, heavy, spinning or hazard drawings; lesser waves; tear closes on defeat ([boss.md](boss.md)) |
| Paper | `src/sim/paper.ts` | built | the page's turn (tilt/spin laws) and bites in board solids |
| Empty board / test support | `src/sim/emptyBoard.ts`, `testSupport.ts` | built | fixtures |

## 9. Alice's own mind: the autopilot

| Component | Files | Status | Notes |
|---|---|---|---|
| Chart | `src/autopilot/chart.ts` | built | grid of the world from board solids + load-bearing ink + creature positions (never a wall in Alice's own cell; other Alices widen the extent but are never solid); `gateways` — paired portals with where each lets out |
| Pathfinder | `src/autopilot/pathfinder.ts` | built | moves: walk, jump, climb, fly (when `flight`), drive, warp (through a paired portal, `WARP_COST`); key → door → goal ordering; `awayFrom(threat, safe)` for a way out from under the Sumikui |
| Pilot | `src/autopilot/pilot.ts`, `index.ts`, `types.ts` | built | one per Alice (`PilotOptions`: seed, wanders, shared charter); replans every few ticks or on `warped`/new ink; waits ("no way yet") when stuck, or wanders deterministically if a twin; yields to manual input; errands `objective` / `eat` / `wait` / `flee` / `wander` / `idle` |
| Sumikui awareness | `src/autopilot/dread.ts` | built | `Scene.sumikui`; when it hunts her, her ground, or the drawing under her feet within `DREAD_PX` she `flee`s to footing `SAFE_PX` away (or as far as she can, and is `stuck` = cornered); routes never count on the drawing it is chewing (`afterTheMeal`), but she races across one she already stands on; each Alice fears it for herself, and Kami names a twin who runs: "She sees it. She runs." / "Nowhere left to run." |

## 10. Player input

| Component | Files | Status | Notes |
|---|---|---|---|
| Canvas input | `src/ui/canvasInput.ts`, `gestures.ts`, `tap.ts`, `touchGuards.ts`, `render/pointerTracker.ts` | built | pencil = ink/erase/tap; fingers = pan/zoom; pointer mapping honours the paper's angle |
| Toolbar & tools | `src/ui/toolbar.ts`, `toolSelection.ts`, `toolHotkeys.ts`, `zoomControls.ts`, `tidySlider.ts`, `boardMenu.ts` | built | pen, eraser, hand, text, zoom, board switch, tidy amount |
| Text prompt | `src/ui/textPrompt.ts` | built | typed text → the same funnel |
| Keyboard | `src/ui/keyboard.ts` | built | arrows/WASD override, space jump |
| Virtual thumbstick | `src/ui/joystick.ts` | built | bottom-left stick, manual override |
| Walk intent merger | `src/ui/walkIntent.ts` | built | keyboard + stick + controller → one `intent`, steering the selected Alice (`Party.steer`) |
| Arduino / cabinet | `src/controller/*`, `server/controllers/*` | external | `kami arcade <x> <y> [buttons]` over UDP/serial/HTTP → SSE → `createRemoteStick` ([controllers.md](controllers.md), [hardware.md](hardware.md)) |
| Voice | `src/voice/*`, `server/voice/*`, `src/ui/talkButton.ts` | external | hold-to-talk / wake word → Deepgram proxy → funnel; Kami speaks back ([voice.md](voice.md)) |
| HUD | `src/ui/hud.ts`, `toolbar.ts`, `lawsPanel.ts`, `controls.ts`, `persistenceStatus.ts`, `accessGate.ts` | built | always-available clear-page button; laws panel stays visible with an empty-state hint; autopilot switch, save status, access gate |

## 11. The text funnel

`game.ts:interpret(text, position)`, in order — the first that understands wins:

1. limits and bounds; help requests → hint
2. **offline grammar** → law (world / Alice / targeted body law, incl. `heed`)
3. **scene** ("teleport us to the moon") → offline atlas or model → many laws under one note + props
4. **summons** ("summon a rabbit") → `GET /api/exemplar` → Kami inks it stroke by stroke and names it
5. **naming** the nearby unnamed drawing (Cat; Eye sightings when the lexicon only says "ink")
6. **remote compile** (GX10 model) → law, or a plain-ink name, or a shrug

Every stage writes the player's words as a note; Kami writes a gloss under it. Erasing the note
repeals what it enacted.

## 12. Summons and scenes

| Component | Files | Status | Notes |
|---|---|---|---|
| Summoner | `src/summoning/*` | built | grammar ("summon/draw me a …"), placement beside Alice, exemplar fetch, stroke-by-stroke inking, naming |
| Exemplar route | `server/exemplar/*`, `server/sketch/*` | external | Quick, Draw! strokes per word |
| Scenes | `src/rules/scenes/atlas.ts`, `sceneCompiler.ts`, `travel.ts` | built | ~25 offline places (moon, Mars, ocean, Candy Land…) as edit lists + props + arrival line; model for the rest (`server/scene/*`, `src/persistence/remoteSceneCompiler.ts`) |

## 13. Recognition and beautification

| Component | Files | Status | Notes |
|---|---|---|---|
| Recognizer client | `src/recognition/httpRecognizer.ts`, `sightings.ts`, `types.ts` | external | `sight(strokes, { partial })` → `Sighting[]` (word, confidence, name, nature, strength, line, `certain`) |
| Live guessing | `game.ts` + `cat/sight.ts` | built | partial sight after each stroke (empty = keep last guess); certain → auto-name with born temper; else three guesses |
| Completion (tidy) | `src/recognition/completion.ts`, `game/retrace.ts` | built | `complete(strokes, name)` → `{ tidied, added }` → morph |
| Eye (server) | `server/quickdraw/*`, `server/recognition/*`, `server/natures/*`, `ml/` | external | k-NN + trained model on the GX10; 345 categories ruled server-side |
| Beautify art layer | `src/art/types.ts` | contract | model image over the player's ink, physics stays the strokes — planned |

## 14. Kami's voice on the page

| Component | Files | Status | Notes |
|---|---|---|---|
| Handwriting | `src/handwriting/*` | built | text → timed pen strokes in a single-stroke font, wobble, reveal |
| Notes | `src/notes/types.ts`, `src/game/noteBook.ts`, `noteLayout.ts` | built | player and Kami notes; laid out to avoid overlap; a note may own a rule. Nothing written stays: Kami's replies fade in 6–12 s, the player's words and Kami's labels 12 s after they are answered (`NoteBook.release`), restored notes 12 s after the board opens; only the wordmark is permanent. Fading never repeals — laws live on in the laws panel, drawings keep their names |
| Pen reading | `src/reading/*`, `src/persistence/httpHandwritingReader.ts` | built / external | handwriting → words while still writing (a read per pen-lift) |
| Lines & lore | `src/cat/lines.ts`, `src/game/lines.ts`, `src/sim/sumikui.ts` | built | refusals, tempers, warps, devourings, the under-the-page recital |

## 15. Rendering

| Component | Files | Status | Notes |
|---|---|---|---|
| Renderer | `src/render/canvasRenderer.ts`, `canvas2d.ts`, `index.ts` | built | Canvas 2D; whiteboard look (black ink, blue Kami, green understood, red confused, one tint per nature) |
| Camera | `src/render/camera.ts`, `turnedCamera.test.ts` | built | centre, zoom, angle; `toWorld`/`toClient`, `visibleWorld` |
| Painters | `boardPainter.ts`, `inkPainter.ts`, `inkPath.ts`, `alicePainter.ts`, `alicePose.ts`, `notePainter.ts`, `sumikuiPainter.ts`, `feedingParticles.ts`, `bossPainter.ts`, `eraserRing.ts`, `keyShape.ts`, `dotGrid.ts` | built | board (door swings away on its hinge, key shrinks off its hook), ink under pose (incl. size scale), Alice from a figure (limbs with knees: stand, stride, pass, climb, air, seated, astride, crouch; twins with a tinted numbered ribbon, the selected one with a caret), notes, Sumikui blot + trail, feeding flecks and drips (deterministic in snapshot + `nowMs`, capped), soul, drawn body with graft glow, snipper + telegraph + cut marks, tear, ink health bar, headless dim veil, eraser ring |
| Alice's beats | `src/render/animation/aliceAnimator.ts`, `aliceTroupe.ts`, `aliceFigure.ts`, `easing.ts` | built | presentation only, physics untouched: one `AliceAnimator` per Alice watches her snapshots (`ride`, `grounded`, `facing`, `headingScale`, `hasKey`, position, `velocity`) plus per-frame sim events (`warped`, `alice-devoured`) and composes an `AliceFigure` (pose, offset, squash/stretch, facing, lean, ink-in, ghost) — hop into the seat (250 ms) and off (220 ms, with a settle), sink into vehicles, landing squash by impact speed (150 ms), flip-through-edge-on turn (120 ms), swell while growing/shrinking, portal pop-in, ink-drip out and re-ink at the checkpoint, key snatched into her hand; riding bobs with the gait (walker sway, hopper crouch/stretch, flier bob, driver leans against speed). Vehicle ink is repainted over her lower body. Figures are reused frame to frame: no per-frame allocation. A drawn body (`AliceSnapshot.look`) is painted from its own strokes instead |
| Night | `src/render/nightPainter.ts`, `palette.ts` | built | `daylight` dial: veil, light pools for Alice and twins, legible handwriting |
| Culling & art | `culling.ts`, `boardArt.ts`, `awakening.ts` | built | draw only what is visible; wake-up animation when a drawing is named |
| Brand | `src/brand/logo.ts`, `gif.ts`, `build.ts`, `assets/*.svg`, `assets/kami-wordmark.gif`, `public/kami-mark.svg` | built | the logo is Kami's own handwriting: `wordmarkSvg` writes "kam" with the stroke font and `perfect-freehand` pen (seeded, so deterministic), stands Alice in for the "i" — only as tall as its stem — and perches the Sumikui above her as the dot; `wordmarkFrames` is one breath of the Sumikui (bob, lobes, a blink) over 24 frames and `animatedGif` (`@resvg/resvg-js` + `gifenc`) encodes them as the looping GIF. `markSvg` is a 64-unit paper tile with a drawn baseline, a `k` and Alice beside it (reads at 32 px), `lockupSvg` puts both together. `bun run brand:build` regenerates the committed SVGs and GIF; a test fails if they drift from the generator. The HUD wordmark (`boardMenu.ts`) and the favicon use them |

## 16. Game modes

Contract in `src/modes/types.ts`, described in [modes.md](modes.md): how a room starts, what the
player *is* at start, win/loss, which laws and natures are allowed.

| Mode | Files | Status | Notes |
|---|---|---|---|
| Embodied (today's play) | `src/modes/modes.ts`, `embodiedDirector.ts` | built | Alice from the start; Wonderland or blank board |
| Spirit | `src/modes/modes.ts`, `spiritDirector.ts`, `bodyNames.ts`, `src/sim/body/*` | built | no body; the room opens with a soul, a drawing named as a body (`alice`, `me`, any body noun) becomes her; `?mode=spirit`. Not built: persisting the body, a wandering pen as camera subject ([modes.md](modes.md)) |
| Sandbox | `src/modes/sandboxMode.ts`, `src/board/boards/endless.ts`, `src/sim/footing.ts`, `src/autopilot/chart.ts` (`WINDOW_PX`), `src/autopilot/pilot.ts` (`explore`), `src/counsel/*`, `src/sync/*`, `src/ui/sharePanel.ts`, `src/ui/titleCard.ts`, `src/game/launch.ts` | built | `?mode=sandbox`: an endless shared page (`?board=<id>`, default `sandbox`); the chart is windowed around every Alice and the pilot explores toward the newest ink; Kami helps only when asked ("help", "give me an idea": a bridge over a gap, a ladder up a wall, an idea on open page); `inkEater` refused with "Nothing hungry lives on this page."; title card and share panel (link + QR + who is here); see [modes.md](modes.md) |
| Puzzle | `src/modes/puzzle/{mode,rooms,puzzleDirector}.ts`, `src/modes/director.ts`, `src/board/boards/puzzles/*`, `src/game/forgetfulStore.ts`, `src/ui/roomCard.ts`, `src/sim/nightfall.ts` | built | seven staged rooms, one drawn or written idea each, Sumikui loose from the first frame, laws fold over the room's own world, room card + progress mark, goal → next room, nothing saved; `?mode=puzzle`; see [puzzles.md](puzzles.md) |
| Boss | `src/modes/modes.ts`, `src/sim/body/*`, `src/sim/boss/*` (`snipper.ts`, `tear.ts`, `weapons.ts`, `tuning.ts`), `src/render/bossPainter.ts`, `src/game/bossLines.ts` | built | two players (drawer + controller) in the screen-sized `arena` page with a pinned camera; start as a soul/heart; a servant of the one under the page snips body parts → abilities lost, redraw to restore; drawn weapons and hazards hurt it; lesser waves at 60 % / 30 %; tear closure shows a win card, while a swallowed heart restarts the board; `?mode=boss` ([boss.md](boss.md)) |
| Independent clones | `src/game/party.ts`, `src/sim/twins.ts`, `src/sim/simulation.ts`, `src/sim/portals.ts`, `src/sim/sumikui.ts`, `src/autopilot/pilot.ts`, `src/autopilot/chart.ts`, `src/render/alicePainter.ts` | built | real second Alices with their own minds: own intent, pilot, route, portals and fate; tap one to steer her; any Alice wins the room and Kami names her; see [agency.md](agency.md) |

## 17. Persistence and the server

| Component | Files | Status | Notes |
|---|---|---|---|
| Board store client | `src/persistence/httpBoardStore.ts`, `writeQueue.ts`, `unsavedGuard.ts`, `session.ts`, `boardResponse.ts` | external | drawings, notes, rules saved through the Bun API; ordering and validation rules in [persistence-ordering.md](persistence-ordering.md) / [persistence-validation.md](persistence-validation.md) |
| Schemas | `src/persistence/schemas.ts` → `server/schemas.ts` | shared | zod for every persisted shape incl. `RuleEffect` and `MotionEdit` |
| Server | `server/index.ts`, `server/http/*`, `server/db/*` | external | Bun + MongoDB; routes in [server/README.md](../server/README.md); access model in [access.md](access.md) |
| Model compile | `server/compile/*`, `server/llm/*` | external | prompt lists every dial incl. `heed`; output clamped by `effectRanges.ts` |
| Shared board (live) | `src/sync/wire.ts`, `src/sync/boardLink.ts`, `src/sync/peer.ts`, `server/sync/boardFeed.ts`, `server/sync/boardEventStream.ts`, `src/game/game.ts` (`followPage`, `receive`) | built | one board id, many devices: the server numbers every put/delete/clear per board and relays it over SSE (`GET /api/boards/:board/events`, resumable by `Last-Event-ID`, `resync` when the log does not reach back); presence (`POST /api/boards/:board/presence`, every 250 ms) paints the other devices' Alices as ghosts; remote changes land through the same seams as a load |

## 18. Verification

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun install
bun run format      # biome
bun run check       # tsc --noEmit && biome check && vitest run
bun run build
```

Tests live beside the code (`src/**/*.test.ts`, `server/**/*.test.ts`). Sim behaviour is tested
by running the real matter-js world (`src/sim/testSupport.ts`); grammar by compiling sentences;
fold/repeal by `resolvePhysics`; the client/server contract by `server/schemas.test.ts` and
`server/natures/recognitionContract.test.ts`. There is no CI in the repo; the gate is run locally
before every PR.

## 19. Flow at a glance

```
pen ──► InkSession ──► Drawing ──► ledger + sim body (load-bearing strokes) ──► Eye.sight ──► Cat ──► Ruling
                                                                                         (nature, temper→heed, own motion)
text ─► funnel: grammar ─► scene ─► summons ─► naming ─► model ─► Rule ─► RuleBook.fold ─► sim.setPhysics
                                                                                              │
party (a pilot per Alice) / stick / keyboard / cabinet / voice ─► intent per Alice ─► Alices ◄── creatures (urgeOf: heed) ◄─┘
                                                                  ◄── vehicles, portals, Sumikui, twins
each frame: camera(angle = paper turn) ─► renderer(board, ink@pose, notes, Alice, Sumikui, night)
persistent: drawings, notes, rules ─► BoardStore ─► Bun API ─► MongoDB
```

## 20. Keeping this page honest

When a PR adds a component: add a row (files, status, one line of contract). When it changes a
dial: update § 7 and the seam checklist in § 2. When a planned item lands: change its status word
and drop the child-session note. Retired components are removed, not struck through.
