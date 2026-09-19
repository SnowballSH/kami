# sim/

`docs/architecture.md` § sim/ is the spec. This file records the choices that are not obvious from the code.

## Files

| File | Holds |
|---|---|
| `simulation.ts` | `MatterSimulation`: owns one `BoardWorld` (engine, props, ink, Alice, checkpoints) per loaded board, the standing `WorldPhysics`, and the tick order below |
| `alice.ts` | `AliceController`: walking, blocking, step-assist, climbing, resize, respawn, traction |
| `contacts.ts` | Collision categories, `Contact`, slope classification, the probe helpers |
| `inkLayer.ts` / `inkEntity.ts` | Live drawings ↔ matter bodies; rebuilds a body when a ruling changes it |
| `inkBody.ts` | Strokes → one compound body |
| `anchoring.ts` | Anchor-cluster counting |
| `natures.ts` | The strategy table keyed by `Nature`: ten spirits and four roles |
| `boardProps.ts` | The board's pre-sketched solids, door, key, goal |
| `checkpoints.ts` | Which zones Alice has reached and where that puts her back |
| `worldPhysics.ts` | `WorldPhysics` → matter-js numbers: accelerations, materials, per-body pushes |
| `emptyBoard.ts` | What the simulation holds before the first `loadBoard` |
| `constants.ts` | Every tuning number |

## Step and tick

`step()` is one fixed step of game time. The effective time scale is `bulletTime × physics.timeScale`. matter-js is only stable up to one fixed step per update, so a scale above 1 is split into `ceil(scale)` equal **ticks**, each at a scale ≤ 1; a scale at or below 1 is a single tick. Events from every tick are returned together.

Tick order: `alice.control` → nature `beforeStep` hooks → wind → `Engine.update` → resize tween → `alice.sense` → Alice touches (door, `onAliceTouch`) → ink touches (`onSurfaceTouch`) → key, goal → lost-and-respawn → zone arrival.

## The endless board

There are no walls and nothing clamps. Alice is lost when she is below `board.killY`, or further than `LOST_DISTANCE` from every board solid **and** every piece of held (static) ink — so a game sketched far from the blank board's patch is still somewhere. Lost ink is simply left alone: it keeps falling, costs next to nothing, and the renderer culls it. Floaty ink rises for ever.

## Zones and checkpoints

Alice is "in" the last zone whose `fromX` is at or left of her centre. The first tick she is in a zone she has not been in before emits `zone-entered` — **including the zone she spawns in**, on the first step after `loadBoard`, so the opening zone's intro is announced the same way as the others. Each zone fires once per load.

She respawns at the checkpoint of the zone she **most recently arrived in**, not the one she happens to be over: fall back into the ditch after reaching The Shelves and she returns to The Shelves, not across the ditch she already solved. With no zone yet (or a board without zones) it is `board.spawn`. Ink ruled `spawn` overrides both while it exists: her feet go to the top-centre of its bounds, which is never inside the ground it was drawn on. With several, the last one added wins; erase it and the checkpoint applies again. Ruling ink `spawn` does not move her now.

## Roles

`solid`, `goal`, `hazard` and `spawn` are **pinned**: the body is rebuilt static at the pose it was drawn in, whatever the ink did in the meantime. A platform sketched in mid-air falls as plain ink while its note is being written, and snaps back up when the note lands. `goal` and `spawn` do not collide with Alice; `goal` fires through the same overlap probe that ladders use. `hazard` is solid, and any touch (footing, ahead, or an engine pair) marks her lost for this tick, so several hazards touched at once are one `fell`.

`goal-reached` is once per load, whichever of `board.goal` or goal ink comes first.

## World physics

`setPhysics` is kept on the simulation, handed to every new `BoardWorld`, and pushed into the live bodies at once.

- **gravity** is copied into `engine.gravity` each tick (`GRAVITY_SCALE` px/ms² per g). Climbing and floaty ink cancel whatever the current gravity is.
- **wind** is a force of `mass × wind × GRAVITY_SCALE` on Alice and every dynamic ink body, applied before the engine update.
- **airDrag** multiplies each body's base `frictionAir` (capped at `MAX_AIR_FRICTION`, beyond which matter-js velocities flip sign). **friction** multiplies ink friction. **bounciness** is the restitution of ink and Alice.
- Alice's friction is 0 by design (she is velocity-driven), so world **friction** is her *traction* instead: at 1 or more her walk is a set velocity as always; below 1 she accelerates by `SLIDE_ACCELERATION / (1 − traction)` per tick, which at 0 is exactly the slippery-ink slide.
- Airborne with no walk input she keeps her horizontal velocity instead of having it zeroed. That is what lets sideways gravity and wind carry her; on the ground, idle, she only creeps by one tick's worth of push.
- `BOUNCE_SPEED` does not scale with gravity — that is why the Moon makes a bounce go higher.

## Alice feels her way with probes, not with engine pairs

Her body is nudged 2 px down and 1.5 px ahead and tested against everything solid (`contactsAt`). Probes see a wall *before* she pushes into it, so she never shoves ink around and never jitters against it; engine pairs flicker once she stops pushing. Pairs are still merged in for touch triggers (a cake dropped on her head). A third probe, at her own position, reports the passable ink she overlaps (ladders, goals, spawn marks).

`Matter.Query.collides` stops at the first colliding part of a compound, which hides the steep part of a blob behind a walkable one; `contactsWith` reports every part. Contact normals are re-oriented using the support point, because matter-js orients them by part centres.

A contact *supports* her if its normal is within 50° of straight up, and *blocks* her if it opposes her walk by more than that. Blocked, she stops driving into it and slides under gravity.

## Step-assist and the slope limit

Blocked for 3 ticks (1 tick when airborne, so she can catch a ledge she almost cleared), she is lifted by the smallest 2 px multiple that frees the spot 3 px ahead. The allowed rise is `clamp(0.3h, 12, 0.5h)` if anything solid is in the way and `0.8h` against ink alone.

Against ink the rise is measured from her **last walkable footing**, not from where she is. Otherwise repeated small lifts would walk her up any steep line and the 50° limit would mean nothing: a steep ramp must not be a way up the ledge. She can scramble 0.8h up a steep line, then slides back.

## Anchoring

Stroke points are resampled every 8 px (a fast stroke may be two points), kept if within 16 px of a *marker* rect, and greedily seeded into clusters ≥ 40 px apart. A 60 px blob sat on the ground therefore counts two anchors and is static; a 30 px one is dynamic. Anchors are recounted at the body's current pose whenever a ruling is applied, so a ladder that started to tip while it was being named still holds.

## What sticky ink sticks to

Sticking is anchoring by touch, so it follows the anchoring rule: only **marker** solids hold ink, plus ink that is itself held (static). Glass and the door never freeze sticky ink. `spec.md` is the authority here — *"The table is glass: ink won't anchor to it, nothing sticks"*. If glass froze sticky ink, two short "glue" strokes against the table's side would make a staircase to the key and skip the cake. `simulation.test.ts` pins this.

## Ink bodies

Strokes are simplified (Ramer–Douglas–Peucker, 1.5 px) before becoming rectangles: fewer parts, fewer seams, same silhouette. The pose origin is the compound's centre of mass, which does not depend on density or static-ness, so rebuilding a body for a new nature keeps `Pose.origin` stable; the new body is moved to the old body's position and angle (unless the nature is pinned).

matter-js sums compound inertia without the parallel-axis term. A hollow blob ends up with about a third of its real inertia and rocks and creeps across the floor forever. `buildInkBody` sets the correct inertia.

## Tuning

- `BOUNCE_SPEED` is 16.5. With Alice's air friction (0.02) that lifts about 280 px at 1 g, which clears the 220 px ledge with full air control from a mushroom centred anywhere from ~120 px to ~20 px short of the plateau face.
- The key is within reach only when Alice is big: standing under or beside the glass slab, her reach (half her height beyond her body) just touches the key above it; at normal size it stops well short.
- `grow-blocked` is emitted once per touch; touching again within 1.5 s does not repeat it.
- Ladders, goals and spawn marks do not count as ceilings for growing.

## Tests

`rooms.test.ts` plays the Wonderland board headlessly through the `Simulation` API: each puzzle from its zone's checkpoint, one run from the first bank to the rabbit hole, and the zone/checkpoint rules. `roles.test.ts` and `physics.test.ts` sketch on the blank board. `simulation.test.ts` covers loading, anchoring and the spirits.
