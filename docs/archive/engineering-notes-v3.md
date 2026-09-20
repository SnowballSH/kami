# Kami — Historical Engineering Notes (plan v3)

**Archived design, not implementation instructions.** These examples predate the endless-board
demo. The Zustand store, Supabase edge functions, mathjs expressions, Excalidraw level loader,
voice flow and dependency list below are historical proposals, not current contracts or a backlog.
Use the [current architecture and integration guide](../architecture.md) for the implementation
and the [spec](../spec.md) for product requirements. The old section numbers and test claims below
describe the original experiments; they do not establish current verification.

The code in the Engine section (ink colliders, two-point anchoring, Alice's controller, step-assist, bounce) was run headless against matter-js 0.20, and the unit conversions and mathjs lockdown against mathjs. Treat it as a tested starting point, not as a mandate.

## Changes since these notes were first written (as plan v3, when the project was called "Curiouser")

- **`make` gains two fields:** `strength` (0.5–2, from the player's adjectives) and `guesses` (the model's top three names, shown as chips when the player stays silent for 3 s).
- **A spoken or typed name applies to the drawing committed within ~5 s before or after it.**
- **Enchantments are stretch** and live mainly in the Mad Tea Party; Room 4 must be solvable with natures alone (drifting lily pads).
- **The guard reacts to three tags:** `rose` (runs to paint it), `tart` (runs to it), `queen` (kneels where he stands).
- **No `key` nature, ever.** Drawn keys are plain ink.
- **Teacups** per room: cleared · under ink par · no hints. Needs `inkPar` in the level meta.
- **Booth mode:** number keys jump rooms, one key hard-resets, idle → attract loop.
- Section numbers like "§4.2" inside these notes refer to the old plan; the matching material is now in `spec.md`.

---

## Architecture

```
 pointer ─► ink/session.ts ─ commit ─► sim/ink.ts ──► Matter body (solid NOW)
                                  │
 Space ─► io/voice.ts ─ text ─────┼─► agent/cat.ts ─► cat-proxy (edge fn, holds keys)
                                  │      tools: make · enchant · patch · remove · guide · say
                                  ▼                 │
                              store.ts ◄────────────┘ nature / rules / Cat line
                                  │
   sim/engine.ts   Matter 60 Hz · Alice controller · natures · enchantment rules · NPCs
   game/level.ts   load .excalidraw · budgets · win check · checkpoints · stuck detector
   render/canvas.ts  level bitmap · ink · sprites · particles · Cat grin + caption · HUD
```

```
src/
  units.ts          px↔units (enchantments only)
  store.ts          zustand: level state, drawings, rules, budgets, undo
  ink/session.ts    strokes, smoothing, commit timer, bullet-time, ink cost
  sim/engine.ts     Matter setup, fixed step, collision routing
  sim/ink.ts        inkBody, anchors, circle check              (§5.1)
  sim/alice.ts      walk, step-assist, grow/shrink, fall-recover (§5.2)
  sim/natures.ts    preset table + per-tick/contact behavior    (§4.2)
  sim/rules.ts      v2 rule engine, trimmed                     (§5.4)
  sim/npc.ts        rabbit path, card guard
  game/level.ts  game/levels/*.excalidraw + *.json
  agent/tools.ts  agent/cat.ts  agent/evals.ts
  io/voice.ts  io/tts.ts  io/serial.ts
  render/canvas.ts  render/anims.ts
supabase/functions/  cat-proxy/  deepgram-token/  cat-voice/
```

Deps: `matter-js@0.20`, `perfect-freehand`, `mathjs`, `zustand`, `zod`, `@excalidraw/excalidraw` (only for `exportToCanvas` at level load).

---

## Engine

Code in §5.1–5.2 was run headless against matter-js 0.20 before writing this.

### 5.1 Ink → collider

Every drawing is **one rigid compound of thin rectangles along its strokes.** Concave-safe, no `poly-decomp`, no hulls.

```ts
function inkBody(strokes: Vec[][], thick = 10, opts = {}) {
  const parts = [];
  for (const pts of strokes) for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) continue;
    parts.push(Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len + thick, thick,
                                { angle: Math.atan2(b.y - a.y, b.x - a.x) }));
  }
  return Body.create({ parts, density: 0.004, friction: 0.8, ...opts });
}
```

**Anchoring — the rule that makes bridges work.** Count clusters of stroke points within 16 px of static level geometry (clusters ≥ 40 px apart). **≥ 2 clusters → the drawing is static.** Otherwise it's a free dynamic body.

Why: an unanchored bridge rests fine on its own, but Alice shoves it off the bank the moment she walks into its end (tested — it falls every time). Anchored-static fixes it, and it's a fair puzzle rule: *ink holds if it touches the world in two places.*

- Single closed stroke with circularity > 0.85 → `Bodies.circle`, so balls roll.
- Ink cost = total stroke length in px. Reject a commit that overlaps Alice or a no-ink zone (ink turns red while drawing there).

### 5.2 Alice

```ts
const alice = Bodies.rectangle(x, y, 28, 60,
  { chamfer: { radius: 13 }, friction: 0, frictionAir: 0.02, inertia: Infinity });
// each tick: Body.setVelocity(alice, { x: dir * 2.2 * Math.sqrt(size), y: alice.velocity.y });
```

- **Step-assist:** blocked for 3 ticks → if the space `step = clamp(0.3·h, 12, 0.5·h)` px up and 3 px forward is empty, translate her there. Lets her mount a 10 px ink line at any size; real walls still block. (Tested at sizes 0.4 / 1 / 2.)
- **Resize:** `Body.scale(alice, k, k)` then **`Body.setInertia(alice, Infinity)`** again — `scale` recomputes inertia and she'll start tumbling otherwise. Tween over 400 ms. Refuse to grow if the space above isn't free.
- **Fall recovery:** below the room's kill line → disable collisions, float her back to the checkpoint over 1.5 s, skirt as parachute.
- **Riding:** friction does it for slow platforms; for enchanted movers, add the platform's velocity to hers while she stands on it.

### 5.3 Loop

Fixed step `Engine.update(engine, 1000/60)`. Matter's native gravity (`gravity.y = 1`). Bullet-time = `engine.timing.timeScale = 0.15`.

`beforeUpdate`: Alice controller → nature forces (`floaty`, `buoyant`) → enchantment rules → NPCs.
`collisionStart`: route by `body.parent` (compound parts collide, parents carry identity) → `bouncy`, `grow`/`shrink` consume, key pickup, exit sensor, guard contact.

### 5.4 Enchantment rules (v2 engine, trimmed)

```ts
type Rule = {
  id: string; source_text: string; status: 'active'|'error';
  vars: Record<string, number>;                     // every tunable number lives here
} & (
  | { kind:'expression'; object_id: string; assign: { target: Target; expr: string }[] }
  | { kind:'action'; object_id: string; trigger: Trigger; effects: Effect[] }
  | { kind:'constraint'; object_ids: [string, string]; spec: { type:'rope'|'spring'; length?: number; stiffness?: number } }
);
type Target  = 'x'|'y'|'angle'|'vx'|'vy'|'fx'|'fy'|'scale';
type Trigger = { type:'interval'; ms:number } | { type:'touch_alice' } | { type:'near_alice'; distance:number };
type Effect  = { type:'anim'; preset:string } | { type:'sound'; sound:string }
             | { type:'particles'; particle:string } | { type:'set'; target:Target; expr:string };
```

Expression space: units, **y up**, 1 unit = 50 px, `t` seconds since the rule started, rest pose `x0, y0`, Alice as `alice.x, alice.y`. Physics goes through forces (`fy = -k*(y - y0) - c*vy`), never by assigning position from a force law.

```ts
export const PX = 50;
export const velToU     = (v: Vec) => ({ x: v.x * 60 / PX, y: -v.y * 60 / PX });
export const accToForce = (a: Vec, mass: number) => ({ x: mass * a.x * PX * 1e-6, y: -mass * a.y * PX * 1e-6 });
```

mathjs: capture `math.parse` first, then disable `import, createUnit, evaluate, parse, simplify, derivative, resolve, reviver` via `math.import(..., { override: true })`. Walk `SymbolNode`s against a whitelist. `node.compile()` once; `.evaluate(scope)` per tick. Clamp outputs; 60 clamped ticks in a row → `status: 'error'`, the Cat: *"That one got away from you."*

---

## Levels as Excalidraw files

Draw the room at excalidraw.com, save `.excalidraw`, drop it in `game/levels/`. The loader reads elements by convention:

| In the drawing | Becomes |
|---|---|
| Black stroke, any shape | Static solid. Rectangles → `Bodies.rectangle`; lines and freedraw → static `inkBody`. |
| Red hatched fill | No-ink zone |
| Blue fill | Water region |
| Light-blue stroke | Glass: solid, but never counts as an anchor |
| Green stroke | Movable prop (dynamic body) |
| Text `spawn` `exit` `checkpoint` `key` `door` `door:tiny` `guard` `lever` | That piece, at the text's position |
| Orange line | The rabbit's path |
| Everything else | Decoration |

Statics + decoration render once via `exportToCanvas` into a background bitmap. Props and NPCs export as individual sprites.

```ts
type LevelMeta = {                       // game/levels/03.json
  id: string; title: string; art: string;
  ink: number; enchants: number; allowed: Nature[] | 'all';
  brief: string;                         // for the Cat only: the obstacle and the intended solutions
  hints: [string, string, string];       // nudge → direction → answer
};
```

Look: a yellowed book page. Level art in black ink, Tenniel-ish. Player ink in blue fountain pen. Alice and the rabbit are two-frame flipbooks drawn by whoever on the team draws best.

---

## The agent

One loop, client-side, through `cat-proxy` (adds the key, checks a passcode header, rate-limits).

| Tool | Input | Notes |
|---|---|---|
| `make` | `{ drawing_id, name, nature, tags[], line }` | Called for every committed drawing. `line` is what the Cat says. |
| `enchant` | `{ rule }` | Costs a token. Validated as in v2: zod → compile → sample at t = 0, 0.5, 1, 5 → finite. Errors go back as `tool_result is_error`; max 3 turns. |
| `patch_rule` / `remove_rule` | `{ rule_id, … }` | "Faster" is a `vars` patch. Remove refunds the token. |
| `show_guide` | `{ word }` | Ghost strokes to trace. |
| `say` | `{ line, tier? }` | Hints, refusals, banter. |

**Context per call:** PNG crop of the drawing *with its surroundings faded in* (a blob under a ledge is probably a mushroom) · the utterance · room `brief` · allowed natures · tokens and ink left · what's been drawn so far (name, nature) · Alice's size and whether she holds the key · current hint tier.

**System prompt must state:** the nature table with example names · "the player's spoken name always wins" · the Cat's voice rules · "never reveal more than the current hint tier" · the expression space and three worked enchantments (drift, bob, follow Alice) · "Alice, the level and the world are not yours to change — refuse in character."

Small fast model for `make` (it runs on every drawing). Cache the system + tools block.

---

## Evals (`agent/evals.ts`)

Image fixtures are deliberately bad drawings. Run after every prompt change.

| Input | Expect |
|---|---|
| blob + "it's a bouncy mushroom" | `make` · `bouncy` |
| blob + "this is a rock" | `make` · `heavy` — voice beats vision |
| decent balloon, silent | `make` · `floaty` |
| unreadable scribble, silent | `make` · `ink` · line asks what it is |
| rectangle + "eat me" | `grow` |
| squiggle + "drink me" | `shrink` |
| two lines + rungs, silent | `climbable` |
| U-shape + "a little boat" | `buoyant` |
| flower + "a white rose" | `ink` · tags include `rose` |
| blob + "a cake" in Room 1 (not allowed) | `ink` · in-character refusal |
| blob + "a jetpack for Alice" | `ink` · refusal |
| selected boat + "drift to the right" | `enchant` · expression · `vx` or `fx` · number in `vars` |
| selected cloud + "bob up and down" | `enchant` · `y = y0 + A*sin(w*t)` |
| selected + "follow Alice" | `enchant` · references `alice.x` · damped |
| two selected + "tie these together" | `enchant` · constraint · rope |
| selected + "faster" | `patch_rule` · vars only |
| selected + "stop that" | `remove_rule` |
| "enchant it" with 0 tokens | `say` · refusal |
| "make Alice fly" | `say` · refusal |
| "make the door bigger" | `say` · refusal |
| "show me how to draw a ladder" | `show_guide` |
| "I'm stuck" (tier 0) | `say` · tier 1 · does not contain the answer |
| "I'm stuck" again | `say` · tier 2 |
| "just tell me" (tier 2) | `say` · tier 3 · plain answer |
| "who are you?" | `say` · in character · ≤ 15 words |
| "what's that key for?" | `say` · no tier advance |
