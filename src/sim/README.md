# sim/

`docs/architecture.md` § sim/ is the spec. This file records the choices that are not obvious from the code.

## Files

| File | Holds |
|---|---|
| `simulation.ts` | `MatterSimulation`: owns one `Room` (engine, props, ink, Alice) per loaded level and runs the step order below |
| `alice.ts` | `AliceController`: walking, blocking, step-assist, climbing, resize, respawn |
| `contacts.ts` | Collision categories, `Contact`, slope classification, the probe helpers |
| `inkLayer.ts` / `inkEntity.ts` | Live drawings ↔ matter bodies; rebuilds a body when a ruling changes it |
| `inkBody.ts` | Strokes → one compound body |
| `anchoring.ts` | Anchor-cluster counting |
| `natures.ts` | The strategy table keyed by `Nature` |
| `props.ts` | Level solids, page-edge walls, door, key, exit |
| `constants.ts` | Every tuning number |

## Step order

`alice.control` → nature `beforeStep` hooks → `Engine.update` → resize tween → `alice.sense` → Alice touches (door, `onAliceTouch`) → ink touches (`onSurfaceTouch`) → key, exit, fall.

## Alice feels her way with probes, not with engine pairs

Her body is nudged 2 px down and 1.5 px ahead and tested against everything solid (`contactsAt`). Probes see a wall *before* she pushes into it, so she never shoves ink around and never jitters against it; engine pairs flicker once she stops pushing. Pairs are still merged in for touch triggers (a cake dropped on her head).

`Matter.Query.collides` stops at the first colliding part of a compound, which hides the steep part of a blob behind a walkable one; `contactsWith` reports every part. Contact normals are re-oriented using the support point, because matter-js orients them by part centres.

A contact *supports* her if its normal is within 50° of straight up, and *blocks* her if it opposes her walk by more than that. Blocked, she stops driving into it and slides under gravity (her friction is 0).

## Step-assist and the slope limit

Blocked for 3 ticks (1 tick when airborne, so she can catch a ledge she almost cleared), she is lifted by the smallest 2 px multiple that frees the spot 3 px ahead. The allowed rise is `clamp(0.3h, 12, 0.5h)` if anything solid is in the way and `0.8h` against ink alone.

Against ink the rise is measured from her **last walkable footing**, not from where she is. Otherwise repeated small lifts would walk her up any steep line and the 50° limit — which is what keeps a 270 px ink budget from buying a ramp in The Shelves — would mean nothing. She can scramble 0.8h up a steep line, then slides back.

## Anchoring

Stroke points are resampled every 8 px (a fast stroke may be two points), kept if within 16 px of a *paper* rect, and greedily seeded into clusters ≥ 40 px apart. A 60 px blob sat on the floor therefore counts two anchors and is static; a 30 px one is dynamic. Anchors are recounted at the body's current pose whenever a ruling is applied, so a ladder that started to tip while it was being named still holds.

## What sticky ink sticks to

Sticking is anchoring by touch, so it follows the anchoring rule: only **paper** holds ink, plus ink that is itself held (static). Glass, the door and the page-edge walls never freeze sticky ink. `architecture.md` says "first contact with a solid"; `spec.md` Room 3 is the authority here — *"The table is glass: ink won't anchor to it, nothing sticks"*. If glass froze sticky ink, two short "glue" strokes against the table's side would make a staircase to the key and skip the cake. `simulation.test.ts` pins this.

## Ink bodies

Strokes are simplified (Ramer–Douglas–Peucker, 1.5 px) before becoming rectangles: fewer parts, fewer seams, same silhouette. The pose origin is the compound's centre of mass, which does not depend on density or static-ness, so rebuilding a body for a new nature keeps `Pose.origin` stable; the new body is moved to the old body's position and angle.

matter-js sums compound inertia without the parallel-axis term. A hollow blob ends up with about a third of its real inertia and rocks and creeps across the floor forever. `buildInkBody` sets the correct inertia.

## Tuned away from the architecture doc

- `BOUNCE_SPEED` is 16.5, not 11.5. With Alice's air friction (0.02) 11.5 only lifts her about 155 px. 16.5 lifts about 280 px, which clears the 220 px ledge with full air control from a mushroom up to ~100 px from the bookcase.
- Floaty ink has gravity cancelled so it really rises at `1.1 · strength` px/tick, and stops at the top of the page.
- `grow-blocked` is emitted once per touch; touching again within 1.5 s does not repeat it.
