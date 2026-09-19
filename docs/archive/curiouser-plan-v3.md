# Curiouser — Build Plan v3

**HackMIT 2026 · theme: Alice in Wonderland · Entertainment track · 24 hours**

> **Alice can't jump. You can draw.**
> A hand-drawn puzzle-platformer down the rabbit hole. Whatever you draw becomes real ink in the world — and it becomes *whatever you say it is*. The Cheshire Cat listens, talks back, and helps when you're stuck.

Supersedes `docs/archive/paper-plan-v2.md`. Hardware detail lives in `docs/hardware.md`. The v2 engine (compile-once rules, mathjs, Matter) survives as the enchantment system; the freeform sandbox, Play/Movie modes, and gallery do not.

---

## 0. The demo (build backwards from this)

Two minutes, judge holds the mouse — or stands at the cabinet (§8): stick to walk, Etch A Sketch knobs to draw. Same script either way.

1. Riverbank. The White Rabbit runs past, hops a ditch, dives down a hole. Alice walks to the ditch and stops. **"She can't jump. Draw."** Judge scribbles a line. It's solid. She crosses, falls — slowly — down the hole. Title card.
2. A ledge too high, and not enough ink for a ramp. Judge draws a blob. **"Tell it what it is."** Judge holds Space: *"it's a bouncy mushroom."* Cat: *"If you say so."* It turns springy. Alice bounces up.
3. Hall of Doors — the book's own puzzle. Tiny door, key on a tall table. Judge gets stuck, holds Space: *"what do I do?"* The Cat answers aloud, in a riddle. Judge draws a cake, then a bottle.
4. Close: "That drawing was terrible and it didn't matter. In Wonderland a thing is what you say it is. The AI made that literally true — in physics."

---

## 1. Variations considered

| Variation | Drawing essential? | Needs smarts? | Kind to bad drawers? | AI load-bearing? | Verdict |
|---|---|---|---|---|---|
| **A. Crayon-physics** — ink is just solid shapes | Yes | Some | **Yes** — a wobbly line is still a ramp | No | Great floor, but it's a 2007 game |
| **B. Scribblenauts** — draw a noun, AI grants its nature | Yes | **Yes** | No — lives or dies on recognizing bad art | Yes | Best puzzle verbs, worst failure mode |
| **C. Rule-bender** — v2 with goals; speak rules at the world | No — you can just talk | No — "teleport Alice" | Yes | Yes | Cheese machine |
| **D. Falling runner** — draw in real time while falling | Yes | Reflexes, not smarts | **No** | No — latency kills it | Twitchy and cruel |
| **E. Co-op** — one draws, one plays | Yes | Yes | Yes | Depends | A judge is one person |

**Pick: A + B + a budgeted slice of C, stacked in layers.** Each layer works without the one above it, so the layers are also the cut order.

1. **Ink is solid** (A). Zero latency, zero AI. Always works.
2. **Ink is what you say it is** (B, fixed). Vision guesses; **your spoken word overrides it.** Humpty Dumpty's rule — "a word means just what I choose it to mean" — so bad drawing isn't a flaw to forgive, it's canon.
3. **Ink can be enchanted** (C, fenced). Speak a behavior onto *your own drawing*: "it drifts to the right." Costs a token. Never touches Alice or the level.

---

## 2. Locked decisions

| # | Decision |
|---|---|
| 1 | **Alice walks. That's all.** ←/→ (or joystick). No jump, no climb, no swim. Every gap, height and door is a drawing problem. |
| 2 | **Ink is solid the instant you lift the pen.** The AI result arrives 1–2 s later and *upgrades* it. Latency never blocks play. |
| 3 | **Your word beats the vision model.** Said a name → that's what it is. Said nothing and vision is unsure → the Cat asks "and what is *that* supposed to be?" |
| 4 | **Closed set of natures** (§4.2) is what the level design relies on. Free-form names and enchantments are flavor on top. |
| 5 | **You can only enchant what you drew.** Alice changes only through `grow` / `shrink` / `bounce`. No rule may target her, the level, or the world. |
| 6 | **Three budgets make it a puzzle:** ink (stroke length), enchant tokens (0–2 per level), no-ink zones (the Queen's red paint). |
| 7 | **Time crawls while you draw** (`timeScale 0.15` from pen-down to commit). Draw-as-you-play without punishing slow hands. |
| 8 | **No death.** Alice falls slowly (canon) and drifts back to the checkpoint. Erasing refunds ink. `R` restarts the room. |
| 9 | **One AI character.** Every piece of AI feedback — recognition, refusal, hints — is the Cheshire Cat, spoken and captioned. |
| 10 | **Hints are authored, phrasing is live.** Three tiers per level (nudge → direction → answer). The LLM words them around what the player already tried. It never skips a tier. |
| 11 | **Levels are drawn in excalidraw.com** and loaded from `.excalidraw` files by color convention (§6). Free level editor; level art matches player ink. |
| 12 | **No `<Excalidraw>` component in the game.** Player ink = pointer events + `perfect-freehand` on our own canvas. One canvas, one camera, nothing to sync. |
| 13 | Push-to-talk only (Space / cabinet button). Typed fallback always visible. Hackathon halls are loud. |
| 14 | Vite + React + TS. Chrome. Progress in `localStorage`. Supabase only hosts edge functions. |

---

## 3. Architecture

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

## 4. Game design

### 4.1 Drawing, gracefully

| Problem | Answer |
|---|---|
| "I can't draw" | Physics uses the shape, not the quality. Identity comes from your voice. |
| Slow hands | Bullet-time while the pen is down. |
| Multi-stroke things (cap + stem) | One *drawing* = all strokes until the pen has been up 1.0 s (or Enter). |
| Shaky lines | `perfect-freehand` smoothing; RDP simplify (ε = 3 px) for colliders; auto-close if ends are within 15 px. |
| Fear of wasting ink | Erase (Z / right-click) refunds 100%. Ink meter previews cost live as you draw. |
| "What does a mushroom even look like" | "Cat, show me a mushroom" → faint trace-over strokes from Quick, Draw! (§10). |
| Trackpads | Bring a mouse at minimum. A stylus/touchscreen is far better — ask the hardware desk. |

### 4.2 Natures

One nature per drawing. `make` picks it; the preset table does the rest. **Player never sees this word** — they see the ink change tint and hear the Cat.

| Nature | Typical names | Behavior |
|---|---|---|
| `ink` | anything unrecognized | Plain solid. Default. |
| `bouncy` | mushroom, spring, trampoline, jelly | On Alice contact from above: `vy = -13 px/step` (≈ 225 px rise at normal size) |
| `heavy` | anvil, rock, safe | Density × 8 |
| `light` | feather, paper, leaf | Density × 0.2, high air friction |
| `floaty` | balloon, cloud, bubble | Upward force = 1.3 × its weight |
| `buoyant` | boat, raft, log, cork | Floats in water regions; Alice can ride it |
| `slippery` | ice, soap, butter | Friction 0 |
| `sticky` | glue, nail, tape, honey | Becomes static where it lands |
| `climbable` | ladder, vine, rope, stairs | While overlapping it, ↑/↓ move Alice; gravity off for her |
| `grow` | cake, "eat me", biscuit | Consumed on touch → Alice × 2 |
| `shrink` | bottle, "drink me", potion | Consumed on touch → Alice × 0.4 |

Plus free-form `tags` (`rose`, `tart`, `cat`…) that NPCs react to (§4.4). A level may whitelist natures; anything else stays `ink` and the Cat says so ("No cake down here. It's only ink.").

### 4.3 Enchantments (layer 3)

Select one of your drawings (click it), hold Space, describe a behavior. Costs one token; removing it refunds the token. Compiles to a v2 rule (§5.4) scoped to that drawing, or a `constraint` between two of your drawings ("tie the balloon to the basket").

Limits: targets `x y angle vx vy fx fy scale` only; `scale` clamped 0.5–2; acceleration ≤ 40 units/s²; speed ≤ 8 units/s. No rockets.

### 4.4 Rooms

One tall shaft. Each room's exit is a hole in its floor; the camera slides down. The rabbit runs each room first — his path shows where to go, the puzzle is how.

| # | Room | Teaches | Obstacle | Intended | Cheese blocker |
|---|---|---|---|---|---|
| 1 | **Riverbank** | Ink is solid | A ditch | Draw a bridge | — (ink plentiful, only `ink` allowed) |
| 2 | **The Shelves** | Names give natures. *Cat appears.* | Ledge ~200 px up | Bouncy mushroom · ladder · balloon under a plank | Ink covers ~40% of a ramp |
| 3 | **Hall of Doors** | Drawings change Alice; order matters | Tiny door; key on a tall glass table | Cake → grow → take key → bottle → shrink → door. Shrink first and the key is out of reach — exactly as in the book. | Table legs are glass: `climbable`/`sticky` won't hold on them; ink can't reach tabletop height |
| 4 | **Pool of Tears** | Enchantments (1 token) | Water too wide to bridge; tiny Alice sinks | Boat + "it drifts right" · balloon tied to a basket | Water is a no-anchor surface; ink budget < width |
| 5 | **Croquet Ground** | *Where* you draw matters | Card guard patrols the only path; ground is painted red (no ink) | Draw a **white rose** off to the side — he runs to paint it red · a tart lures him too | Only the margins accept ink |
| 6 | **The Trial** | Everything | A wall of cards | Grow enormous and walk through it. "You're nothing but a pack of cards!" | Low ceiling until you drop a `heavy` thing on the lever |
| ∞ | **Mad Tea Party** | — | None | Sandbox: infinite ink and tokens, no exit | Free — it's a level file with no goal |

Ending: Alice wakes on the riverbank. Credits are a montage of **everything the player drew**, labeled with what they called it.

**Must ship: rooms 1–3.** Then 4, 5, 6 in that order.

Every room needs ≥ 2 real solutions and one "I can't believe that worked." If playtesters all solve it the same way, loosen it.

### 4.5 The Cheshire Cat

- **Voice in:** hold Space → Deepgram streaming STT → text. **Voice out:** Deepgram TTS via `cat-voice`; caption shows instantly, audio follows; `speechSynthesis` is the fallback.
- **Persona:** ≤ 15 words a line. Riddling, amused, never cruel, secretly useful.
- **Routing** (decided by the model via tool choice, given these flags):
  - a drawing was committed < 5 s ago → the utterance names or describes it → `make`
  - a drawing is selected → `enchant` / `patch_rule` / `remove_rule`
  - "show me a …" → `show_guide`
  - anything else → `say` (hint or banter)
- **Stuck detector:** no progress for 45 s, or 3 falls → the grin fades in: *"Ask, if you like."* Once per room. He never volunteers the answer.
- **Hint ladder:** each ask advances one tier. Tier 3 is the plain answer. Nobody leaves the booth stuck.

---

## 5. Engine

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

## 6. Levels as Excalidraw files

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

## 7. The agent

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

## 8. Hardware: the Wonderland cabinet

Full wiring, parts status, protocol and firmware: **`docs/hardware.md`**. Summary:

**A self-contained cabinet with no mouse and no keyboard.** Monitor + one panel:

| Control | Part | Does |
|---|---|---|
| **Arcade stick** | EG STARTS joystick | Walks Alice (↑/↓ on `climbable`) |
| **Two knobs** | 2 potentiometers | **Etch A Sketch pen** — left knob X, right knob Y |
| **INK** button | pushbutton (or thumb-joystick click) | Pen down / up |
| **CAT** button | pushbutton (or thumb-joystick click) | Hold to talk to the Cat |
| **LED strip** around the monitor | WS2812B, first 60 px | Live ink meter (blue, drains as you draw) · Cheshire stripes (pink/purple) while the Cat speaks · a pulse falling down the strip when Alice drops to the next room |
| **Grin** | UNO R4's built-in 12×8 LED matrix | The Cat's grin appears when he does |

Why the Etch A Sketch: **nobody can draw well on one.** It turns "I'm bad at drawing" from an apology into the joke, and that *is* the pitch — it is what you say it is. Bullet-time (#7) makes it playable. The mouse stays plugged in and always works; the cabinet is the showpiece, not a dependency.

- **Board: Arduino UNO R4 WiFi** (in hand). 5 V logic drives WS2812B directly, 14-bit ADC for smooth knobs, built-in matrix. The Teensy is not needed.
- **Everything over Web Serial** — one line protocol in, one out. No USB-HID: no focus bugs, works on any board, and the knobs need serial anyway. `io/serial.ts` turns packets into the same input actions the keyboard and mouse produce.
- The game never knows the cabinet exists beyond `io/serial.ts`.

---

## 9. Schedule

Lanes: **A** sim/engine · **B** agent/voice · **C** levels/render/UI · **D** cabinet (`docs/hardware.md`). With three people, C's art goes to whoever draws best and UI splits across A and B. **A failed gate gets fixed before anything else starts.**

| Hours | A — sim | B — Cat | C — levels / render | D |
|---|---|---|---|---|
| **0–2** | Matter loop; pointer → `perfect-freehand` stroke → `inkBody` that falls and lands; Alice walks with ←/→ | `cat-proxy`; send a PNG, get `{name, nature}` back | Vite deployed; `.excalidraw` loader → static colliders + background bitmap; Room 1 drawn | UNO R4: arcade stick + 2 pots → serial lines in a throwaway Web Serial page; LED blink test |
| | **Gate 0:** in a loaded room, draw a line across a gap and walk Alice over it. | | | |
| **2–6** | Anchoring; step-assist; ink meter, erase/refund; bullet-time; commit timer; exit, checkpoint, fall recovery; camera | `make` wired to live drawings; Cat caption bubble; push-to-talk STT; typed fallback | Rooms 1–2 art + meta; HUD; rabbit path-follower; room transitions | `io/serial.ts` → walk + Etch-A-Sketch cursor + INK/CAT in the real game; EMA smoothing |
| | **Gate 1:** Rooms 1 → 2 playable end to end. A scribble named "bouncy mushroom" by voice bounces Alice. **Demoable.** | | | |
| **6–10** | All natures; Alice grow/shrink; key, doors, `door:tiny`; water | Cat TTS; hint ladder + stuck detector; persona tuning; evals ≥ 20/26 | Room 3 art + tuning; Alice/rabbit/Cat sprites; sounds | Strip: ink meter + Cat stripes + fall pulse; matrix grin; start the panel (cardboard or print) |
| | **Gate 2:** Room 3 solvable the canon way, and the Cat talks a stuck player through it by voice. **This is the demo script.** | | | |
| **10–14** | Enchantment rules (§5.4); constraints; riding | `enchant` / `patch` / `remove` + validation loop | Room 4; no-ink zones; card guard + lure; Room 5 | Panel assembled, labeled, cable-tied; monitor mounted; full room cleared on cabinet alone |
| | **Gate 3:** Rooms 1–4 straight through on mouse + keyboard, no dev tools. | | | |
| **14–17** | Room 6 mechanics (lever, card wall) | `show_guide` (§10) | Ending montage; Mad Tea Party; title card; music | Soak test: 30 min continuous play; spare-parts bag; reconnect button |
| **17–20** | **Playtest, everyone.** Five strangers, no coaching, watch silently. Log where they stall, what they name things, how they cheese. Tune ink budgets and hints. Run evals. | | | |
| **20–22** | Rehearse ×5 with a timer. Record a backup video. Devpost. | | | |
| **22–24** | **Freeze.** Bug fixes only. | | | |

Everyone sleeps ≥ 3 hours, staggered across hours 12–19.

---

## 10. Cut list

From the top. Nothing below an item depends on it.

1. Solution gallery ("how others solved this room") — never started unless idle
2. RFID anything · LED strip effects beyond the ink meter
3. Mad Tea Party
4. `show_guide` trace-over strokes
5. Room 6 + ending montage
6. Room 5 (guard, no-ink zones)
7. Enchantments + Room 4 — **all of layer 3**
8. Cat's spoken voice (TTS) → captions only
9. Cabinet → mouse + keyboard (Etch-A-Sketch knobs go first, then the stick)
10. Voice input → typed names
11. **Floor — never cut:** Rooms 1–3, natures, the Cat's hint ladder in text. That is already a complete, themed, AI-load-bearing game.

Guide strokes, if built: Quick, Draw! — ~200 *recognized* drawings per category, looked up by `word`. Format is a list of strokes, each `[xs[], ys[]]` in a 256 box. MongoDB Atlas if you want that prize; otherwise pre-bake ~40 words (mushroom, ladder, cake, bottle, boat, balloon, rose, key…) into a static JSON.

---

## 11. Evals (`agent/evals.ts`)

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

---

## 12. Risks

| Risk | Answer |
|---|---|
| Vision misreads a bad drawing | Your word wins (#3). Surroundings are in the crop. Unsure → the Cat asks. It's a bit, not a bug. |
| Loud hall wrecks STT | Push-to-talk, headset mic, typed fallback always on screen. |
| AI latency | Ink is solid instantly (#2). The upgrade arriving a beat later reads as magic, not lag. |
| A room is too hard | Tier 3 is the answer. Nobody leaves stuck. |
| A room is trivially cheesed | Ink budgets, glass, no-ink zones, nature whitelists — tuned in the hour 17–20 playtest, not guessed. |
| Alice snags on ink lips | Step-assist (§5.2). A debug key draws colliders. |
| Alice shoves drawings off ledges | Two-point anchoring (§5.1). |
| Character controller eats the day | It's 30 lines and already tested. Do not add jumping. |
| Too little content | Rooms 1–3 are the floor; each takes ~2 minutes; a judge sees ~2 rooms. |
| Scope creep | §2 is locked, §10 is ordered. New idea → top of §10. |

---

## 13. Tracks

**Entertainment** — main. **Deepgram** — now both ears and mouth of a character; strongest sponsor fit. **Hardware/Arduino** — the cabinet runs on an Arduino UNO R4 WiFi (§8). **MongoDB** — only via guide strokes. **Long Lake (non-believer)** — optional framing: "it understood a terrible drawing and one spoken sentence, and turned them into working physics." Everything else: out.

---

*Keep re-reading: Alice can't jump. You can draw. It is what you say it is.*
