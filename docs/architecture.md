# Kami — Software Demo Architecture

A proof of concept of `spec.md` layers 1 and 2 (ink is solid; ink is what you say it is) across Rooms 1–3, playable in a browser on an iPad: finger or Apple Pencil draws, an on-screen d-pad walks, guess chips and a typed box name things. No network, no API keys. `engineering-notes.md` holds the longer-term plan; this file describes what is actually built.

## Shape

```
 pointer ─► ui/attachPen ─► game ─► ink/InkSession ── commit ──► sim (solid NOW, plain ink)
                             │                                      ▲
 d-pad / keys ─► ui/Hud ─────┤                                      │ applyRuling
 chip / typed name ──────────┼─► cat.name() ─► Ruling ──────────────┘
                             │
                             └─► render (every frame)   ui/Hud (ink meter, Cat caption, panels)
```

`game/` is the only module that knows about the others. Everything else depends on `core/` and on other modules' **`types.ts` only** — never on their implementations.

| Module | Owns | Entry point |
|---|---|---|
| `core/` | `Vec`, `Rect`, `Stroke`, `Pose`, geometry helpers, world constants | — |
| `ink/` | Turning pen input into committed `Drawing`s; ink budget; placement rules; hit-testing for the eraser | `createInkSession`, `findDrawingAt` |
| `sim/` | matter-js world: level solids, ink bodies and anchoring, Alice, natures, key/door/exit | `createSimulation` |
| `cat/` | Name → `Ruling`, shape guesses, hint ladder, the Cat's lines | `createCat` |
| `render/` | Canvas 2D: the page, level art, ink, Alice, props | `createRenderer` |
| `ui/` | DOM HUD, d-pad + keyboard, naming panel, Cat caption + speech, title cards, ending; pointer → pen | `createHud`, `attachPen` |
| `game/` | Levels, the frame loop, and all wiring | `startGame` |

Each module's `types.ts` is its contract. Contracts change only deliberately, and `game/` is updated in the same change.

## Conventions

- **World space** is a fixed 1024×768 page, y-down, in px (`core/world.ts`). The renderer letterboxes it into whatever viewport it gets; nothing outside `render/` and `ui/attachPen` ever sees client pixels.
- **Fixed step.** `game/` accumulates real time and calls `sim.step()` in 1/60 s steps, so a 120 Hz iPad and a 60 Hz laptop play identically.
- **Poses.** A drawing's strokes are stored where they were drawn and never mutated. The sim reports a `Pose` per drawing (`origin` = body position at creation, plus current `position` and `angle`); renderer and eraser use `poseToWorld` / `worldToPose`.
- **No module-level mutable state.** Factories return objects; tests construct their own.

## ink/

- `penDown → penMove* → penUp`, one pointer at a time. Points closer than 3 px to the previous one are dropped.
- **Budget.** Cost is stroke length. `budget.remaining` reflects strokes in progress, live. When it hits zero the pen runs dry: further `penMove`s are ignored.
- **One drawing.** Everything drawn within `COMMIT_DELAY_MS = 900` of the last pen-up is one drawing. The timer runs off the `nowMs` passed to `update`, not wall-clock, so tests are deterministic.
- **Placement.** `activeVerdict` is refreshed every `update`: `no-ink-zone` if any point lies inside a zone, `overlaps-alice` if any stroke segment passes within `INK_THICKNESS / 2` of Alice's bounds. On commit, a non-`ok` verdict rejects the drawing, refunds it, and calls `onReject`. Drawings shorter than 8 px total are dropped silently (stray taps).
- `isDrawing` is true from pen-down until commit/reject.
- `findDrawingAt` transforms the point into each drawing's drawn frame with `worldToPose` and measures `distanceToStroke`; last-drawn wins.

## sim/

matter-js 0.20, gravity `y = 1`, `Engine.update(engine, FIXED_STEP_MS)` per `step()`, `engine.timing.timeScale` for bullet-time. The snippets in `engineering-notes.md` §5.1–5.2 were tested headless and are the starting point.

**Ink bodies.** One rigid compound of thin rectangles (`INK_THICKNESS` wide) along the strokes, density 0.004, friction 0.8. A single-point stroke becomes a small circle.

**Anchoring.** Count clusters of stroke points within 16 px of **paper** solids (clusters ≥ 40 px apart; glass and the door never count). ≥ 2 clusters → static. Otherwise dynamic. Exception: `climbable` and `sticky` ink holds with ≥ 1 cluster — a ladder stood on the floor stays up.

**Alice.** 28×60 at `normal`, chamfered, `friction 0`, `inertia Infinity`; scaled by `ALICE_SCALE`. Walk speed `2.2 · √scale` px/tick set directly on velocity x; full air control.
- *Step-assist:* blocked for 3 ticks → if the space `step` px up and 3 px forward is free, lift her there. `step = clamp(0.3h, 12, 0.5h)` against level solids, and up to `0.8h` against ink so she can scramble onto a drawn blob.
- *Slopes:* ink steeper than ~50° acts as a wall, not a ramp.
- *Resize:* `grow` → `big`, `shrink` → `small`, tweened over 400 ms, feet stay planted; re-assert `inertia = Infinity` after every `Body.scale`. If there is no headroom to grow, emit `grow-blocked` and leave the drawing uneaten.
- *Fall:* centre below `level.killY` → emit `fell`, put her back at `spawn` with zero velocity, size unchanged.

**Natures** (`Ruling.strength` scales the effect, 0.5–2):

| Nature | Behaviour |
|---|---|
| `ink` | Nothing extra. |
| `bouncy` | Alice touching it from above (contact normal mostly vertical, her feet above its centre) gets `vy = -11.5 · √strength` px/tick, emit `bounced`. At strength 1 she must clear a 220 px ledge with margin; tune against a test. |
| `climbable` | Does not collide with Alice. While her bounds overlap it (within 6 px of a stroke), gravity on her is cancelled, `vy = intent.y · 2` px/tick, `climbing = true`. |
| `floaty` | Rises at `1.1 · strength` px/tick (velocity set each tick, angular velocity damped), and carries Alice if she is standing on it. Made dynamic even if it was anchored. |
| `heavy` | Density ×12 · strength. |
| `light` | Density ×0.08, `frictionAir` 0.08. |
| `slippery` | Friction 0 on the ink, and Alice keeps sliding on it. |
| `sticky` | Becomes static at once if anchored ≥ 1 cluster, otherwise on its first contact with a solid. |
| `grow` / `shrink` | One use. On Alice contact: resize her, remove the drawing, emit `consumed`. |

`applyRuling` may rebuild the body (static ↔ dynamic) but keeps the drawing's `Pose.origin` stable.

**Props.** *Key:* a circle of radius 18 at `level.key`; taken when it intersects Alice's bounds expanded by `0.5 · height` on every side (her reach) → `key-taken`. *Door:* a static solid at `level.door`; on Alice contact while she holds the key it is removed → `door-opened`. *Exit:* Alice's bounds overlapping `level.exit` → `exit-reached`, once.

## cat/

Offline stand-in for the model, behind the same `Cat` interface an LLM-backed implementation will satisfy (hence the `Promise`s).

- **`name`** — keyword tables from `spec.md` §4 "Things people will say", longest match wins; adjectives (*very, super, really, huge, giant, extra* → up to 2; *slightly, a bit, little, tiny, weak* → down to 0.5) set `strength`. Spec §4 "Rulings for the clever and the cheeky" are implemented verbatim: anything aimed at Alice or the room is refused as plain ink; *key*, weapons → plain ink with the authored line; *helicopter*-likes → `floaty`. A nature not in the room's `allowedNatures` becomes plain ink with an in-character refusal. Tags: `rose`, `tart`, `queen`.
- **`guess`** — a geometric heuristic over the drawing (aspect ratio, closedness, size): tall-and-thin suggests a ladder, round-and-closed a mushroom/balloon/rock, flat-and-wide a plank. Always three distinct names, biased toward natures the room allows.
- **`hint`** — tiers 1 → 2 → 3, one rung per ask, sticks at 3.

## render/

Canvas 2D at device pixel ratio. A yellowed page; level art pre-rendered once per room to an offscreen canvas with **roughjs** (seeded, so it doesn't boil) in black ink — paper solids hatched, glass pale blue and unhatched, no-ink zones red hatching, the exit a ragged dark hole. Player ink is **perfect-freehand** outlines in fountain-pen blue, tinted per nature once awake, with a ~500 ms shiver after `awakenedAtMs`. Active strokes draw live; red when `activeVerdict` isn't `ok`. Alice is a procedural two-frame doodle scaled to her snapshot; she visibly carries the key. Bullet-time gets a soft vignette.

## ui/

DOM over the canvas; `touch-action: none`, no text selection, no callouts, no overscroll — nothing the iPad does by default may fire mid-stroke. Safe-area insets respected.

- **D-pad** bottom-left (left/right always; up/down for ladders), multi-touch safe via pointer capture, so a thumb can hold *right* while the other hand draws. Arrow keys / WASD do the same on a laptop.
- **Top bar:** room title, ink meter, eraser toggle, reset room, ask-the-Cat, mute.
- **Naming panel:** bottom-centre, never modal: three chips, a text box, "just ink". Min 44 px touch targets.
- **Cat:** grin + caption bubble, auto-fading; spoken with `speechSynthesis` when available and unmuted.
- **`attachPen`:** Pointer Events with capture; first pointer down on the canvas owns the stroke until it lifts; others are ignored. Uses `getCoalescedEvents` when present for smooth Pencil lines.

## game/

- **Loop:** `requestAnimationFrame` → accumulate → `sim.step()` × n (max 5 per frame) → handle `SimEvent`s → `ink.update` → `renderer.render` → `hud.setInk`.
- **Bullet-time** while `ink.isDrawing` or the naming panel is open.
- **Naming flow:** commit → `sim.addDrawing` (solid immediately) → if `level.namingEnabled`: Cat asks, `cat.guess` fills the chips → chip/typed name → `cat.name` → `sim.applyRuling` + tint + Cat line. Dismissing, or 12 s of silence, leaves it plain ink.
- **Eraser:** while active, pen-down erases the drawing under the point and refunds its ink.
- **Stuck:** 45 s without progress or three falls → `cat.offerHelp()`.
- **Rooms:** Riverbank → title card "Kami" → Shelves → Hall of Doors → ending: a flip-through of everything the player drew, captioned with what they called it.
