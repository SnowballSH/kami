# Kami — Alice Walks, Words Rule

Design for the second wave: Alice moves by herself, handwriting changes the laws of the page, a
model sits behind the Cat, and generated art can dress the ink. `spec.md` remains the source of
truth for *what Kami is*; this file records the choices that make these four things fit it.

The pillars still hold. **Drawing is the only verb** — the player never steers. **It is what you
say it is** — now including what you say about the *world*. **Think, don't twitch** — Alice's
autopilot is deliberate and re-plans slowly. **The Cat never plays for you** — the model only ever
maps words onto natures and laws; it never solves the room.

## 1. Pencil taps on controls

Nothing in the HUD may swallow a Pencil tap. Every control goes through `ui/tap.ts`:
`pointerdown` on the control captures the pointer; `pointerup` on the same element within a small
slop activates it and marks the element so the browser's own synthesized `click` (which iPadOS
delivers late or not at all for Pencil) is ignored for a moment. Keyboard `click`s still work.
Controls get `touch-action: manipulation` so the global `touch-action: none` does not turn taps
into cancelled gestures. The pen tracker still owns the canvas only; the HUD sits above it with
`pointer-events: none` except on controls, so a tap on a chip never starts a stroke.

The d-pad is gone. Arrow keys / WASD remain as a hidden override for the booth (§2).

## 2. Autopilot

`autopilot/` is Alice's own mind: deterministic, offline, given a `Scene` every simulation step
and asked for a `WalkIntent`. `game/` feeds it `sim.snapshot()`, the level, and the live ink with
natures; it never touches matter-js.

### Objectives

`key` if the room has one and it is not taken → `door` if the room has one and it is shut →
`exit`. The objective is reached when Alice's *bounds* would trigger the corresponding prop rule
(`props.ts`): key within reach (`0.5·height` around her), door touched while holding the key,
exit overlapped. Falling *through* the exit counts — Room 1's exit is a hole.

### Planner

Every `REPLAN_TICKS = 10` ticks, or immediately when `invalidate()` is called (ink added, ruled,
erased, eaten), the planner rasterises the room into a `CELL = 4` px occupancy grid:

- level solids, the page-edge walls, and the door (unless open, or Alice holds the key) →
  `wall`;
- solid ink (`INK_THICKNESS` wide along each stroke in its current pose) → `ink`, tagged with
  its drawing index so the planner knows its nature; climbable ink is passable and tagged
  `climb`; grow/shrink ink is a solid the planner is happy to *touch*.

A **stance** is Alice standing with feet at row `fy` and centre at column `cx`, her current box
free of walls/ink, and something solid under at least 8 px of her width. Breadth-first search
over stances with these moves, in this order of cost:

| Move | Rule (mirrors `alice.ts`) |
|---|---|
| walk | `cx ± 1` cell at the same `fy`, or **step** up ≤ `clamp(0.3h, 12, 0.5h)` onto a wall / ≤ `0.8h` onto ink. |
| fall | if nothing is under her feet after a walk: drop to the first surface below. Forbidden if she would pass `killY` — unless the exit rect is crossed on the way (goal). |
| climb | inside `climb` cells: `fy ± 1` cell while the box stays free. Stepping sideways off a ladder is a walk then a fall. |
| bounce | standing on `bouncy` ink: launch. Landing candidates are stances within the flight envelope of `BOUNCE_SPEED·√strength` under the current gravity with horizontal drift `walkSpeed` per tick, integrated with the sim's air friction. She steers toward the chosen landing in the air. |
| ride | `floaty` ink moves; the planner does not predict it. Re-planning at 6 Hz is enough: when the cloud is level with the ledge, the walk move appears. |

The result is a list of waypoints. Following them: `intent.x = sign(dx)` with a 3 px dead zone;
`intent.y = ±1` while the next waypoint is above/below and she is on a ladder; `0` otherwise.

### When there is no path

1. **Eat.** If a `grow` or `shrink` drawing is reachable, go and touch it — the player drew it
   for a reason, and the order they draw in *is* Room 3's puzzle.
2. **Wait.** Otherwise walk to the reachable stance nearest the objective (Euclidean to its
   centre), stop, and face it. That is the spec's "stops at the edge and looks at you":
   `PilotStatus.stuck` turns true, the renderer paints her looking out of the page. The stuck
   detector keeps its 45 s clock; the Cat's hints are unchanged.

### Pauses and overrides

- Alice **freezes while the pen is down** (`ink.isDrawing`) so the player can draw around her
  without `overlaps-alice` fights. She keeps moving — in bullet-time — while the naming panel is
  open, so a plank can become a cloud under her feet.
- Held arrow keys / WASD produce a manual intent that wins for as long as they are held plus
  `OVERRIDE_GRACE_MS = 1500`.

### What the planner does not do

It does not predict dynamic ink, fluids, or other creatures; it does not jump; it does not use
`heavy`/`light`/`sticky`/`slippery` on purpose. Those still work — a heavy rock that lands as a
step is a step at the next re-plan — the planner just doesn't scheme with them.

## 3. World facts and edits

`world/types.ts` is a pure contract module (like `core/`): what can be *read* and what can be
*written*, by anyone — the model, a debug console, a test.

- `WorldFacts` — page size, `RoomFact` (title, page number, allowed natures, ink budget, spawn,
  exit, key/door state, solids), `PhysicsState`, `AliceFact`, `DrawingFact[]` (id, name, nature,
  strength, world bounds, static). Assembled by `game/` on demand from the level, the sim, the
  ink session and the ledger.
- `PhysicsState` — gravity as `{magnitudeG, angleDeg}`, `timeScale`, `wind`, `airDrag`,
  `bounciness`, `frictionScale`, `walkSpeedFactor`. Units are human: gravity in *g*, angles in
  degrees clockwise from +x (90 = down), wind in *g*. `PIXELS_PER_METRE = 128` lets "g = 1 m/s²"
  be honest: the model converts, `magnitudeG = 1 / 9.81`.
- `WorldEdit` — the full writable surface, a discriminated union: `set_gravity`,
  `set_time_scale`, `set_wind`, `set_air_drag`, `set_bounciness`, `set_friction`,
  `set_walk_speed`, `resize_alice`, `set_nature`, `remove_drawing`, `spawn_drawing`, `set_ink`,
  `reset_physics`. Anything not in the union cannot be said into being: level geometry, the
  key, the door, the exit, Alice's position. Those are the page's, and the Cat refuses in
  character as before.

**Unbounded on purpose.** The player chose a sandbox over puzzle-preserving clamps.
`world/validate.ts` checks only that numbers are finite, natures and sizes are real, drawing
ids exist, and strength is within `STRENGTH_RANGE`. `g = 0` floats everything; `timeScale = 5`
is a fast-forward; that is the point.

**Application.** `sim.setPhysics(patch)` maps the state onto matter-js every step: gravity
vector from magnitude and angle (`GRAVITY_SCALE` stays the unit), `engine.timing.timeScale =
bulletTime · physics.timeScale`, wind as a per-step force `mass · wind · g` on every dynamic
body, `frictionAir` and `friction` re-scaled on live bodies (`natures.ts` materials are the
base), `restitution` on Alice and ink. `walkSpeedFactor` multiplies `WALK_SPEED`.
Ink edits (`set_nature`, `remove_drawing`, `spawn_drawing`) and `set_ink` are `game/`'s:
they go through the same `applyRuling` / ledger / ink-session paths a player action would.
`spawn_drawing` builds strokes for a primitive shape (`ink/shapes.ts`) and commits them as if
drawn, at no ink cost.

**Persistence.** Physics survives room changes (a low-gravity Shelves is a valid way to play
Hall of Doors) and resets on *Reset room* and on `reset_physics`.

## 4. The model Cat

`cat/model/` implements `Cat` over the OpenAI Responses API. `createCat()` returns it when a
proxy is configured and falls back to `ScriptedCat` otherwise **and on every failure** — the
game never waits on the network to stay playable. Hints, `askWhatItIs`, `offerHelp` and the
refusal lines stay scripted: they are authored, in spec §4/§6, and should not drift.

### Flow

```
commit ─► sim.addDrawing (solid, plain) ─► cat.look(drawing, sketch, facts)
             ├─ picture ─► naming panel with the model's three guesses ─► cat.name() ─► Ruling
             └─ words  ──► cat.command(text, facts) ─► Decree{edits, line}
                              ─► validate ─► apply ─► ink dissolves (ghost fade 900 ms) ─► refund
```

- `look` sends one request: the sketch (PNG data URL from `renderer.thumbnail(drawing, 384)`),
  the facts, and a strict JSON schema — `{kind: "picture", guesses: [3]} | {kind: "words",
  text}`. Handwriting like *g = 1 m/s²* therefore just works, and a doodle gets better guesses
  than the geometric heuristic.
- `name` sends the utterance, the facts and the room's `allowedNatures`; the model returns a
  `Ruling` in the same schema `ruling.ts` produces. A nature the room forbids is still turned
  to plain ink by `game/` — that rule lives in code, not in the prompt.
- `command` runs a tool-calling turn: `WorldEdit` variants are exposed as function tools with
  strict schemas generated from one table in `cat/model/tools.ts`; the model's calls become the
  decree's edits and its final message the Cat's line (≤ 15 words, in character).
- The typed box names drawings only. Words for the world are written on the page, with
  whatever you draw with.

Latency is hidden by what is already there: the drawing is solid the instant it commits, and
bullet-time runs while `naming !== null`. `LOOK_TIMEOUT_MS = 4000` then falls back to scripted
guesses.

### Key handling

The browser never sees the key. `server/openaiProxy.ts` forwards `/api/openai/*` to
`https://api.openai.com/*`, replacing the `Authorization` header with `OPENAI_API_KEY` from the
environment and allowing only `POST /v1/responses`. It is mounted as Vite middleware in dev and
preview (so `bun run dev` on the LAN is the whole booth) and can run alone via `bun run serve`.
The client uses the official `openai` package with `baseURL = "/api/openai/v1"` and a dummy
key. Configuration in `.env.local` (git-ignored): `OPENAI_API_KEY`, `VITE_CAT_MODEL`
(default `gpt-5.6`), `VITE_CAT_REASONING` (default `low`).

## 5. Fading words

Words are ink until the Cat reads them, so they cost ink, collide, and can be erased — the
same as everything else. Once `look` says *words*, `game/` removes the drawing from the sim,
refunds its cost, and moves it to the ledger's **ghosts**: `RenderFrame.ghosts` carries the
drawing, its last pose and `fadeStartMs`; `inkPainter` draws it in fountain blue with alpha
`1 − t`, and the ledger drops it after `GHOST_FADE_MS = 900`. The Cat's line arrives in the
bubble as the ink goes.

## 6. Art provider

`art/types.ts`: `ArtProvider.illustrate({drawing, name, nature, sketch}, signal) →
DrawingArt | null`. `game/` calls it once per awakening (never for plain ink), and on success
calls `renderer.setArt(id, art)`. `DrawingArt.frame` is a rect in the drawing's *drawn* frame,
so the renderer applies the same pose transform it uses for the ink and the picture rides the
body exactly. Physics, hit-testing and the eraser never see art; the ledger's thumbnails stay
ink so the ending flip-through shows what was drawn.

`createArtProvider()` returns `HttpArtProvider` when `VITE_ART_URL` is set — `POST {name,
nature, image, width, height}` → `{image: dataUrl}` — and a provider that always answers `null`
otherwise. The GPU model plugs into that endpoint.

## 7. Testing

- `autopilot/*.test.ts`: the planner on synthetic grids — steps, forbidden falls, exit hole,
  ladder, bounce envelope; and each of Rooms 1–3 headless with the actual `sim`: given only the
  spec's canonical drawings, Alice clears the room within a tick budget.
- `world/validate.test.ts`: every op accepted with finite numbers, rejected on NaN/Infinity,
  bad natures, unknown ids.
- `sim/physics.test.ts`: gravity angle, time scale, wind, bounciness observable on bodies.
- `cat/model/*.test.ts`: tool table ↔ `WorldEdit` round trip, schema strictness, fallback on
  errors, classification parsing — with a fake transport, never the network.
- `game/game.test.ts`: the room playthroughs no longer walk; they draw and step.
