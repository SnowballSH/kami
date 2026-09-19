# Paper — Build Plan v2

**HackMIT 2026 · Entertainment track · 24 hours**

Draw a thing. Tell it how to behave — in words, math, or a joke. It obeys, forever, with no AI in the loop.

This replaces `ideation.md`. If the two disagree, this wins. Hand it to teammates and coding agents as-is.

---

## 0. The demo (build backwards from this)

90 seconds. Every feature either serves this script or is on the cut list (§12).

1. "If you think AI is autocomplete, watch." Draw a ball. Say **"bob up and down."** Pause on the *Paper understood:* line. It bobs.
2. Hang a second ball from a drawn hook. Type **`F = -kx`**. It oscillates. Turn the knob (or type "stiffer") — frequency changes live.
3. Pre-drawn lion. **"Sneeze every few seconds and get a little smaller each time."**
4. Box a region. **"Gravity is sideways here. And it's always snowing."**
5. **Hand the judge the keyboard.** Whatever they type compiles, or Paper says plainly what it did instead.
6. Press **Play**. Roll the ball down a drawn track, through the sideways-gravity zone, into the finish flag → confetti + sound.
7. Close: "Each of those is a small program Claude wrote once. No AI has run since."

---

## 1. Locked decisions

Changes from v1 are marked ⚠. Don't reopen these during the build.

| # | Decision |
|---|---|
| 1 | **LLM compiles once; a deterministic client loop runs forever.** No LLM call per tick or per trigger. |
| 2 | **Three rule kinds:** `expression` (numbers recomputed every tick), `action` (effects fired by a trigger), `constraint` (handed to Matter once). Never add a fourth. |
| 3 | ⚠ **One simulation, always on.** Matter.js runs in every mode. *Draw* = gravity off, bodies are sensors. *Play* = gravity on, bodies solid, player input. No second integrator, no "two consumers." |
| 4 | ⚠ **Excalidraw is the ink surface only.** Objects render as sprites on our own overlay canvas. Excalidraw never animates anything. |
| 5 | ⚠ **Physics rules write forces, not positions.** `F = -kx` → `fy = -k*(y - y0)`. v1's `position.y = y0 - k*(y0 - y)` multiplies displacement by k every frame and explodes. |
| 6 | ⚠ **Expression space:** world units, **y up**, 1 unit = 50 px, `t` in seconds since the rule started, rest pose injected as `x0, y0`. All conversion lives in `units.ts`. |
| 7 | ⚠ **One input → a list of rules,** each action with a list of effects. "Sneeze *and* shrink" is one call. |
| 8 | ⚠ **Effects can be relative:** `set scale = scale * 0.92`. Same mathjs evaluator as expressions. |
| 9 | ⚠ **Animations are hand-tuned presets** with `intensity` and `duration`. The LLM picks; it never invents keyframe numbers. |
| 10 | ⚠ **The agent is multi-tool with a validate-and-retry loop** (§5). Tool choice is the router for create / edit / delete / props / guide / can't-do. |
| 11 | ⚠ **Movie mode = record and scrub.** Run the sim, buffer transforms per frame, play the buffer. Works for every rule kind. |
| 12 | ⚠ **Persistence = one jsonb doc per world** + an append-only `events` table. No normalized schema. Undo is an in-memory snapshot stack. |
| 13 | ⚠ **The knob writes `rule.vars` directly.** It never goes through the LLM. |
| 14 | Hardware and voice are input devices for the client. The server never knows they exist. |
| 15 | Vite + React + TS (no SSR). Chrome only. |

**Known can't-do — say so in the gloss, offer the nearest thing:** new art ("give it a grumpy face"), time running backwards, real soft bodies (jello → high bounce + wobble anim).

---

## 2. Architecture

```
 Excalidraw (ink, select)      Rule Bar (type / voice)       Cabinet (keys + serial)
        │ promote strokes            │ text                         │
        ▼                            ▼                              │
   store.ts  ◄──── add/patch/remove ─ agent/compile.ts ─► claude-proxy (edge fn, holds key)
   {objects, rules}                  validate → retry
        │                                                           │
        ▼                                                           │
   sim/engine.ts  Matter, fixed 60 Hz ◄── keys, knob → rule.vars ───┘
   sim/rules.ts   expressions · triggers · effects
        │
        ▼
   render/overlay.ts  sprites × (body transform × anim offset), particles, tags, guides
        │
        ▼
   io/db.ts  debounced save of world doc → Supabase; events append
```

```
src/
  units.ts            px↔units, Matter conversions. The only file where a sign flips.
  store.ts            zustand: world doc, selection, undo stack
  sim/engine.ts       Matter setup, fixed-step loop, gravity, Play snapshot/restore, recorder
  sim/rules.ts        compile, scopeFor, write, shouldFire, fire
  sim/anims.ts        presets
  sim/colliders.ts    hull, circle detect, track chains
  render/overlay.ts
  agent/tools.ts      tool schemas + zod
  agent/compile.ts    loop, validation, retry
  agent/evals.ts      regression prompts (§13)
  io/db.ts  io/voice.ts  io/serial.ts
supabase/functions/   claude-proxy/  deepgram-token/
```

Deps: `@excalidraw/excalidraw`, `matter-js@0.20`, `mathjs`, `zustand`, `zod`, `@supabase/supabase-js`. Nothing else without a reason.

---

## 3. Data model

### 3.1 World doc (in memory; saved as one jsonb)

```ts
type World = { id: string; name: string; objects: Obj[]; rules: Rule[] };

type Obj = {
  id: string; name: string; slug: string;      // slug is how expressions refer to it: lion.y
  tags: string[];
  elements: ExcalidrawElement[];               // source ink; sprite is regenerated from this on load
  rest: { x: number; y: number; angle: number };   // units, y up
  m: number;                                   // user-facing mass multiplier, default 1
  bounce: number; friction: number;
  isStatic: boolean; isPlayer: boolean;
  color?: string;                              // tint override
};

type Target = 'x'|'y'|'angle'|'scale'|'opacity'|'vx'|'vy'|'fx'|'fy'     // object
            | 'gx'|'gy'|'time_scale';                                     // region / world

type Rule = {
  id: string; source_text: string; explanation: string;
  status: 'active'|'paused'|'error'; version: number;
  scope: { type:'object'; ids:string[] } | { type:'pair'; ids:[string,string] }
       | { type:'region'; rect:{x:number;y:number;w:number;h:number} } | { type:'world' };
  vars: Record<string, number>;                // tunable constants — what the knob grabs
} & (
  | { kind:'expression'; assign: { target: Target; expr: string }[] }
  | { kind:'action'; trigger: Trigger; effects: Effect[] }
  | { kind:'constraint'; spec: { type:'rope'|'spring'|'pin'; length?: number; stiffness?: number; damping?: number } }
);

type Trigger =
  | { type:'once' } | { type:'always' }        // always = continuous while active (snow)
  | { type:'interval'; ms: number }            // floor 250
  | { type:'at'; ms: number }                  // ms since Play/Record started — movie beats
  | { type:'click' } | { type:'collision' }
  | { type:'near'; of:'cursor'|string; distance: number };   // fires on ENTER, not every tick

type Effect =
  | { type:'anim'; preset: AnimPreset; intensity: number; duration_ms: number }
  | { type:'set'; target: Target; expr: string }             // may be relative
  | { type:'color'; value: string | 'swap' }                 // 'swap' needs scope pair
  | { type:'particles'; particle:'snow'|'rain'|'confetti'|'sparks'|'hearts'; rate: number }
  | { type:'sound'; sound:'sneeze'|'honk'|'boing'|'pop'|'squeak'|'ding' };

type AnimPreset = 'sneeze'|'flinch'|'hop'|'shiver'|'spin'|'wobble'|'squash'|'nod'|'shake'|'flip'|'pulse'|'droop';
```

Runtime state (`lastFired`, `fired`, `wasNear`, compiled code, Matter constraint handle) lives in a `Map<ruleId, RuntimeState>` — **never on the rule**, so it never reaches the DB.

**One writer per (object, target).** A new rule on a target an older rule already writes pauses the old one, and the gloss says so.

### 3.2 Supabase

```sql
create table worlds (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null,                 -- anonymous id from localStorage
  name text,
  doc jsonb not null default '{}',
  is_public boolean default false,
  forked_from uuid references worlds(id) on delete set null,
  updated_at timestamptz default now()
);
create table events (
  seq bigserial primary key,           -- ordered; gaps are fine
  world_id uuid references worlds(id) on delete cascade,
  actor text not null,                 -- 'user' | 'paper' | 'hardware'
  type text not null,                  -- rule_added | rule_patched | rule_removed | object_created | mode_changed
  summary text not null,               -- "lion sneezes every 4s, shrinking 8% each time"
  payload jsonb default '{}',
  created_at timestamptz default now()
);
create index on events (world_id, seq);
```

- Save = debounced (1 s) upsert of `doc`. Events are fire-and-forget inserts; no transaction needed.
- `events` has exactly one job: the last 10 summaries go into agent context. No replay player, no rolling summaries.
- Undo = push a deep copy of `{objects, rules}` before every mutation; Cmd-Z pops.
- "Your creations" = `worlds where owner = me`. Import an object = copy the `Obj` and its object-scoped rules into the current doc.
- Publish = `is_public = true`. Fork = copy the row with `forked_from`. A gallery is a `select`.
- RLS is off. Accept it. Keep no secrets in the DB.

---

## 4. Engine

### 4.1 Units (verified against matter-js 0.20)

```ts
export const PX = 50;                                            // px per unit
export const toU  = (p: Vec) => ({ x: p.x / PX, y: -p.y / PX });
export const toPx = (u: Vec) => ({ x: u.x * PX, y: -u.y * PX });
export const velToU      = (v: Vec) => ({ x: v.x * 60 / PX, y: -v.y * 60 / PX });  // Body.getVelocity → units/s
export const velToMatter = (v: Vec) => ({ x: v.x * PX / 60, y: -v.y * PX / 60 });
// a = acceleration in units/s². Matter integrates force/mass in px/ms².
export const accToForce = (a: Vec, matterMass: number) =>
  ({ x: matterMass * a.x * PX * 1e-6, y: -matterMass * a.y * PX * 1e-6 });
```

`fx, fy` from an expression are forces on a body of mass `obj.m` (default 1), so `a = f / obj.m`. Drawing size never changes a spring's frequency. Set Matter mass to `baseMass * obj.m` so collisions feel heavier too.

Checked by running it: constant `a = 10` for 1 s → 5.08 units travelled, 10.0 units/s. Spring `k = 20, m = 1` → period 1.40 s (theory 1.405).

### 4.2 Loop

Fixed step: accumulate real time, call `Engine.update(engine, 1000/60)` per step. `engine.gravity.scale = 0` always — we apply gravity ourselves so it can vary by region.

```ts
Events.on(engine, 'beforeUpdate', () => {
  for (const b of dynamicBodies) {
    if (isKinematic(b)) continue;
    const g = gravityAt(b);                       // innermost region rule → world rule → mode default
    Body.applyForce(b, b.position, accToForce(g, b.mass));
    b.timeScale = timeScaleAt(b);                 // per-region slow-mo is native to Matter
  }
  for (const r of activeRules) {
    const rt = runtime.get(r.id)!;
    for (const o of targetsOf(r)) {               // region scope → objects whose center is inside rect
      if (r.kind === 'expression') {
        const s = scopeFor(o, r, rt);
        for (const a of rt.compiled) write(o, a.target, clamp(a.code.evaluate(s)));
      } else if (r.kind === 'action' && shouldFire(r, o, rt)) fire(r, o, rt);
    }
  }
});
Events.on(engine, 'collisionStart', e => { /* match pairs against scope.ids → fire */ });
```

Mode default gravity: Draw `(0, 0)`, Play `(0, -20)` — tuned for feel, not realism. World/region rules assigning `gx`/`gy` override it.

**`scopeFor`** injects: `t, dt, x, y, vx, vy, angle, scale, x0, y0, m`, cursor `mx, my, dcur`, unit vector away from cursor `ax, ay`, every other object by slug (`lion.x, lion.y, lion.vx, lion.vy, lion.scale`), then `...rule.vars`.

**`write`:**

| Target | Does |
|---|---|
| `fx`, `fy` | `applyForce(accToForce(f / o.m))` |
| `vx`, `vy` | `Body.setVelocity` |
| `x`, `y` | Object becomes **kinematic**: no gravity, not pushed, pushes others. Set velocity to `(target − current) / dt` so things it hits get momentum. |
| `angle` | `Body.setAngle` |
| `scale` | Render prop; `Body.scale` the collider when it drifts > 10% |
| `opacity` | Render prop |
| `gx`, `gy`, `time_scale` | Stored on the rule's runtime; read by `gravityAt` / `timeScaleAt` |

**Guardrails:** clamp every result to ±1e4. 60 consecutive clamped ticks → `status: 'error'`, gloss "this blew up — paused." `evaluate` throws → same. Interval floor 250 ms. `near` and `collision` are edge-triggered with a 300 ms cooldown. Max 300 particles per emitter. **`R` resets every object to rest pose and restarts every rule's `t`** — you will press it constantly on stage.

### 4.3 mathjs — compile once, locked down

```ts
const math = create(all);
const parse = math.parse;                          // capture BEFORE the override
const no = () => { throw new Error('disabled'); };
math.import({ import: no, createUnit: no, evaluate: no, parse: no,
              simplify: no, derivative: no, resolve: no, reviver: no }, { override: true });

export function compileExpr(src: string, allowed: Set<string>) {
  const node = parse(src);
  node.traverse((n, _p, parent) => {
    if (n.isSymbolNode && !(parent?.isFunctionNode && parent.fn === n) && !allowed.has(n.name))
      throw new Error(`unknown variable "${n.name}"`);
  });
  return node.compile();                           // .evaluate(scope) per tick — never re-parse
}
```

Checked: captured `parse` still works after the override, `import(...)` inside an expression throws, `lion.y` and `dcur < 3 ? k*ax : 0` both evaluate.

### 4.4 Constraints

`Constraint.create({ bodyA, bodyB, length: px, stiffness, damping })`. rope = stiffness 0.9, length = current distance (behaves like a rod — fine). spring = stiffness 0.02–0.1, damping 0.05. pin = one body to a fixed world point. Anchor at centroids. Draw a wobbly line between anchors every frame. Patching mutates the live Matter constraint in place, so the knob works on `stiffness` and `length`.

---

## 5. The agent

### 5.1 Tools

| Tool | Input | Use |
|---|---|---|
| `add_rules` | `{ rules: Rule[] }` (no id/status/version) | Any new behavior. Several rules per call is normal. |
| `patch_rule` | `{ rule_id, vars?, assign?, trigger?, effects?, spec?, explanation }` | "stiffer", "sneeze more often". `kind` never changes — remove and add instead. |
| `remove_rule` | `{ rule_id }` | "stop sneezing" |
| `set_object` | `{ object_id, name?, m?, bounce?, friction?, isStatic?, isPlayer? }` | "heavier", "this is the ground", "this is the player" |
| `draw_guide` | `{ word }` | "help me draw a lion" |
| `say` | `{ text }` | Can't do it, or did the nearest thing. One sentence, no apology. |

### 5.2 Loop (runs on the client)

```
submit(text):
  ctx = { objects: [{id, name, slug, tags, bbox}], selected_ids, selected_region,
          rules touching selected/nearby objects: [{id, source_text, compact json}],
          last 10 event summaries }
  repeat, max 3 turns:
    resp = claude-proxy(system, tools, messages)
    for each tool_use:
      zod-parse → compileExpr every expr against the allowed-symbol set
      → evaluate at t = 0, 0.5, 1, 5 with the target's live scope → must be finite
      → ids must resolve; pair/constraint needs exactly two
      ok   → apply to store, log event, tool_result "ok"
      fail → tool_result is_error with the exact message      ← the model fixes its own mistake
    stop when nothing errored
  show explanations as "Paper understood: …", pin a tag on each target
```

`claude-proxy` is a thin edge function: adds the API key, checks a shared passcode header, rate-limits per IP. Prompts and the loop stay client-side so iterating never needs a redeploy.

Models: a fast small model for compile; move up a tier only if evals (§13) say so. A vision-capable model for the interpreter. Cache the system prompt and tool block. Use strict tool schemas if available; zod validates regardless.

### 5.3 System prompt must state

- The expression space from §1 decision 6, verbatim, with worked examples:
  - "bob" → `y = y0 + A*sin(w*t)`, vars `{A: 1.5, w: 3}`
  - `F = -kx` → `fy = -k*(y - y0) - c*vy`, vars `{k: 20, c: 0.3}`
  - "scared of the cursor" → `fx = dcur < r ? s*ax - c*vx : -c*vx` (same for `fy`), vars `{r: 4, s: 60, c: 2}`
  - "follows the lion" → `fx = k*(lion.x - x) - c*vx`
  - "sideways gravity here" → region scope, `gx = 20`, `gy = 0`
  - "sneeze every few seconds, smaller each time" → interval 4000; effects `anim sneeze`, `sound sneeze`, `set scale = max(0.3, scale*0.92)`
- **Every number worth tuning goes in `vars`,** never inline. That is what makes "stiffer" a patch and the knob possible.
- Add damping to any spring-like force unless the user asks for perpetual motion.
- Prefer `patch_rule` when an existing rule on the target already covers the request.
- If it can't be done, do the nearest thing and say so. Never silently approximate.

### 5.4 Object interpreter

"Make it real" button on selected strokes → PNG crop → one vision call with a tool returning `{ name, tags, isStatic, bounce }`. The name is editable inline — that's the stage-side override.

---

## 6. Rendering and the Excalidraw boundary

**Promote** (selected elements → object):

1. `exportToCanvas({ elements, appState: { exportBackground: false }, exportPadding: 0 })` at 2× → sprite bitmap.
2. Absolute points = `el.x + p[0], el.y + p[1]` for every freedraw point (sample shapes' outlines) → collider (§7).
3. Store `spriteOffset = bboxCenter − bodyCentroid`. Skip this and every sprite is visibly off its collider.
4. Mark source elements `isDeleted: true` via `updateScene`. Keep them in `obj.elements` to regenerate sprites on load.

**Overlay canvas** sits above Excalidraw with `pointer-events: none`. Each frame: read `scrollX, scrollY, zoom.value` from `getAppState()`, set the transform, then draw sprites (body transform × anim offset), constraint lines, particles, guide strokes, rule tags.

- **Anim presets** are pure functions `(progress, intensity) → { dx, dy, rot, sx, sy, skew }` applied at draw time only. They never touch physics, so a sneezing lion can also bob.
- **Color** = tint an offscreen copy of the sprite with a `source-atop` fill (never on the shared overlay — it would tint everything already drawn). `swap` exchanges two objects' tints.
- **Select / drag objects:** capture-phase `pointerdown` on the container → hit-test sprite bboxes → select and `stopPropagation`. Dragging moves the rest pose.
- **Regions:** draw an Excalidraw rectangle, select it, type. A selected non-object rectangle is the region.
- **Pose flipbook** replaces path morphing: draw a second pose, "loop between poses" → swap sprites on an interval.

---

## 7. Play mode

- **Enter:** snapshot every body's state; sensors → solid; default gravity → `(0, -20)`. **Exit:** restore the snapshot. Play never edits the authored world.
- **Colliders:** closed-ish blob → `Vertices.hull` of all points. Hull circularity > 0.85 → `Bodies.circle`, so balls roll. Static open stroke (track, ground) → RDP-simplify (ε = 4 px) → one thin rectangle per segment, ≥ 10 px thick. No `Svg.pathToVertices`, no `poly-decomp`.
- **Player:** the `isPlayer` object. ←/→ apply torque + horizontal force; Space jumps when touching something. A round player rolls like a wheel — Free Rider feel, no vehicle rig.
- **Tunneling:** cap speed at 25 px/step, `positionIterations = 10`, thick track.
- **Camera:** overlay goes opaque (paper color) and follows the player. Un-promoted ink is exported once as a background bitmap on enter.
- **Input:** `keydown` / `keyup` only. The cabinet needs nothing extra.

---

## 8. Movie mode

Record: while the sim runs, push `[x, y, angle, scale, opacity]` per object per frame into a `Float32Array`, plus markers for color changes, sounds, emitter on/off. Cap 60 s.

Scrub: render frame `i` from the buffer. Nothing is re-simulated. Particles run live while playing and freeze while paused.

`at` triggers are the authored beats: "at 3 seconds the lion flips."

---

## 9. Voice (Deepgram)

Hold-to-talk in the Rule Bar. The `deepgram-token` edge function mints a short-lived token; the client opens the streaming WebSocket (`nova-3`, `interim_results=true`) directly, streams `MediaRecorder` chunks every 250 ms, shows interim text in the Rule Bar, and on release calls the same `submit(text)`. No other code knows voice exists. Confirm the browser WebSocket auth format in Deepgram's docs before hour 10.

---

## 10. Hardware lane (only with a dedicated person)

One **Teensy 4.1**, USB type *Serial + Keyboard + Mouse + Joystick*, does everything:

| Track | What | Browser work |
|---|---|---|
| **A — controller** | Arcade stick + buttons → arrow keys / space over HID | None |
| **B — knob** | Pot read at 20 Hz → `K:0.42\n` over serial | Web Serial → arm a rule's var by clicking its tag → `rule.vars[name] = lerp(min, max, v)` every frame; persist + log one `actor: 'hardware'` event on release |
| **C — LEDs** | WS2812B ring; browser writes `OK` / `ERR` / `MODE:play` | Same serial port |

- No soldering: screw terminals, Dupont, breadboard. USB-powered. No batteries, no wireless.
- Web Serial needs Chrome and a user gesture — connect during setup, not on stage.
- HID types into whatever has focus — click the canvas, go fullscreen, don't tab away.
- 3D prints: bezel and a chunky knob cap. Start the print by hour 6.
- Cut entirely: OLED, RFID.
- Chasing the Arduino prize? Move the knob to an Uno R4 WiFi. Same serial protocol.

---

## 11. Schedule

Lanes: **A** engine/render · **B** agent · **C** UI/persistence · **D** hardware (optional). Three people: C's work splits between A and B, and D doesn't exist. Every block ends at a gate; **if the gate fails, fix it before moving on.**

| Hours | A — engine | B — agent | C — UI / data | D — hardware |
|---|---|---|---|---|
| **0–2** | Excalidraw + overlay tracking pan/zoom; promote strokes → sprite; hardcoded `y0 + sin(3t)` via compiled mathjs | `claude-proxy`; one tool call round-trips; write `evals.ts` prompt list | Vite app deployed; Supabase tables; world doc save/load | Teensy keystrokes showing in a browser tab |
| | **Gate 0:** a sprite made from your own strokes bobs on the overlay while you pan and zoom. | | | |
| **2–6** | Matter always-on; hull bodies; tick loop; expression `write` (all targets); action triggers `once`/`interval`/`click`; 6 anim presets | `add_rules` + `say`; zod → compile → sample-eval → retry loop; system prompt with worked examples | Rule Bar; "Paper understood"; rule tags; object select/drag; "Make it real" + interpreter; `R` reset | Pot → serial → throwaway test page; start bezel print |
| | **Gate 1:** draw → make real → "bob up and down" → "sneeze every few seconds and get smaller." Both live on one object. **Demoable.** | | | |
| **6–10** | Region gravity + time_scale; `collision` / `near` / `always`; particles; constraints; cursor + other-object scope | `patch_rule`, `remove_rule`, `set_object`; active rules in context; evals ≥ 18/24 | Sounds; rule list panel (pause/delete); undo; events logging | Knob ↔ `rule.vars` binding UI (lands once B's `vars` exist) |
| | **Gate 2:** demo steps 1–4 all running at once at 60 fps. "Stiffer" patches in place. | | | |
| **10–14** | Play mode: snapshot/restore, solids, track chains, player, camera | Voice | "Your creations"; import object; remaining 6 presets | Controller drives Play; knob live mid-play |
| | **Gate 3:** draw a track and a ball, press Play, roll to the finish → confetti. **The full demo script works on keyboard alone.** | | | |
| **14–17** | Movie record/scrub + `at` trigger | Guide strokes (§14) | Publish / fork / gallery page | LEDs |
| **17–20** | **Hardening, everyone.** Run evals, fix the top 5 failures. Three strangers type whatever they want — write down what breaks. Perf: 20 objects, 30 rules, 60 fps. Save a known-good fallback world. | | | |
| **20–22** | Rehearse ×5 with a timer. Record a backup video. Write the Devpost. | | | |
| **22–24** | **Freeze.** Bug fixes only. No new features, no refactors. | | | |

Sleep: everyone gets ≥ 3 hours, staggered across hours 12–19. A tired demo loses to a rested one.

---

## 12. Cut list

Cut from the top. Nothing below an item depends on it.

1. Gallery / publish / fork
2. LEDs
3. Guide strokes
4. Movie mode
5. "Your creations" import
6. Pose flipbook
7. Knob — typing "stiffer" still tells the story
8. Voice
9. `constraint` kind
10. Arcade controller → keyboard
11. **Floor — never cut:** Draw mode with `expression` + `action` rules (Gates 1–2) and Play mode (Gate 3).

Already cut, don't resurrect: handwriting OCR, snap-to-shape UI, path morphing, embeddings/pgvector, multiplayer, replay player, rolling summaries, OLED, RFID, normalized schema, `poly-decomp`.

---

## 13. Eval prompts (`agent/evals.ts`)

Run after every prompt or schema change. Pass = validates on the first or second turn **and** matches the expected shape.

| Prompt | Expect |
|---|---|
| `y = 2*sin(3*t)` | expression · `y` |
| bob up and down | expression · `y` · vars `A, w` |
| move in a circle | expression · `x` and `y` |
| `F = -kx` | expression · `fx` or `fy` · damped |
| this pulls back proportional to how far it's stretched | same |
| it's terrified of the cursor | expression · forces using `ax, ay, dcur` |
| the ball follows the lion | expression · references `lion.x` |
| sneeze every few seconds and get a little smaller each time | action · interval · `anim` + `set scale` relative |
| every time I click the balloon it grows and squeaks | action · click · `set scale` relative + `sound` |
| when the ball touches the lion they swap colors | action · pair · collision · `color swap` |
| when the ball hits the flag, confetti and a ding | action · pair · two effects |
| it's always snowing here | action · region · always · particles |
| gravity is sideways here | expression · region · `gx` |
| everything is in slow motion | expression · world · `time_scale` |
| gravity is half as strong up here | expression · region · `gy = -10` |
| tie these together with a rope | constraint · rope |
| this hangs from that, bouncy | constraint · spring |
| make it stiffer *(a spring rule exists)* | `patch_rule` · vars only |
| stop sneezing | `remove_rule` |
| make it heavier | `set_object` · `m` |
| this is the ground | `set_object` · `isStatic` |
| help me draw a lion | `draw_guide` |
| give the cloud a grumpy face | `say` + nearest thing |
| time runs backwards in this corner | `say` + slow-mo |

---

## 14. Sponsors — pick depth over count

| Track | Verdict |
|---|---|
| **Entertainment** | Main track. |
| **Long Lake — Convince a Non-Believer** | Free. It's demo steps 1, 5, 7. Name the skepticism first, let them type, pause on the gloss, say "small program, not an animation" at the end. |
| **Deepgram** | In (§9). Cheap, and it makes the demo better. |
| **Hardware / Arduino** | In only with lane D staffed. |
| **MongoDB** | Optional, one use: Quick, Draw! guide strokes. Load ~200 *recognized* drawings per category (≈ 70k docs — fits the free tier), index on `word`, query by label. No vector search. Drawing format is a list of strokes, each `[xs[], ys[]]` in a 256 box — render at 30% opacity on the overlay. Fallback: Claude returns a simple SVG path. Not chasing the prize? Pre-bake 30 words into a static JSON and skip Mongo. |
| **Devin, Zenni Claw, ASUS** | Out. Read the prize wording first; "Devin for X" may mean *build* an agent, not *use* one. Revisit only if everything through Gate 3 is done by hour 12. |

---

## 15. Risks

| Risk | Answer |
|---|---|
| The judge types something outside the vocabulary | `say` + nearest thing (§5.3). Hour 17–20 stranger test. Example chips under the Rule Bar steer inputs. |
| Compile latency kills the magic | Small model, cached prompt, short context. Animate a pencil-scribble "thinking" tag on the target meanwhile. |
| Overlay drifts from Excalidraw on pan/zoom | Gate 0 exists to kill this in hour 1. |
| Sprite doesn't line up with its collider | `spriteOffset` (§6). Debug key draws collider outlines. |
| Rules fight over one property | One writer per (object, target); newest wins, gloss says so. |
| Fast bodies tunnel through the track | Speed cap, thick segments, more iterations (§7). |
| Someone hammers the public proxy | Passcode header + per-IP rate limit. |
| Hardware dies on stage | The demo runs on keyboard alone. The cabinet is a bonus. |
| Scope creep | §1 is locked and §12 is ordered. New idea → bottom of §12. |

---

*The sentence to keep re-reading: every input compiles once into a small deterministic rule that a cheap client loop runs forever. Equations are one flavor. The point is that anything you say happens — and when it can't, Paper says so.*
