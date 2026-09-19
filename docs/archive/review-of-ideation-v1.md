# Review of `ideation-v1.md` (the original "Paper" design doc)

Kept for the record. Every fix here is already folded into `paper-plan-v2.md` and carried into `docs/plan.md`.

**Strong, keep:** compile once into a deterministic rule, no LLM in the tick loop · three mechanisms (expression / action / constraint) instead of topic categories · showing the "Paper understood" gloss · hardware as a client input device · one unified cut list.

## 1. The flagship physics example is wrong
- `governs: position.y, expression: y0 - k*(y0 - y)` with k = 5 multiplies displacement by 5 every frame. It diverges; starting at `y0` it never moves; for 0 < k < 1 it decays without oscillating. A force law is second-order: write `fy = -k*(y - y0)` and integrate. Verified by running both.
- `y = 3*sin(2*t)+5` in raw canvas pixels is a 3-pixel wiggle at the top of the screen. Expressions need a defined space: units, y-up, rest pose injected, `t` in seconds.
- Use `math.compile()` once, not `evaluate(string)` sixty times a second.

## 2. The schema can't express the pitch's own examples
- "Flinch smaller each time", "grows on every click" need relative, stateful effects; `set_property` was absolute.
- "Bolts from the cursor" needs cursor position in expression scope.
- "Grumpy when it's not raining" needs other objects' state — and new art, which is a can't-do.
- "Sneeze *and* flinch" is two rules from one sentence; the tool returned one.
- `keyframes` was `{type: object}` with nothing defined. Use hand-tuned presets.

## 3. Excalidraw can't be the animation surface
No skew/squash, scaling freedraw rewrites points, `updateScene` at 60 fps pollutes undo and fires `onChange` into persistence. Flubber morphs single closed shapes — a 30-stroke lion isn't one. Multi-stroke open drawings aren't closed polygons, so `pathToVertices` + `poly-decomp` produce garbage (and need the pathseg polyfill).

## 4. Matter.js specifics
`engine.gravity` is global → regional gravity must be per-body forces. Per-region slow-mo works via `body.timeScale`; backwards time doesn't exist. `setPosition` each tick teleports without momentum. A Free Rider vehicle needs wheels, axles and motor torque; Matter has no CCD.

## 5. Movie mode contradicted itself
Only closed-form expressions in `t` can be evaluated at a scrubber position. Record-and-playback works for everything.

## 6. Plumbing
SQL tables were declared in an order that fails · supabase-js has no client-side transactions · `trigger: tick` was used to mean "once" · `_lastFired` never set · proximity re-fired every tick · runtime state lived on rule rows · `behaviors` duplicated action rules · nothing decided create vs. edit · mathjs needs its documented lockdown · the knob needed §6.4 patching four hours before it was scheduled — and routing a knob through an LLM call was wrong anyway.

## 7. Scope
Voice, snap-to-shape, gallery, Mongo, Devin and Zenni Claw had no hours in the schedule and no place in the cut list. Seven sponsor prizes means seven shallow integrations.
