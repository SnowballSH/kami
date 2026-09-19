# **Paper — Technical Design Doc**

**HackMIT Entertainment Track — 24-hour build**

*An agentic scratchpad for imagination: draw a thing, tell it how to behave — in words, in math, in a joke — and watch the world start following you.*

---

## **1\. Vision & Pitch**

You draw on an infinite canvas. Paper is an **agent that reads whatever you write** — a sentence, a rule, a literal equation, a stage direction, a mood — and compiles it into something the world actually obeys. It is not a physics toy with a chat box bolted on. It's a general **behavior compiler**: anything you can imagine happening to a drawing, you should be able to just say.

That means equations are one register among several, not the point of the app:

* **Physics, if you want it:** write `y(t) = A·sin(ωt)` next to a ball and it bobs. Say "this spring pulls back proportional to how far it's stretched" and Paper infers `F = -kx` and wires it up.  
* **Silly, personality-driven behavior:** "make the lion sneeze every few seconds and flinch a little smaller each time." "This guy is terrified of the cursor and bolts whenever it gets close." "Give the cloud a grumpy face when it's not raining." No math involved — Paper still turns it into a live, looping rule.  
* **World dynamics, not just object dynamics:** "make gravity point sideways over here." "Time runs backwards in this corner." "Everything left of this line is made of jello." "It's always raining on the mountain." These are rules with no single target object — they bend the whole scene, or a region of it.  
* **Reactive, interactive rules:** "when the ball touches the lion, they swap colors." "Every time you click the balloon, it grows and squeaks." Things don't just move on their own — they respond to collisions, clicks, proximity, and each other.  
* **Standing connections:** "these two are tied together with a rope." "This hangs from that." Not a one-off reaction and not a per-tick formula — a structural relationship that just stays true from the moment you say it.  
* **Ambience:** color palettes, weather/particle effects, sound cues, trailing effects — the small sensory stuff that makes a scene feel alive rather than just animated.

You can ask for help ("help me draw a lion") and Paper sketches faint guide strokes for you to trace. Everything you create — and every rule you've taught it — is remembered, so a later drawing can inherit a rule or a running joke from an earlier one. At any point you can flip the same canvas into **play mode** — a FreeRiderHD-style physics game where your custom rules *are* the physics engine — or **movie mode**, where objects act out a timeline like a living picture book, jokes, weather, and all.

The demo arc: *sketch → give it a handful of rules spanning physics, comedy, and world-bending → the world obeys all of them at once → build a scene out of several ruled objects → play it.* The headline moment shouldn't be "I typed an equation" — it should be "I said something ridiculous and it just happened."

**This demo doubles as the pitch for Long Lake's "Convince a Non-Believer" track (see §14.6).** The person who thinks AI is "glorified autocomplete" has usually only seen it answer questions. Paper's core claim is different and easy to say out loud: an LLM call compiles whatever you type into a small, deterministic program that then runs forever with zero further AI involved — that's not a chat response, it's closer to what they'd recognize as real software, just written by talking instead of typing. The surest way to make that land isn't a slicker demo, it's handing the keyboard to the skeptic mid-demo and letting them type the ridiculous thing themselves.

**The arc has a physical half, too.** You build the world on a laptop, then walk over to an arcade cabinet to play it — a real joystick and buttons drive the same Matter.js game your rules just wired up, and a knob on the cabinet lets you grab a live rule variable (a spring constant, a gravity strength) and *turn* it instead of retyping it. This isn't a separate hardware demo bolted on for novelty — it's "create → play" (the arc above) made physically literal: the create half stays entirely on the canvas, the play half gets a body. Full plan in §13.

---

## **2\. Core Insight (read this first)**

Everything below hinges on one architectural decision: **strokes, objects, rules, and worlds are four separate layers**, and "game mode" vs. "movie mode" are just two different consumers of the same object \+ rule data.

| Layer | What it is | Example |
| ----- | ----- | ----- |
| **Stroke** | Raw ink, immutable | The literal pen path the user drew |
| **Object** | Strokes \+ meaning | "lion" — tagged, with physics/personality defaults |
| **Rule** | A live, agent-compiled behavior bound to an object, a pair, a region, or the whole world | `y(t) = A·sin(ωt)` bound to a ball; "sneezes every 4s and shrinks a little" bound to the lion; "gravity is half strength" bound to a region; "swap colors on contact" bound to a pair; "these two are connected by a spring" as a standing constraint |
| **World** | A scene \= object placements \+ active rules \+ mode | "my racetrack," `mode: game`, sideways gravity in the corner, confetti rule on the finish line |

**A rule is described at two different levels, and it's important the schema keeps them separate.** The *pitch* talks about rules in terms of what they mean to the user — "physics," "a personality trait," "ambience," "a reaction" — and that vocabulary should stay rich, because it's what makes the product legible as a scratchpad rather than a physics sandbox. But underneath, every rule compiles down to exactly one of **three mechanisms** (§4, §6): a continuous numeric **expression**, a trigger-fired **action**, or a standing **constraint** handed to the physics engine once and never touched again. "Trait," "ambience," and "reactive" are *patterns* — recognizable combinations of scope \+ mechanism \+ trigger \+ effect — not separate branches the compiler has to choose between. Collapsing the schema to three mechanisms (rather than one per pitch-category) is what keeps the Rule Compiler's actual classification job small and hard to get wrong, even though the set of things a user can say stays wide open.

The **agent's job is compilation, not decoration**: every command, sentence, joke, or equation the user types gets turned into a small, structured, *re-evaluable* rule that a lightweight sim loop runs every tick (or a lightweight event handler fires on trigger) — not a one-off animation that plays once and is forgotten. That's what makes it feel like a scratchpad for imagination rather than a chatbot bolted onto a drawing app: the world's behavior *is* the sum of the rules currently active in it, whatever flavor they are, and the user can add, edit, or delete any of them at any time, in whatever register (numeric, verbal, comedic, atmospheric) is most natural for what they're trying to say.

Crucially, **the compiler doesn't sort inputs into "physics mode" vs. "everything else mode."** A single schema (§7.1) has to comfortably hold `y = 3*sin(2*t)`, "make it sneeze," "gravity is sideways here," and "swap colors when they touch" as siblings, not as one blessed path and three afterthoughts. If the schema makes non-equation rules feel bolted on, the product feels like a physics demo. If it treats them as equally first-class, the product feels like the scratchpad it's pitched as.

A lion object doesn't know whether it's in a game or a movie, and a rule doesn't know either. In **game mode**, per-tick rules feed into Matter.js as forces/positions and triggered rules fire off Matter's collision events. In **movie mode**, the same rules are evaluated along a scrubbable timeline instead of realtime. Same rows in the database, two renderers. This reuse is what makes a 24-hour scope survive contact with reality — you build the object \+ rule model once and get two demo-able modes for free.

---

## **3\. System Architecture**

┌──────────────────────────────────────────────────────────────────────┐

│                          CLIENT (React)                               │

│                                                                        │

│  ┌────────────┐  ┌───────────────┐  ┌─────────────┐  ┌─────────────┐│

│  │  Canvas     │  │  Chat / Rule  │  │  Sim Loop /  │  │ Mode        ││

│  │  (Excalidraw│  │  Bar          │  │  Rule Engine │  │ Renderer    ││

│  │   embed)    │  │  (NL, math,   │  │  (per-tick \+ │  │ \- Draw      ││

│  │             │  │   or a joke)  │  │   triggered  │  │ \- Play (MJS)││

│  │             │  │               │  │   rules)     │  │ \- Movie     ││

│  └─────┬──────┘  └──────┬────────┘  └──────┬───▲───┘  └──────┬──────┘│

│        │ strokes/elements│ NL / equation / event text │      │       │

│        │                  │                            │ keys/│gamepad│

│        │                  │                            │ serial values│

└────────┼──────────────────┼───────────────────┴─────────┼──────┴──────┘

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                              │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                  ┌───────────┴───────────┐

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                  │   ARCADE CABINET (§13) │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                  │  Teensy/ESP32 → Web    │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                  │  Serial \+ HID:         │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                  │  joystick+buttons,     │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                  │  rule-variable knob,   │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                  │  LED/OLED feedback out │

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│                  │                  └────────────────────────┘

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼                  ▼

┌────────────────────────────────────────────────────────────┐

│                    EDGE / SERVER FUNCTIONS                  │

│                                                               │

│  1\. Object Interpreter   (Claude vision \+ tool use)          │

│     sketch region → {name, tags, physics \+ personality defaults} │

│  2\. Rule Compiler        (Claude tool use — THE core agent)  │

│     "make it sneeze" / "F \= \-kx" / "gravity is sideways here"│

│     / "swap colors on contact" / "connect these with a spring"│

│     → {scope, target, kind: expr|action|constraint, trigger, payload} │

│  3\. Guide-Stroke Generator (Claude, low-opacity SVG)          │

└─────────────────────────┬────────────────────────────────────┘

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;▼

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;┌─────────────────┐

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│   Supabase       │◄── read/write objects, rules,

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│  Postgres \+ RT   │    worlds, messages; realtime

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│  \+ Storage       │    sync so rules update live

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└─────────────────┘

&nbsp;

**The cabinet talks to the client, never the server.** It looks like a fourth box in the diagram above, but it's not a fourth architectural layer — it's a second *input device* for the CLIENT box, sitting next to the mouse/keyboard/touch it already has to handle. A joystick press arrives as a browser `keydown`; a knob turn arrives as a Web Serial value that gets fed through the exact same rule-patch path a typed "make it stiffer" would use (§6.4, §13.3). Nothing about the Edge/Server layer, the Rule Compiler, or the Supabase schema needs to know hardware exists — which is exactly the property that keeps hardware an additive, droppable lane instead of a fork of the core build (see the build-order and risk notes in §10–11).

**Voice follows the same rule.** A fourth, even lighter edge function — not pictured above to keep the diagram readable — mints a short-lived Deepgram token on request; the client takes it and opens the audio WebSocket to Deepgram directly, so raw audio never round-trips through our own server, only the token does. What comes back is a transcript, i.e. text, which joins the *exact* funnel typed and handwritten input already use. Full design in §5.5.

**Everything the user types — a command, a sentence describing a behavior, a raw equation, or a stage direction for the whole scene — goes through one funnel: the Rule Compiler.** It doesn't special-case "equation mode" vs. "chat mode" vs. "world mode"; it always tries to produce the same structured output (see §6–7), whatever the register of the input.

**Data flow for a mixed pair of commands typed one after another — "F \= \-kx, spring constant 5" near a spring, then "make it always snow up here" over a region:**

1. User selects the spring object (or types near it — proximity resolves the target), enters text in the Rule Bar. Separately, the user drags a selection box over a region of empty canvas and types the snow rule — no object selection needed, since this one targets a region.  
2. Client sends `{selected_object_ids | selected_region, text, nearby_objects}` to the Rule Compiler for each.

Compiler (Claude with `tools`) recognizes the first as a **parametric physics rule** and the second as a **world/ambience rule**, and returns, respectively:  
&nbsp;{  "scope": "object", "target\_object\_id": "obj\_spring\_1",  "kind": "expression", "governs": "position.y",  "expression": "y0 \- k \* (y0 \- y)", "variables": {"k": 5, "y0": 210},  "explanation": "Hooke's law: restoring force proportional to displacement"}

&nbsp;{  "scope": "region", "target\_region": {"x": 40, "y": 0, "w": 300, "h": 200},  "kind": "action", "trigger": {"type": "tick"},  "effect": {"type": "spawn\_particles", "particle": "snow", "intensity": 0.4},  "explanation": "Snow particles fall continuously inside this region"}

3. Note that "make it snow" and "make it bob" compile to two different `kind`s (`action` vs. `expression`) for a structural reason, not a topical one: one is a continuously-recomputed number, the other is a continuously-reapplied effect with no formula behind it. Two people describing wildly different things — physics vs. ambience — happen to land on the mechanism split cleanly here, which is the whole point of having only two "live" mechanisms instead of one per topic.  
4. Client stores each in the `rules` table and immediately activates it in the client-side **Rule Engine** (a small per-tick evaluator/trigger-checker — see §6.2) — the expression rule uses **mathjs**, the action rule replays its `effect` payload every tick since its `trigger.type` is `"tick"`.  
5. The spring now visibly oscillates and the region now visibly snows, in real time, in *any* mode (freeform, game, or movie) — because the Rule Engine runs identically underneath all three, regardless of which `kind` a rule is.  
6. The compiler's plain-English gloss ("Hooke's law..." / "Snow particles fall continuously...") is shown in a small "Paper understood:" readout so the user can trust or correct what got compiled, and it's logged to `messages` so a follow-up like "make it heavier" or "make it snow harder" can be resolved as an edit to the existing rule rather than a brand new one.

---

## **4\. Data Model (Postgres via Supabase)**

\-- Raw ink, immutable, provenance for undo/redo

create table strokes (

&nbsp;&nbsp;id uuid primary key default gen\_random\_uuid(),

&nbsp;&nbsp;object\_id uuid references objects(id) on delete cascade,

&nbsp;&nbsp;path jsonb not null,          \-- array of {x,y,pressure} OR svg path string

&nbsp;&nbsp;color text default '\#000000',

&nbsp;&nbsp;width numeric default 2,

&nbsp;&nbsp;created\_at timestamptz default now()

);

&nbsp;

\-- The semantic unit: a named "thing" made of strokes

create table objects (

&nbsp;&nbsp;id uuid primary key default gen\_random\_uuid(),

&nbsp;&nbsp;world\_id uuid references worlds(id) on delete set null,

&nbsp;&nbsp;session\_id uuid not null,

&nbsp;&nbsp;name text,                                 \-- "lion", "bridge"

&nbsp;&nbsp;bounding\_box jsonb,                        \-- {x,y,w,h}

&nbsp;&nbsp;svg\_path text,                             \-- flattened path for physics/morph ops

&nbsp;&nbsp;shape\_kind text default 'freeform',        \-- 'freeform' | 'circle' | 'rect' | 'triangle' | 'line' — set by Snap-to-Shape (§5.5); lets game mode (§5.2) skip poly-decomp for shapes that don't need it

&nbsp;&nbsp;semantic\_tags text\[\] default '{}',         \-- \["animal","4-legged"\]

&nbsp;&nbsp;embedding vector(1536),                    \-- optional, pgvector, semantic search

&nbsp;&nbsp;physics\_props jsonb default '{}',          \-- {mass, friction, restitution, is\_static, collision\_shape}

&nbsp;&nbsp;personality\_props jsonb default '{}',      \-- {mood, fears, likes} — soft defaults a "trait" rule can read/write, e.g. {"fears": "cursor"}

&nbsp;&nbsp;behaviors jsonb default '\[\]',              \-- \[{trigger, action, params, keyframes}\] \-- simple, non-parametric actions (spin, grow, sneeze-loop) live here; anything equation-driven lives in \`rules\` instead

&nbsp;&nbsp;created\_at timestamptz default now()

);

&nbsp;

\-- THE agentic layer: a live, re-evaluable rule bound to an object, a pair of objects, a region, or the whole world.

\-- This is what "say a thing and the world follows it" actually is at the data level — deliberately NOT physics-only.

\--

\-- \`kind\` is a MECHANISM, not a topic. There are exactly three, because there are exactly three different

\-- ways a compiled rule can make something happen, and every pitch-level idea (physics, a personality trait,

\-- ambience, a reaction, a standing connection) reduces to one of them:

\--   'expression'  — a formula, re-evaluated every tick, that writes a live number back onto a property.

\--   'action'      — a payload (keyframes, a particle effect, a sound, a property flip) that fires when \`trigger\` says to.

\--                    Fired on \`tick\` it looks like continuous ambience (snow). Fired on \`interval\`/\`proximity\` it looks

\--                    like a personality trait (sneezing, fleeing). Fired on \`collision\`/\`click\` it looks like a reaction

\--                    (swap colors). Same mechanism, three different pitch-level "feels," because the only thing that

\--                    changed is WHEN it fires, not HOW it's stored or run.

\--   'constraint'  — compiled ONCE into a native Matter.js constraint (pin/distance/spring) and handed to the physics

\--                    engine, which then maintains it forever with zero work from our tick loop or trigger dispatcher.

\--                    This is the cheapest and most robust of the three, and it's the right target for anything phrased

\--                    as a standing structural relationship ("these are connected by a rod," "this hangs from that").

create table rules (

&nbsp;&nbsp;id uuid primary key default gen\_random\_uuid(),

&nbsp;&nbsp;world\_id uuid references worlds(id) on delete cascade,

&nbsp;&nbsp;scope text not null,                       \-- 'object' | 'pair' | 'region' | 'world'

&nbsp;&nbsp;target\_object\_id uuid references objects(id) on delete cascade, \-- null unless scope \= 'object'

&nbsp;&nbsp;target\_object\_ids uuid\[\],                  \-- e.g. \[ball\_id, lion\_id\] when scope \= 'pair' ("swap colors on contact", "connect with a spring")

&nbsp;&nbsp;target\_region jsonb,                       \-- {x,y,w,h} if scope \= 'region'

&nbsp;&nbsp;source\_text text not null,                 \-- verbatim user input, whatever register ("F \= \-kx", "make it sneeze", "connect these with a spring")

&nbsp;&nbsp;kind text not null,                        \-- 'expression' | 'action' | 'constraint' — see comment above; this is the compiler's ONLY real classification decision

&nbsp;&nbsp;trigger jsonb default '{"type": "tick"}',  \-- meaningful for 'expression' (almost always tick) and 'action' (tick/interval/timeout/collision/click/proximity); null/ignored for 'constraint', which has no per-tick trigger at all

&nbsp;&nbsp;governs text,                              \-- which property the rule visibly drives, for debug/UI purposes: 'position.y','gravity\_direction','color','scale','weather',... — used by 'expression' always, and by 'action' when its effect sets a property directly

&nbsp;&nbsp;expression text,                           \-- mathjs-evaluable string, e.g. "y0 \- k\*(y0 \- y)" — used only by kind='expression'

&nbsp;&nbsp;variables jsonb default '{}',              \-- {k: 5, y0: 210} — bound scope for the expression, used only by kind='expression'

&nbsp;&nbsp;effect jsonb,                              \-- used only by kind='action': {"type":"keyframes","keyframes":\[...\]} | {"type":"spawn\_particles","particle":"snow","intensity":0.4} | {"type":"swap\_property","property":"color"} | {"type":"play\_sound","sound":"honk"} | {"type":"set\_property","property":"scale","value":1.3}

&nbsp;&nbsp;constraint\_spec jsonb,                     \-- used only by kind='constraint': {"type":"distance"|"pin"|"spring","stiffness":0.6,"length":80,...} — passed almost verbatim to Matter.Constraint.create at compile time

&nbsp;&nbsp;explanation text,                          \-- Claude's plain-English gloss, shown back to the user for trust/debugging

&nbsp;&nbsp;status text default 'active',              \-- 'active' | 'paused' | 'error'

&nbsp;&nbsp;version int default 1,                     \-- bumped on edit, so "make it heavier" / "make it sneeze more" / "make the spring stiffer" patches in place

&nbsp;&nbsp;created\_at timestamptz default now(),

&nbsp;&nbsp;updated\_at timestamptz default now()

);

&nbsp;

\-- A scene: placements \+ mode config

create table worlds (

&nbsp;&nbsp;id uuid primary key default gen\_random\_uuid(),

&nbsp;&nbsp;owner\_session\_id uuid not null,

&nbsp;&nbsp;name text,

&nbsp;&nbsp;mode text default 'freeform',              \-- 'freeform' | 'game' | 'movie'

&nbsp;&nbsp;object\_placements jsonb default '{}',      \-- {object\_id: {x,y,rotation,scale,z}}

&nbsp;&nbsp;physics\_config jsonb default '{"gravity": true}', \-- baseline; can be overridden per-region or per-world by a rule

&nbsp;&nbsp;ambient\_config jsonb default '{}',         \-- baseline palette/weather/time\_scale, overridden live by scope='region'/'world' action rules

&nbsp;&nbsp;hardware\_config jsonb default '{}',        \-- optional, client-only concern (§13): {"knob\_bound\_rule\_id": uuid, "knob\_bound\_field": "variables.k"} — which live rule field the cabinet's potentiometer currently grabs. Purely a UI-state cache; deleting it breaks nothing, it just makes the knob re-bind to nothing until the user picks a target again

&nbsp;&nbsp;created\_at timestamptz default now()

);

&nbsp;

\-- Chat history, scoped to an object or a world (a filtered view onto the events log, kept separate for simple ordering in the chat UI)

create table messages (

&nbsp;&nbsp;id uuid primary key default gen\_random\_uuid(),

&nbsp;&nbsp;object\_id uuid references objects(id) on delete cascade,

&nbsp;&nbsp;world\_id uuid references worlds(id) on delete cascade,

&nbsp;&nbsp;role text check (role in ('user','paper')),

&nbsp;&nbsp;text text not null,

&nbsp;&nbsp;created\_at timestamptz default now()

);

&nbsp;

\-- THE behavior log: append-only, ordered record of everything that happened.

\-- This is Paper's memory. Objects/rules/worlds are a live snapshot; \`events\` is the full history behind it.

create table events (

&nbsp;&nbsp;seq bigserial primary key,                  \-- strict, gap-free ordering — the backbone for replay

&nbsp;&nbsp;world\_id uuid references worlds(id) on delete cascade,

&nbsp;&nbsp;object\_id uuid references objects(id) on delete set null,

&nbsp;&nbsp;rule\_id uuid references rules(id) on delete set null,

&nbsp;&nbsp;actor text not null,                        \-- 'user' | 'paper' | 'system' | 'hardware' (a knob turn or a badge tap on the cabinet, §13 — same shape, different source)

&nbsp;&nbsp;event\_type text not null,                   \-- 'stroke\_added','object\_created','rule\_compiled',

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\-- 'rule\_edited','rule\_paused','rule\_deleted',

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\-- 'mode\_changed','collision','message',

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;\-- 'hardware\_input' (joystick/button press logged for replay fidelity, not required for gameplay itself), ...

&nbsp;&nbsp;payload jsonb not null default '{}',        \-- new state (e.g. the compiled rule, the action params)

&nbsp;&nbsp;prev\_payload jsonb,                         \-- prior state, only set on edits — makes a diff/undo possible

&nbsp;&nbsp;summary text,                               \-- one-line human-readable gloss, e.g. "made the lion sneeze every 4s"

&nbsp;&nbsp;created\_at timestamptz default now()

);

create index events\_world\_seq\_idx on events (world\_id, seq);

&nbsp;

**Why this shape:**

* Splitting `strokes` from `objects` means undo/redo is trivial (strokes are append-only) and one set of strokes can be "promoted" into an object once the interpreter identifies it.  
* `embedding` \+ `semantic_tags` let a later command ("connect this to the tower from before") search past objects without exact string matching — nice-to-have, cut first if time is short.  
* `object_placements` lives on `worlds`, not `objects`, because the same lion can appear in two different worlds at different positions.  
* `shape_kind` defaults to `'freeform'` so nothing changes unless Snap-to-Shape (§5.5) is confident a stroke is a circle/rectangle/triangle/line — it exists purely so game mode (§5.2) can call a native Matter.js constructor instead of `Svg.pathToVertices` \+ `poly-decomp` for shapes that don't need a concave hull at all.  
* `physics_config.gravity`, `ambient_config`, and `mode` are the toggles that turn a `freeform` canvas into a `game` or give it weather/time dynamics — no schema change needed once the object \+ rule model exists.  
* `hardware_config` is deliberately the only column the cabinet gets. A knob turn doesn't need a `kind: 'hardware'` rule or a parallel schema — it resolves to a `rule_id` \+ field path and then goes through the *existing* edit-as-patch path (§6.4) exactly like a typed "make it stiffer" would. The column exists purely so the UI remembers which rule the knob is currently "holding" between renders; nothing downstream of the patch call knows or cares that a knob, rather than a keyboard, produced it.  
* **`rules` is the whole "agentic scratchpad" pitch made concrete, and its `scope`/`kind`/`trigger` columns are deliberately wider than "physics equation" — but `kind` itself is deliberately narrow (three values), because `kind` is the one field the LLM has to get right on every single call.** `scope: 'pair'` exists specifically so "when the ball touches the lion, they swap colors" is a first-class rule, not a special case bolted onto the physics engine — it compiles to `kind: 'action', trigger: {type:'collision'}`. A personality loop like "sneezes every 4s" compiles to the *same* `kind: 'action'`, just with `trigger: {type:'interval'}` instead. World-level dressing like "it's always snowing here" is again `kind: 'action'`, this time with `trigger: {type:'tick'}` so the effect keeps re-applying every frame. The pitch-level variety (trait/ambience/reactive) lives entirely in `trigger` \+ `effect` \+ `scope`; it never has to live in `kind`, which is what keeps the compiler's actual decision small: "is this a number that changes over time (`expression`), a thing that happens at a moment or continuously without a formula (`action`), or a standing physical connection the engine itself should own forever (`constraint`)?" A rule is separate from `objects.behaviors` because rules are *parametric and re-evaluated or re-triggered continuously* (they can reference `t`, an object's own state, another object's state, or a trigger event), while `behaviors` are simpler pre-baked one-shot/looping actions (spin, grow) with no live parameters. `version` exists so an edit ("actually make it stiffer," "make it sneeze more often") mutates the same row instead of stacking duplicate, possibly-conflicting rules on the same object.  
* **`events` is the memory backbone (see §8).** `objects`/`rules`/`worlds` are always just the *current* state — they get overwritten on edit. `events` never does; it's the append-only ledger of how the current state was arrived at, in strict order (`seq`), which is what makes "remember what I did," full-session replay, and undo all the same feature built once instead of three separate ones.

---

## **5\. The Three Modes**

### **5.1 Draw / Freeform mode (build this first)**

* Excalidraw embed (`@excalidraw/excalidraw` React package) as the canvas — gives you pan/zoom/select/undo for free, and its hand-drawn rendering style ("rough.js" under the hood) already matches your aesthetic.  
* On selection \+ a typed command/rule/equation/world-directive, call the Rule Compiler (§7). Selecting *nothing* and dragging a region box, or typing with no selection at all, are both valid — that's what lets `scope: 'region'` and `scope: 'world'` rules exist without forcing every input through an object.  
* Chat renders as a small comic-style "speech line" from cursor to object (an SVG line with a text bubble), fading out after \~4s via a CSS transition — keep it as an overlay layer, not part of the Excalidraw scene, so it never gets exported/saved as ink. If the input compiled to a *rule* rather than a one-shot action, also drop a small persistent tag on the object or region ("∿ y=A·sin(ωt)", "😤 sneezes every 4s", "❄ snowing") so the user can see, at a glance, which objects and regions currently have live rules attached — this doubles as your debug/trust UI, and matters more once rules stop being exclusively equations.  
* Guide-stroke ("help me draw a lion") flow: send the current canvas region (as PNG, via Excalidraw's export or a canvas snapshot) plus the request to Claude; ask it to return an SVG path approximating the requested shape; render that path as a new Excalidraw "freedraw" element at low opacity (`opacity: 30`, `strokeColor: gray`) so the user can trace over it. As the user's real ink appears in the same bounding box, fade/remove the guide layer.  
* **Equations can also be handwritten, not just typed** — same for plain-English rules and world directives. If the user writes or scribbles something on the canvas near an object (an Excalidraw text or freedraw element), treat it the same as a chat message: OCR/read it via a Claude vision call, resolve the nearest object or region by proximity, and feed the recognized text into the same Rule Compiler. This is the "scratchpad" feel — the rule lives on the page next to the thing it governs, exactly like a real notebook with doodles and notes-to-self in the margins.

### **5.2 Game mode (FreeRiderHD-style, now rule-driven)**

* Toggle `worlds.mode = 'game'`.

For every object with `physics_props.is_static = false` (or true, for the track itself), convert its `svg_path` to a Matter.js body:  
&nbsp;Common.setDecomp(require('poly-decomp'));const vertices \= Matter.Svg.pathToVertices(pathEl, 8); // sampleLength=8 balances detail vs. perfconst body \= Matter.Bodies.fromVertices(x, y, \[vertices\], physicsOptsFromProps(obj.physics\_props), true);

* &nbsp;  
* `poly-decomp` is required because most hand-drawn shapes are concave; `fromVertices` will silently fail to a convex hull if decomposition finds nothing — the fallback still works, it's just a rougher collider.  
* **Every active `rules` row for this world is evaluated or trigger-checked once per physics tick** (see §6.2), and there are only three things a rule can be doing, regardless of what it's *about*: a `kind: 'expression', governs: 'gravity'`/`'gravity_direction'` world-or-region-scope rule scales or rotates `engine.world.gravity` every tick; a `kind: 'expression', governs: 'velocity'`/`'position.y'` object-scope rule calls `Body.setVelocity`/`Body.setPosition`, and if `scope: 'region'` it only applies while a body's center is inside `target_region`; a `kind: 'action', trigger: {type:'collision'}, scope: 'pair'` rule listens on `Matter.Events.on(engine, 'collisionStart', ...)` and fires its `effect` (swap colors, play a sound, bounce extra hard) exactly when those two specific bodies touch; the same `kind: 'action'` with `trigger: {type:'interval', ms: 4000}` instead fires a keyframe (sneeze, flinch, shrink-a-bit) on a timer regardless of physics state, and with `trigger: {type:'tick'}` instead just keeps re-applying a particle/palette layer every frame (snow, fog) independent of the physics sim entirely. A `kind: 'constraint'` rule skips the tick loop altogether: it's compiled once into a `Matter.Constraint` (pin/distance/spring) at creation time and the engine itself keeps it satisfied every tick from then on — this is the right target for "these two are connected by a rod" or "this hangs from that," and it's the cheapest of the three mechanisms because our own code never touches it again after compile time. This is what makes "gravity is half as strong up here," "these two swap colors on contact," "it always snows on the mountain," and "these are connected by a spring" all real, live features running in the same loop, off the same three-value `kind` field — not four or five different systems.  
* Render with Matter's canvas renderer or draw your own on top of the Excalidraw-style strokes (recommended: keep the hand-drawn look by rendering the original SVG path each frame, transformed by the body's live `position`/`angle`, rather than Matter's default flat-shaded renderer).  
* The player's own sketched vehicle becomes the literal collision geometry — this is FreeRiderHD's core trick, and it demos extremely well because the audience watches their own drawing physically obey a law of physics *and a joke* they just wrote by hand — e.g. a track where one hill has sideways gravity and the finish line rule triggers confetti and a sound cue on contact.  
* **This is the mode the arcade cabinet (§13) plugs into.** Game mode already needs *some* input scheme (steer/jump); the cabinet just supplies that input from a real joystick and buttons instead of arrow keys, with zero changes to the physics/rule code above — the body still calls `Body.setVelocity`, it just gets told to by a `keydown` that originated from a Teensy instead of a keyboard. The knob is the one genuinely new interaction game mode gains from hardware: bind it to whichever rule's `variables`/`constraint_spec` field the player currently has selected, and a spring constant, a gravity strength, or a rope's stiffness becomes something you turn *while the sim is running*, not something you retype and re-submit.

### **5.3 Movie mode**

* Toggle `worlds.mode = 'movie'`.  
* Each object's `behaviors[]` becomes timeline entries: `[{t: 0, action: "idle"}, {t: 2000, action: "backflip", duration: 1200}]`, and each active `rules` row — `expression`, `action`, or `constraint` alike — is evaluated or trigger-checked at whatever timeline position `t` the scrubber is at (rather than realtime) — same evaluator/trigger logic, different clock source. Trigger-based `action` rules (`collision`, `click`) simply don't fire unless the scrubber passes the moment they're scripted to occur, or unless the user interacts while paused; `constraint` rules just stay satisfied by the (paused or scrubbing) physics state the same way they would in game mode.  
* A simple scrubber/play button steps through world time, and for each active behavior/rule at time `t`, either drives a **Flubber** interpolator between keyframe path states, evaluates the `expression` at that `t` and repositions the object, or renders the `effect` for an ambience/reactive rule (snow density at `t`, a color-swap that "happened" at `t=3000`).  
* No physics engine needed here — it's pure evaluation \+ tweening, so it's cheap and safe to build even under time pressure, and it's the mode where world-dynamics rules (slow-mo, time running backwards, a palette shift at sunset) read most clearly as authored storytelling beats rather than incidental physics.

### **5.4 World Dynamics (cuts across all three modes)**

World-and-region-scope rules are what make Paper feel like it bends reality, not just objects, so they get their own callout even though mechanically they're just `scope: 'region' | 'world'` rows in the same table:

* **Physical:** gravity strength/direction, friction, "bouncier," "everything's made of jello here" (drop each body's Matter.js stiffness/restitution when a soft-body-flavored rule is active in a region).  
* **Temporal:** `time_scale` (slow-mo, fast-forward, "time runs backwards" — negate `dt` for rules and tweens inside the region).  
* **Atmospheric:** weather/particles (rain, snow, confetti, fog — a lightweight canvas particle layer independent of Matter.js), ambient palette/lighting shifts, background color or "always nighttime here."  
* **Sonic:** a rule can carry a `governs: 'sound'` effect that plays a short cue on trigger (sneeze honk, confetti pop, collision boing) via the Web Audio API — cheap, and it does a lot of work for the "silly" feel.

These all reuse the exact same compile → store → evaluate/trigger pipeline as a physics equation; the only thing that differs is what `governs` and `effect` end up meaning at render time.

---

### **5.5 Snap-to-Shape & Voice Input (two more input modalities, cut across all three modes)**

**Snap-to-shape.** The hand-drawn wobble is the whole aesthetic (§1) — snapping should never take it away by default. But two things downstream *do* want a clean primitive underneath the ink: Matter.js collision bodies (§5.2 already flags that concave hand-drawn shapes can silently fall back to a rough convex hull), and any rule that references a shape's own geometry (a spring's rest length, a circle's radius).

* On `pointerup`, run a cheap, deterministic, **client-side-only** geometry fit — no LLM call, same principle as §6.1: don't pay for a network round-trip on something that doesn't need reasoning. Simplify the stroke (Ramer–Douglas–Peucker), then test it against a few shapes: closed \+ low variance in center-to-point distance → circle; closed \+ \~4 roughly right-angled corners → rectangle; closed \+ \~3 corners → triangle; open \+ roughly straight → line. Anything under the confidence threshold is left exactly as drawn.  
* A shape that clears the threshold shows as a low-opacity ghost overlay for \~600ms — the same fade pattern the guide-stroke layer in §5.1 already uses — with a small "Tab to snap" chip. Doing nothing keeps the hand-drawn ink; accepting swaps `objects.svg_path` for the fitted primitive and sets `objects.shape_kind` (§4). The original `strokes` rows are never touched — strokes are immutable ink (§4), so snapping only ever changes the derived object, never the provenance.  
* The payoff isn't just visual: in §5.2's body-creation step, a non-`'freeform'` `shape_kind` skips `Svg.pathToVertices` \+ `poly-decomp` entirely and calls the matching native Matter.js constructor (`Bodies.circle`, `Bodies.rectangle`, a regular polygon for triangle) directly — faster to build, and immune to the concave-hull fallback that section already calls out as a rough edge.

**Voice, via Deepgram.** Voice is a third way into the exact same funnel typed and handwritten input already use (§3, §6.1 — the compiler doesn't sort inputs by register *or* by modality). Nothing downstream of text needs to know a sentence was spoken rather than typed.

* A push-to-talk control in the Rule Bar (and, if §13's cabinet gets built, a natural second binding on one of its physical buttons — hold-to-talk instead of steer, since game mode already owns the joystick). While held, stream mic audio over a WebSocket to Deepgram's real-time endpoint (Nova-3, sub-300ms interim results) and render the interim transcript live in the Rule Bar, in the same spot typed text would go — live captions double as a good "it's listening" beat for a demo.  
* On finalize (release, or an end-of-speech event), the transcript is just text at that point — it goes into the identical `{selected_object_ids | selected_region, text, nearby_objects}` payload §3 already sends to the Rule Compiler. No new backend logic and no schema change: `rules.source_text` stores a spoken command exactly as it stores a typed one today.  
* **Auth stays server-side, same rule as hardware.** The client never holds a real Deepgram key — the Deepgram Token Broker (§3) mints a short-lived, scoped token on request, and the client opens the WebSocket to Deepgram directly from there. Raw audio never touches our own backend, only the token does — the same "talks to the client, never the server" property §13 already gives the cabinet.  
* This pairs well with §14.6's framing: a spoken command that gets compiled and obeyed live reads as far less "scripted" to a skeptical judge than a typed one, and it's a distinct demo beat from Zenni Claw's (§14.5) — one is an agent running a workflow, this is speech going straight into the same compiler a keyboard already feeds.

---

## **6\. The Agentic Rule Engine (the core of "agentic-first")**

This is the feature that turns Paper from "a chatbot for a whiteboard" into "a scratchpad for imagination," so it deserves its own section. It has two halves: **compilation** (LLM, done once per rule, or once per edit) and **evaluation/triggering** (pure logic, done every tick or on event, no LLM in the loop) — and neither half is physics-specific.

### **6.1 Why split it this way**

Calling an LLM every animation frame is too slow and too unpredictable for a live simulation. Instead, the LLM's job is to turn open-ended human input — numeric, verbal, comedic, or atmospheric — into a **small, deterministic, re-runnable rule** exactly once, and then a cheap client-side engine runs it 60 times a second (if it's a tick rule) or checks for its trigger condition (if it's an event rule), with zero network calls either way. This is the same reason compilers exist: you don't want to re-parse and re-interpret source on every instruction, whether that source is `sin(t)` or "sneezes every four seconds."

### **6.2 The evaluator/trigger engine: mathjs for numbers, a small dispatcher for everything else, the physics engine for constraints**

Use **math.js**'s `evaluate(expression, scope)` for `kind: 'expression'` rules. Its expression parser is a real, hand-written interpreter — it never calls JavaScript's `eval` or `new Function` under the hood, which is exactly the property you want when the expression string ultimately originated from an LLM's interpretation of arbitrary user text: you can run it directly in the browser main thread with a bounded, known-safe surface area, no sandboxing infrastructure required.

import { evaluate } from 'mathjs';

&nbsp;

function tickRule(rule, obj, t, dt) {

&nbsp;&nbsp;switch (rule.kind) {

&nbsp;&nbsp;&nbsp;&nbsp;case 'expression': {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;const scope \= { t, dt, x: obj.x, y: obj.y, vx: obj.vx, vy: obj.vy, ...rule.variables };

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;const result \= evaluate(rule.expression, scope);  // e.g. "y0 \- k\*(y0 \- y)"

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;applyToProperty(obj, rule.governs, result);        // writes back to obj.y, obj.gravity\_scale, etc.

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;break;

&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;case 'action':

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;maybeFireTrigger(rule, obj, t, dt);                 // §6.2b — tick/interval/timeout/collision/click/proximity

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;break;

&nbsp;&nbsp;&nbsp;&nbsp;case 'constraint':

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;break;  // nothing to do here — it was compiled once (§6.2c) and Matter's own solver maintains it every tick

&nbsp;&nbsp;}

}

&nbsp;

`expression` and `action` are the only two `kind`s that ever reach this per-tick function — `constraint` rules never do, which is exactly why they're the cheapest of the three (see 6.2c).

**6.2a — `expression`:** as above. One mathjs call per active expression rule per tick.

**6.2b — `action`:** no expression evaluation at all — just a small dispatcher keyed on `rule.trigger.type` that decides *whether* to fire this tick, and a second function that decides *what happens* when it does:

function maybeFireTrigger(rule, obj, t, dt) {

&nbsp;&nbsp;switch (rule.trigger.type) {

&nbsp;&nbsp;&nbsp;&nbsp;case 'tick':       fire(rule, obj); break;                                                  // continuous ambience — snow, fog, a trailing effect

&nbsp;&nbsp;&nbsp;&nbsp;case 'interval':   if ((t \- rule.\_lastFired) \>= rule.trigger.ms) fire(rule, obj); break;     // "sneezes every 4s"

&nbsp;&nbsp;&nbsp;&nbsp;case 'timeout':    if (t \>= rule.trigger.at\_ms && \!rule.\_fired) fire(rule, obj); break;      // one-shot at a scripted moment

&nbsp;&nbsp;&nbsp;&nbsp;case 'collision':  /\* fired from Matter's collisionStart handler, matched by target\_object\_ids \*/ break;

&nbsp;&nbsp;&nbsp;&nbsp;case 'click':      /\* fired from the canvas click handler on this object \*/ break;

&nbsp;&nbsp;&nbsp;&nbsp;case 'proximity':  if (distance(obj, cursorOrOtherTarget) \< rule.trigger.distance) fire(rule, obj); break;

&nbsp;&nbsp;}

}

function fire(rule, obj) {

&nbsp;&nbsp;switch (rule.effect.type) {

&nbsp;&nbsp;&nbsp;&nbsp;case 'keyframes':        playKeyframes(obj, rule.effect.keyframes); break;         // sneeze, flinch, backflip

&nbsp;&nbsp;&nbsp;&nbsp;case 'spawn\_particles':  emitParticles(rule.target\_region, rule.effect); break;    // snow, rain, confetti

&nbsp;&nbsp;&nbsp;&nbsp;case 'play\_sound':       playSound(rule.effect.sound); break;                      // honk, boing, pop

&nbsp;&nbsp;&nbsp;&nbsp;case 'set\_property':     obj\[rule.effect.property\] \= rule.effect.value; break;     // grow, recolor

&nbsp;&nbsp;&nbsp;&nbsp;case 'swap\_property':    swapProperty(rule.target\_object\_ids, rule.effect.property); break; // "swap colors on contact"

&nbsp;&nbsp;}

}

&nbsp;

One trigger type (`when`) crossed with five effect types (`what`) covers every pitch-level example in §1 with no new `kind`.

**6.2c — `constraint`:** compiled once, at rule-creation time, straight into the physics engine, and never revisited by our own loop:

function compileConstraint(rule, bodiesById) {

&nbsp;&nbsp;const \[a, b\] \= rule.target\_object\_ids.map(id \=\> bodiesById\[id\]);

&nbsp;&nbsp;const constraint \= Matter.Constraint.create({ bodyA: a, bodyB: b, ...rule.constraint\_spec });

&nbsp;&nbsp;Matter.World.add(engine.world, constraint);

}

&nbsp;

This only applies in game mode, where Matter.js bodies exist to attach a constraint to; in freeform/movie mode a `constraint` rule is rendered as a static visual connector (a drawn line between the two objects) rather than a physically-solved one, since there's no physics engine running to own it.

Run `tickRule` once per active `expression`/`action` rule, per tick, inside whatever loop is already driving the canvas (`requestAnimationFrame` in freeform/movie mode, `Matter.Events.on(engine, 'beforeUpdate' | 'collisionStart', ...)` in game mode); run `compileConstraint` once at creation/edit time. The point of this whole section: three mechanisms, one loop, one table — there's no separate "physics engine," "comedy engine," and "ambience engine" to keep in sync.

### **6.3 The compiler: turning language, math, or a joke into a rule**

The **Rule Compiler** is a single Claude tool-use call that every user input passes through — see the schema in §7.1. It has to succeed on a wide range of *registers* of input, but it only ever has to make one real decision: which of the three `kind`s is this? Everything else (`trigger`, `effect`/`expression`/`constraint_spec`, `scope`) follows from there. Representative registers:

* **Literal math**, typed or handwritten: `"y(t) = 3*sin(2*t) + 5"` → `kind: 'expression'`, `trigger: {type: 'tick'}`; the model mostly just needs to extract the RHS and normalize variable names to the ones the evaluator scope provides (`t`, `x`, `y`, ...).  
* **Physics description in words**: `"this spring pulls back proportional to how far it's stretched"` → the model has to *know* this means Hooke's law and produce `kind: 'expression', expression: "y0 - k*(y0 - y)"` with a sensible default `k`. This is exactly the kind of "sounds like homework" translation Claude is strong at — lean on it rather than trying to hand-write a parser for informal physics language.  
* **Silly / personality-driven behavior**, no math at all: `"make it sneeze every few seconds"` → `kind: 'action', trigger: {type:'interval', ms: 4000}, effect: {type:'keyframes', keyframes: [...shrink-and-shake pose...]}`. `"this creature is scared of the cursor"` → `kind: 'action', trigger: {type:'proximity', distance: 60}, effect: {type:'keyframes', keyframes: [...flee pose...]}`. The model picks sensible defaults for timing/intensity the same way it picks a spring constant — it doesn't need the user to specify numbers to produce a working, tunable rule.  
* **World dynamics**: `"gravity is sideways over here"` → `scope: 'region', kind: 'expression', governs: 'gravity_direction'`. `"it's always raining on the mountain"` → `scope: 'region', kind: 'action', trigger: {type:'tick'}, effect: {type:'spawn_particles', particle:'rain', intensity: 0.5}`.  
* **Reactive pairs**: `"when the ball touches the lion, they swap colors"` → `scope: 'pair', kind: 'action', trigger: {type:'collision'}, effect: {type:'swap_property', property:'color'}`.  
* **Standing connections**: `"these two are tied together with a rope"` → `scope: 'pair', kind: 'constraint', constraint_spec: {type:'distance', length: 80, stiffness: 1}`. `"this hangs from that, bouncy"` → `constraint_spec: {type:'spring', length: 60, stiffness: 0.3}`.

The compiler should never need to be told up front which register a given input belongs to — resolving that, and collapsing it to one of three `kind`s, is exactly what the tool call is for.

### **6.4 Editing a live rule**

Because `rules` rows are addressable and versioned, a follow-up like *"make it heavier," "make it sneeze more often,"* or *"the connection between them should be stiffer"* should be compiled as a **patch**: the Rule Compiler is given the existing rule's `source_text`, `kind`, and current `expression`/`variables`/`trigger`/`effect`/`constraint_spec` as context, and asked to return updated fields (a new `ms` on the trigger, a new `intensity`/`property` in the effect, a new `stiffness` in the constraint spec, a new `variables` object, or a structurally new `expression`) rather than starting over. `kind` itself should essentially never change on a patch — if it does, treat it as a strong signal the original compile was wrong rather than a normal edit. Bump `version`, keep `id` — this is what makes iterating on a rule feel conversational instead of destructive, whether the rule is a spring constant, a sneeze interval, or a rope's stiffness.

### **6.5 Guardrails (keep these light — this is a hackathon, not a security review)**

* Validate that `expression` only contains identifiers present in `variables` plus the fixed scope (`t, dt, x, y, vx, vy, ...`) before evaluating — reject/ask-for-retry on unknown identifiers rather than silently failing.  
* Clamp evaluator output (e.g., cap velocity/position deltas per tick) so a malformed or wildly divergent expression (`1/t` near `t=0`, runaway exponential growth) can't freeze the tab or send an object flying off-canvas — a simple `Math.max(-CAP, Math.min(CAP, result))` per tick is enough.  
* If `evaluate()` throws (bad syntax slipped through), set `rules.status = 'error'`, skip that rule for that tick, and surface a small non-blocking indicator rather than crashing the sim loop.  
* Cap trigger frequency for `interval`/`proximity` rules (e.g. a hard floor on `ms`, a debounce on proximity re-fires) so an over-eager "sneeze every 10ms" doesn't spam keyframes into visual noise or flood `events`.  
* Validate `constraint_spec` against a small allow-list of `type`s (`distance`/`pin`/`spring`) and sane numeric ranges before calling `Matter.Constraint.create`, and confirm both `target_object_ids` resolve to bodies that actually exist in the current world before compiling — an unresolved id here should surface as `status: 'error'` on the rule, the same as a bad expression, rather than throwing inside the physics setup.  
* The **path-morph / keyframe effect** (§6.6) never touches `expression`, `constraint_spec`, or the trigger dispatcher's timing edge cases at all, so it's unaffected by any of the above — it's worth keeping that effect dead simple precisely so it's a reliable fallback if the expression- or constraint-driven branches have a rough edge on stage.

### **6.6 "Bringing drawings to life" without regenerating art**

For `kind: "action"` rules whose `effect.type` is `"keyframes"` specifically: **do not** try to generate new pixel art or fully re-draw the object per animation frame — too slow, breaks the hand-drawn look, and is an unreliable demo dependency. Instead:

1. **Simple transforms (build this first, \~2 hrs):** rotation, translation, scale, skew, and squash-and-stretch on the whole object's group — covers "make it jump," "make it spin," "make it grow," "make it sneeze," "make it walk across the screen," "make it flinch." Pure CSS/JS keyframes, zero AI needed at animation time, and this small set of primitives is doing almost all of the "silly behavior" work — it doesn't need to be fancier than this to read as funny.  
2. **Path morphing (stretch, \~3-4 hrs):** for actions like "backflip" that need the shape itself to change, use **Flubber**'s `interpolate(fromPath, toPath)` to tween between two path states — either (a) Claude warps specific stroke segments by an offset vector to produce a second "pose" deterministically, or (b) the user draws a second pose themselves and Paper interpolates between the two — a fun mechanic to pitch on its own: *"draw a pose, tell it to loop between poses."*  
3. Keep every keyframe animation loopable/interruptible, stored the same way as before (`behaviors[]` for simple one-shot presets, or a `rules` row with `kind: 'action', effect: {type:'keyframes', ...}` for anything parametric/re-triggerable), so it composes cleanly with movie mode and with other rules active on the same object (a lion can be sneezing on an interval *and* bobbing on a sine expression at the same time — one's an `action` rule, one's an `expression` rule, they govern different properties, and they just both run).

---

## **7\. AI / LLM Integration**

Use the **Claude API with tool use / structured outputs** everywhere you need language turned into something the client can execute — never let the model free-write animation code or arbitrary JS; constrain it to the schema below, and let mathjs / the trigger dispatcher do all the actual runtime work.

### **7.1 Rule Compiler (text/equation/handwriting → rule) — the core agent**

The schema mirrors §4/§6 exactly on purpose: `kind` has three values, and everything else — `trigger`, and then whichever one of `expression`/`effect`/`constraint_spec` matches the chosen `kind` — carries the actual variety. Keeping the enum this small is a deliberate reliability choice: it's the field most likely to get misclassified under time pressure on stage, so it's the field with the fewest ways to be wrong.

// tool schema — one schema handles "make it backflip," "F \= \-kx," "gravity is sideways here,"

// "swap colors on contact," "it's always snowing on the mountain," "tie these together with a rope,"

// and everything between. \`kind\` is the only real classification decision the model has to make.

{

&nbsp;&nbsp;"name": "compile\_rule",

&nbsp;&nbsp;"input\_schema": {

&nbsp;&nbsp;&nbsp;&nbsp;"type": "object",

&nbsp;&nbsp;&nbsp;&nbsp;"properties": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"scope": {"type": "string", "enum": \["object","pair","region","world"\]},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"target\_object\_id": {"type": "string"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"target\_object\_ids": {"type": "array", "items": {"type": "string"}, "description": "used when scope \= 'pair' (a reactive pair, or the two ends of a constraint)"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"target\_region": {"type": "object"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"kind": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": "string",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"enum": \["expression","action","constraint"\],

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"description": "expression: a formula re-evaluated every tick that drives a live number. action: a payload (keyframes/particles/sound/property change) that fires when \`trigger\` says to — this covers physics-free behaviors, ambience, and reactions alike, distinguished only by their trigger. constraint: a standing physical connection (pin/distance/spring) compiled once and owned by the physics engine from then on."

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"trigger": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": "object",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"description": "when this rule runs. Required for 'expression' (almost always tick) and 'action' (tick \= continuous, interval/timeout \= time-based, collision/click/proximity \= event-based). Omit for 'constraint', which has no tick behavior at all.",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"properties": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": {"type": "string", "enum": \["tick","interval","timeout","collision","click","proximity"\]},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"ms": {"type": "integer"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"at\_ms": {"type": "integer"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"distance": {"type": "number"}

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"governs": {"type": "string", "description": "which property this visibly drives, for the debug/UI tag — e.g. position.y, velocity, gravity, gravity\_direction, time\_scale, color, scale"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"expression": {"type": "string", "description": "mathjs-evaluable RHS, e.g. 'y0 \- k\*(y0 \- y)' — used only when kind='expression'"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"variables": {"type": "object", "description": "named constants the expression references, e.g. {k: 5, y0: 210} — used only when kind='expression'"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"effect": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": "object",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"description": "used only when kind='action'",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"properties": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": {"type": "string", "enum": \["keyframes","spawn\_particles","play\_sound","set\_property","swap\_property"\]},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"keyframes": {"type": "object"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"particle": {"type": "string"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"intensity": {"type": "number"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"sound": {"type": "string"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"property": {"type": "string"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"value": {}

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"constraint\_spec": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": "object",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"description": "used only when kind='constraint' — passed nearly verbatim to Matter.Constraint.create",

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"properties": {

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"type": {"type": "string", "enum": \["distance","pin","spring"\]},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"length": {"type": "number"},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"stiffness": {"type": "number"}

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"explanation": {"type": "string", "description": "one plain-English sentence describing what this does, shown back to the user"}

&nbsp;&nbsp;&nbsp;&nbsp;},

&nbsp;&nbsp;&nbsp;&nbsp;"required": \["scope","kind","explanation"\]

&nbsp;&nbsp;}

}

&nbsp;

Send the user's text (typed or OCR'd from handwriting) plus a compact list of current objects (`id, name, tags, bounding_box`) and, when this is an edit, the target rule's current `source_text`/`kind`/`expression`/`variables`/`trigger`/`effect`/`constraint_spec` as context — this is what lets the model resolve "this lion" / "the spring from before" / "make it heavier" / "make it sneeze more" / "the rope should be stiffer" correctly.

### **7.2 Object Interpreter (sketch → semantics)**

Send a cropped PNG of the selected region (Excalidraw can export a selection to a data URL) as an image block, plus a tool schema asking for `{name, tags, suggested_physics, suggested_personality, suggested_behaviors}`. This is also where you decide default `physics_props` (a "bird" object might default to lower mass / higher restitution; a "wall" defaults to `is_static: true`) *and* default `personality_props` (an animal gets a plausible default mood/fear the trait-rule branch can play off of, e.g. a mouse defaults to skittish).

### **7.3 Guide-Stroke Generator (question → sketch help)**

Ask Claude for a rough SVG path (few points, simple curves) representing the requested shape, scaled to fit a given bounding box. Render at low opacity. This does not need to be anatomically perfect — it's a guide, not the final art, so a stylized/simplified path is fine and safer than trying to get pixel-perfect line art out of a language model.

### **7.4 Handwritten Equation & Directive OCR**

When a user writes math, a short instruction, or a scribbled note directly on the canvas, send a cropped image of that region to Claude (vision) and ask it to transcribe it into plain text (or LaTeX-ish, for math) before it ever reaches the Rule Compiler — treat this as a preprocessing step, not a separate schema, so the rest of the pipeline doesn't care whether the input arrived typed, handwritten as math, or handwritten as a sentence.

### **7.5 Follow-up questions / memory**

Store every exchange in `messages`, scoped by `object_id` or `world_id`. When calling the Rule Compiler or Interpreter, include the last N messages *and* the object's currently active `rules` (across every `kind`) as conversation context so Paper can reference earlier creations ("no, the *other* lion," "make it sneeze like the cat did") and edit rather than duplicate existing rules.

**Cost/latency note:** batch the "list of current objects" context down to just name+tags+id (not full paths) to keep prompts small and responses fast. Compilation only has to happen once per new/edited rule — not per tick and not per trigger fire — so a 1–2s round-trip here is fine; it's the mathjs/dispatcher loop in §6.2 that has to be instant, and it is, because it never leaves the browser regardless of which `kind` of rule it's running.

---

## **8\. Memory: The Behavior Log**

"Remember the things done" isn't a nice-to-have bolted onto the schema — it's the same `events` table doing three jobs at once: **giving the agent context, powering replay, and enabling undo.** Design it once, get all three.

### **8.1 Log everything, derive state from it**

Treat `objects`, `rules`, and `worlds` as **materialized views**: whenever the client creates an object, compiles a rule (of any `kind`), edits a rule, pauses/deletes one, or switches a world's mode, it does two writes in the same transaction — update the live row (as already described in §4), *and* append a row to `events` describing what just happened, with `prev_payload` set whenever it's an edit. Nothing about your app logic needs to change for this — it's one extra insert alongside every mutation you're already doing.

async function editRule(ruleId, patch) {

&nbsp;&nbsp;const before \= await getRule(ruleId);

&nbsp;&nbsp;const after \= { ...before, ...patch, version: before.version \+ 1 };

&nbsp;&nbsp;await db.rules.update(ruleId, after);

&nbsp;&nbsp;await db.events.insert({

&nbsp;&nbsp;&nbsp;&nbsp;world\_id: after.world\_id, rule\_id: ruleId, actor: 'paper',

&nbsp;&nbsp;&nbsp;&nbsp;event\_type: 'rule\_edited', payload: after, prev\_payload: before,

&nbsp;&nbsp;&nbsp;&nbsp;summary: \`updated ${before.source\_text} → ${patch.variables ? JSON.stringify(patch.variables) : (patch.effect ? JSON.stringify(patch.effect) : after.expression)}\`

&nbsp;&nbsp;});

}

&nbsp;

### **8.2 Feeding the log back to the agent (so it can actually remember)**

Two tiers, so context stays cheap as a session grows:

* **Recent, verbatim:** pull the last \~15–20 `events` rows for the current world (or fewer, object-scoped) and pass their `summary` strings as compact context to the Rule Compiler — this is what lets "make it heavier," "the other lion," or "make it sneeze more" resolve correctly (§6.4, §7.5).  
* **Older, summarized:** once a world's event count crosses a threshold (e.g. 50), collapse the oldest batch into a single short paragraph with one extra Claude call ("summarize these 50 events into 2–3 sentences a teammate could skim") and store it as a `summary` on the `world` row (or a dedicated `world_summaries` row keyed by a `seq` cutoff). Recent-tier events plus this rolling summary is enough context for any follow-up command, without ever sending the full history to the model. This is the same pattern used to keep a long chat log cheap — roll up old entries in batches, don't resend everything every turn.  
* `embedding` on `objects` (already in the schema, §4) covers the third case: "find something like a car I made earlier" — semantic search over object rows, not the log itself.

### **8.3 Replay: turn the log into a feature, not just a debugging tool**

Because `events` is strictly ordered by `seq` and every row carries enough payload to reconstruct a diff, a **replay player** is close to free once the log exists: step `seq` forward from 0, and for each event apply its `payload` to an in-memory scene exactly the way the live client would have. This gives you, almost for free:

* A satisfying "watch your world get built" playback — genuinely nice demo material ("here's the last five minutes, sped up 4x," sneezes, snowstorms, and all).  
* The literal backbone of **movie mode** (§5.3) if you're short on time: movie mode can *be* "replay the `event_type IN ('rule_compiled','event')` subset of this world's log," rather than a separate timeline data structure — a good scope-cut if hours run short.  
* A cheap **undo**: to undo the last mutating event, read its `prev_payload` (or, for a creation event, just delete the row it created) and write one more event (`event_type: 'undo'`) rather than trying to maintain a separate undo stack.

### **8.4 Cross-session memory ("your creations")**

Give each browser a persistent anonymous id (a UUID written to `localStorage` on first load, sent as `session_id`/`owner_session_id` on every write) so a returning user's objects and worlds — and their full `events` history — are still there next time they open the page, with zero auth work needed for a 24-hour build. A simple "Your creations" picker queries `objects where session_id = local_id order by created_at desc` and lets the user drag a past object into a new world, which is exactly the "pull an old drawing into a new scene" pitch from the original brief, now backed by a real log instead of a vague promise.

### **8.5 What NOT to over-build here**

Don't reach for a general event-sourcing framework or a separate message queue — it's one Postgres table, written to synchronously alongside your normal mutations, read back with a plain `order by seq` query. The value in a hackathon is entirely in having *one* append-only source of truth that the agent, the replay UI, and undo all read from — not in the sophistication of the log itself.

---

## **9\. Tech Stack Summary**

| Layer | Choice | Why |
| ----- | ----- | ----- |
| Canvas / drawing | `@excalidraw/excalidraw` (React) | Free hand-drawn rendering, pan/zoom/select, undo — matches your "Excalidraw-like" note exactly |
| Rule evaluation | **math.js** `evaluate(expr, scope)` | Never touches `eval`/`new Function` internally, so LLM-derived expressions can be run directly client-side every tick with no sandboxing infra — this is what makes "write an equation" safe to ship in 24 hours. Only handles `kind: 'expression'` rules — `kind: 'action'` runs through the plain-JS trigger dispatcher in §6.2, and `kind: 'constraint'` runs through Matter's own solver; neither needs any sandboxing since neither evaluates user-authored code |
| Vector animation | **Flubber** (path interpolation) \+ native CSS/JS transforms | MIT-licensed, small, does exactly the shape-morph job GSAP's MorphSVG (paid) would — and covers both physics-driven and comedy-driven keyframes |
| Ambience / particles | **A small custom canvas particle layer** (own code, no dependency needed) | Snow/rain/confetti are \~50 lines of particle-emitter code each; not worth pulling in a physics-particle library for a hackathon, and keeping it separate from Matter.js means ambience rules never risk destabilizing the physics sim |
| Sound | **Web Audio API** (native) | A handful of short preloaded cues (honk, boing, pop) triggered on `reactive`/`trait` fires — zero-dependency, does a lot for the "silly" feel per line of code |
| Physics / game mode | **Matter.js** \+ `poly-decomp` (`Svg.pathToVertices` → `Bodies.fromVertices`) | Battle-tested 2D physics, direct SVG-to-collider pipeline, runs great in-browser; rule engine hooks into `beforeUpdate` and `collisionStart` |
| Backend / DB | **Supabase** (Postgres \+ Realtime \+ Storage) | jsonb columns map directly to the schema above; Realtime channels give you live multi-user sketching for free; ships with `pgvector` if you want semantic object search |
| Shared/gallery store | **MongoDB Atlas** (+ Atlas Vector Search) | Read-mostly, naturally nested published-world snapshots (§14.1) and the Quick, Draw\! reference dataset (§14.2) — a denormalized document shape that would fight the live Postgres schema above |
| Shape fitting | **Custom RDP-simplify \+ corner/circularity heuristic** (own code, no dependency needed) | Snap-to-Shape (§5.5) needs a deterministic, sub-frame fit with zero LLM latency — a hand-rolled \~100-line geometry check is faster and more predictable than pulling in a general shape-recognition library |
| Voice input | **Deepgram** (Nova-3, real-time streaming WebSocket) | Sub-300ms interim transcripts feed the Rule Bar live; the client only ever holds a short-lived token from our own broker function, never a real API key (§5.5) |
| Autonomous engineering | **Devin** (Cognition) | Builds and tests the §14.1 gallery/publish/fork API against real Supabase \+ Atlas infra in parallel with the human team, kept off the Rule Compiler and tick engine (§14.3) |
| AI | **Claude API**, tool use / structured outputs for the Rule Compiler and Object Interpreter, vision for sketch \+ handwritten-equation interpretation | Constrains model output to one compact schema instead of freeform text or generated code you'd have to parse or sandbox unreliably — and it's the same schema whether the input was numeric, verbal, or comedic |
| Hosting | Vercel/Netlify (static client) \+ Supabase (managed backend) | Zero-ops for a 24-hour build |

---

## **10\. Build Order (24-hour plan)**

Ordered so that **stopping at any point still leaves a demoable product**, and so that the demo never reads as "an equation toy" — a non-equation rule earns a checkpoint just as early as the equation one does.

**If a teammate is free to run hardware (§13) as a second, parallel lane**, it never blocks or reorders anything below — it just needs game mode's `keydown` handling to exist before it's pluggable in, and the Rule Bar's edit-as-patch call (§6.4) to exist before the knob has anything to grab. A reasonable parallel schedule, running alongside the software hours below rather than after them:

* **Hours 0–6:** Wire the arcade kit to the Teensy, get HID keyboard events showing up in a browser console tab — doesn't need game mode to exist yet, just needs *a* browser tab.  
* **Hours 6–13:** Wire the potentiometer \+ ESP32/Uno R4, get raw values streaming over Web Serial into a throwaway test page; 3D-print the bezel and knob cap while waiting on filament/print time elsewhere.  
* **Hours 13–17 (matches software's Game Mode slot):** Plug the Teensy controller into the now-real game mode; bind the knob to a real rule's `variables`/`constraint_spec` via §6.4.  
* **Hours 17–22:** LED ambience feedback (Track C); OLED/RFID only if both A and B are solid and demo-tested.  
* **Hours 22–24:** Joins the software team's polish pass — same rule as below: cut anything flaky rather than debug it live.

**Hours 0–2 — Skeleton**

* Excalidraw embedded and rendering, deployed to a public URL.  
* Supabase project created; run the schema above (including `rules`, with its full `kind`/`trigger` columns from the start — retrofitting them later is more expensive than including them now).  
* mathjs wired up with a trivial hardcoded rule (e.g. one object's y-position driven by `sin(t)`) just to prove the tick-loop → evaluator → render path end to end, before any LLM is involved.

**Hours 2–6 — Core magic loop, `action` rules only**

* Object Interpreter: select strokes → Claude vision call → object saved to DB with tags.  
* Rule Compiler, `kind: "action"` branch only, `trigger: {type: "tick"}` (one-shot on creation) covering simple transforms (rotate/scale/translate) applied to the selected Excalidraw element group. Include at least one command whose `effect` isn't a plain transform — e.g. "sneeze" or "flinch" as a small keyframe pose, not just "spin" — so the keyframe path is exercised from the start.  
* Chat bubble / speech-line UI, fading out.  
* **Checkpoint: you can draw something, name it, and tell it to spin/jump/sneeze. This alone is demoable.**

**Hours 6–10 — `expression` rules, plus `action` rules with `scope: 'region'`/`'pair'` (protect this slot — three demo moments, one mechanism split)**

* Extend the Rule Compiler to the `kind: "expression"` branch: typed equation or plain-English physics description → `{expression, variables, governs}`.  
* In the same pass, extend the `kind: "action"` branch already built in Hours 2–6 to two more `trigger` types it hasn't used yet: `{type: "collision"}` on a `scope: 'pair'` rule ("swap colors on contact") and `{type: "tick"}` on a `scope: 'region'` rule with a `spawn_particles` effect ("it's always snowing here"). This is the same dispatcher and roughly the same compiler call as the transform/keyframe work already done — it's new *scope and trigger*, not a new mechanism — so it's cheap to build alongside the expression branch rather than after it, and it's what makes the world itself feel alive rather than just the objects in it.  
* Wire the mathjs tick evaluator *and* the action dispatcher (now handling tick/interval/collision) into the freeform-mode render loop so all of these visibly run at once, on the same or different objects/regions/pairs.  
* "Paper understood: ..." readout showing the compiler's `explanation` next to the object/region.  
* **Checkpoint: type `y = 3*sin(2*t)` next to a drawn ball and watch it bob; tell a region "always snow here" and watch it snow; touch two objects together and watch them swap colors. Three headline demo moments off two `kind`s — don't cut any for the game/movie modes below.**

**Hours 10–13 — Guide strokes \+ path morph \+ first `constraint` rule**

* "Help me draw X" flow with low-opacity guide path.  
* Flubber-based two-pose morph for at least one signature keyframe action ("backflip").  
* Add the `kind: 'constraint'` branch: "connect these two with a rope/spring" → `constraint_spec`, rendered as a static drawn connector in freeform mode (§6.2c) even before game mode exists to physically solve it. Cheapest of the three mechanisms to add — no per-tick code at all — and it demos a fourth distinct "feel" (a standing relationship, not a behavior) for very little build cost.

**Hours 13–17 — Game mode**

* Mode toggle in UI.  
* SVG path → Matter.js body pipeline for objects in the current world.  
* Rule engine hooked into `Matter.Events.on(engine, 'beforeUpdate' | 'collisionStart', ...)`, and `constraint` rules compiled into real `Matter.Constraint`s at this point (§6.2c) so the rope/spring from Hours 10–13 becomes physically solved rather than just drawn. All three `kind`s — expression, action, constraint — now apply live inside the physics sim: this is where "a world that follows your equations" becomes "a game whose physics, jokes, reactions, and connections you just wrote."

**Hours 17–20 — Memory & world persistence**

* Load past objects (and their active rules, of every `kind`) from Supabase into a new world (the "remembers old creations" pitch).  
* Cross-session object list / picker UI ("your creations").  
* Rule editing as a patch (§6.4) — "make it heavier," "make it sneeze more," or "make the rope stiffer" updates `variables`/`trigger`/`constraint_spec` in place.

**Hours 20–22 — Movie mode (if time remains)**

* Timeline data structure \+ scrubber UI.  
* Reuse `rules`/`behaviors[]` evaluated against timeline `t` instead of realtime, across every `kind`.

**Hours 22–24 — Polish & demo script**

* Cut anything flaky. A confident 90-second demo of *sketch → an equation, a joke, and a connection, all at once → the world obeys all three → drop the scene into a physics game* beats a broader but shaky feature set.  
* Pre-draw 2–3 "known good" objects and pre-test 2–3 "known good" rules spanning `expression`/`action`/`constraint` — a sine wave, a sneeze-on-a-timer, a collision color-swap, a region of snow, a spring connecting two shapes — as fallbacks in case live handwriting OCR or novel input misfires on stage.

### **10.1 If time gets tight: unified cut order (software \+ hardware)**

One list, not two. A software stretch feature and a hardware track both cost hours and both add polish on top of a demo that already works without them — rank them together by how much of the headline story survives without each one, not by which lane they happen to live in. Cut from the top down; every item is safe to drop with zero effect on anything below it.

1. **Stretch ideas (§12), in full** — multiplayer, semantic object search, the "remix" button, compound world presets, a shareable replay link. These were never scheduled hours; they simply don't get started if time runs out before them.  
2. **RFID badge-load and OLED readout (hardware stretch, §13.5)** — same tier as \#1: a nice-to-have layered on top of features that already work without it (the cross-session picker, the on-screen "Paper understood" readout).  
3. **Movie mode (§5.3, scheduled Hours 20–22)** — explicitly opportunistic in the schedule above. Freeform \+ game mode alone already carry all three headline demo moments.  
4. **Ambience LEDs (hardware Track C, §13.4)** — a cosmetic echo of rules that are already visibly doing their thing on screen; cutting it loses nothing the audience hasn't already seen.  
5. **Guide-stroke help and handwritten OCR (§5.1, §7.3, §7.4)** — genuinely nice ("draw a lion for me," writing an equation by hand on the canvas) but the core loop is fully demoable with typed-only input on a canvas the user draws unaided.  
6. **Replay-player and rolling-summary polish (§8.3)** — keep the underlying `events` log itself (it's one extra insert per mutation, already built by Hours 2–6, and undo/cross-session load depend on it); cut only the "watch your world get built" playback UI and the batch-summarization call.  
7. **The rule-variable knob (hardware Track B, §13.3)** — the single biggest stage moment lost, but its software equivalent (typing "make it stiffer" into the Rule Bar) already fully works, so the *pitch* survives — only one physical flourish doesn't.  
8. **The `constraint` rule kind (rope/spring, §6.2c, Hours 10–13)** — cut only under real pressure. It's the cheapest of the three mechanisms to build (no per-tick code at all), so it should rarely be the thing that's actually over budget — but if it is, `expression` \+ `action` rules alone still cover two of the three headline moments on their own.  
9. **The arcade controller (hardware Track A, §13.2)** — the last hardware track to cut, and only if it isn't reliably passing keystrokes by roughly Hour 20; fall back to keyboard input for game mode rather than debugging HID enumeration on stage.  
10. **The floor — never cut:** freeform mode's `expression`/`action` rules (Hours 2–10) and game mode itself (Hours 13–17), demoed entirely on keyboard and mouse. Every item above is additive on top of this baseline; if hours run out here, there's no fallback left to reach for, which is exactly why the build order front-loads it.

---

## **11\. Risks & Mitigations**

| Risk | Mitigation |
| ----- | ----- |
| Concave hand-drawn shapes fail `poly-decomp` and collapse to a convex hull | Acceptable fallback — mention it, don't block on perfect colliders; simplify strokes (Douglas-Peucker) before physics conversion to reduce concave noise |
| LLM sketch recognition misidentifies objects live on stage | Keep a "manual name override" text field so a presenter can correct it instantly without breaking flow |
| A user-typed or LLM-derived expression is malformed, diverges, or references undefined variables | Validate identifiers before evaluating (§6.5), clamp per-tick output, catch `evaluate()` exceptions and mark the rule `status: 'error'` instead of crashing the sim loop |
| The Rule Compiler mis-translates an informal description ("bouncier," "sneeze more") into the wrong constant/interval, or misclassifies a rule's `kind` | Always show the `explanation` gloss back to the user immediately so a wrong compile is visible and correctable in one follow-up message, rather than silently wrong. `kind` misclassification specifically is mitigated structurally, not just by prompting: collapsing the schema to three mechanically-distinct `kind`s (§4, §6.2) — "a number that changes," "a thing that happens," "a standing connection" — instead of one `kind` per pitch category gives the model a much smaller, more separable decision to make than a six-or-seven-way topic classification would |
| Rules that read as "physics-free" (silly behavior, ambience, reactions) end up feeling like an afterthought bolted onto the physics engine, undercutting the "not just equations" pitch, even though they now share a `kind` with each other | This is now a build-order and demo-script risk rather than a schema risk, since `action` rules are structurally no more expensive than `expression` rules — give them dedicated checkpoints early (§10, Hours 2–6 and 6–10) and make sure the demo script (§10, Hours 22–24) leads with a mix, not with the equation alone |
| `Matter.Constraint` is attached to a body whose collider collapsed to a rough convex hull (see the `poly-decomp` risk above), so the constraint's anchor point doesn't line up with where the drawing visually is | Anchor constraints to the body's centroid rather than a specific drawn point unless the user's phrasing implies an exact attachment point ("tie it to the lion's tail"); accept a visually-approximate anchor as a known limitation rather than trying to solve precise point-anchoring on hand-drawn concave shapes |
| Ambience effects (snow, confetti) or many `interval`/`proximity` triggers firing at once tank frame rate | Cap concurrent particles per region, cap trigger re-fire frequency (§6.5), and keep the particle layer a simple canvas overlay rather than adding bodies to the Matter.js world |
| Animation/rule-compile latency kills the "magic" feel | Compilation happens once per rule, not per tick or per trigger fire, so latency only matters at creation/edit time; cache resolved `behaviors[]`/`rules` so repeat or replayed commands are instant; keep AI context payloads small |
| Excalidraw SSR/mount issues | Render it client-side only behind a mount check (`useEffect`), as its own docs require |
| Scope creep across three modes, three rule `kind`s, and multiple trigger/effect combinations | Follow the build order strictly — the rule engine is one evaluator/dispatcher shared by every mode and every `kind`; game and movie modes, and every rule flavor, are additive consumers of the same `objects`/`rules` tables, don't let any of them fork the data model, and resist adding a fourth `kind` even for a plausible-sounding new feature — extend `trigger`/`effect`/`constraint_spec` instead |
| Web Serial API (the knob, §13.3) is Chrome/Edge-only and needs a user gesture (`navigator.serial.requestPort()`) before it'll connect | Demo from Chrome, always; put the "connect cabinet" button behind an obvious one-click prompt during setup, well before the audience is watching, rather than trying to auto-connect on page load |
| The arcade cabinet emulates a USB keyboard (§13.2), so if focus lands anywhere but the game canvas (an address bar, a devtools panel), joystick input silently does nothing or types into the wrong field | Click into the canvas once during setup and leave the tab in kiosk/fullscreen mode for the live demo; don't tab away between the create and play halves on stage |
| Soldering, hot glue, and the fume extractor are restricted to a single staff-supervised hot-work bench (per the hardware sheet) — a bottleneck if hardware needs an unplanned solder joint mid-build | Default to the kit's own screw-terminal/JST/Dupont connectors (§13.2, §13.7) so the normal build path never needs the bench at all; if something breaks and does need solder, budget queue time for the bench rather than assuming it's immediately free |
| A knob sweep fires dozens of rule edits per second if unthrottled, flooding `rules.version` bumps and the `events` log | Debounce the serial-to-patch call (§13.3) — render every frame, but only call the §6.4 patch function on a fixed interval (\~250 ms) or on release, exactly like the trigger-frequency cap already specified for `interval`/`proximity` rules in §6.5 |
| Hardware is a second physical thing that can just fail to power on, disconnect, or get bumped off a table mid-demo | Software's create → play demo (§10, Hours 22–24) must work end-to-end on keyboard alone with zero hardware present — the cabinet is a bonus layer on top of a complete demo, never a dependency of one |

---

## **12\. Stretch Ideas (only if core loop is rock solid early)**

* Multiplayer sketching via Supabase Realtime channels — two people drawing into the same world live, each able to add rules (of any kind) the other sees update in real time.  
* A visible "rule list" panel per world — literally a scratchpad sidebar listing every active equation/behavior/world-directive in plain English, grouped by `kind`, that you can tap to toggle on/off — makes the "agentic scratchpad" framing explicit as a UI element, not just a backend concept.  
* Semantic search over past objects via `pgvector` embeddings ("find something like a car," "find the rule where things swap colors").  
* Export a finished "paper world" as a shareable replay link.  
* Let a rule reference *another object's* live state (`obj('lion').y`, `obj('lion').mood`) so users can write coupled systems and coupled jokes — "this ball follows the lion's height," "this cloud rains harder the angrier the lion looks" — directly in the expression/effect scope.  
* A "remix" button: point Paper at an existing rule and ask for a variation ("like the sneeze rule, but a hiccup instead") — reuses the same edit-as-patch machinery from §6.4 but seeded from a *different* object's rule rather than the same one.  
* Compound world presets ("make this a spooky world": desaturated palette \+ fog ambience \+ slow time\_scale \+ a "flee from cursor" trait applied to every creature in the scene) — a single command that fans out into several rules at once, which the existing schema already supports since it's just several `compile_rule` calls sharing one prompt.

---

## **13\. Hardware: The Arcade Cabinet**

**Principle, stated once so nothing below has to re-argue it:** the cabinet is a second *input/output device* for the client, not a new architectural layer, not a new `kind`, and not a fork of the data model. Everything it does either arrives as a `keydown` the browser already knows how to handle, or goes through the exact same rule-patch path (§6.4) a typed edit would use. If a hardware idea can't be phrased that way, cut it — that's the test, not "does it sound cool on stage."

### **13.1 The Create → Play workflow, physically**

This is the same arc as §1 and §10, walked through with a body attached:

1. **Create, at the laptop (freeform mode, §5.1).** Sketch, name objects, compile rules — physics, jokes, world-directives, connections — exactly as built in Hours 0–17. Nothing here changes; hardware has no presence in this half at all.  
2. **Toggle to game mode (§5.2).** The world's objects become Matter.js bodies; every rule is already live.  
3. **Walk to the cabinet.** The joystick and buttons (Track A, §13.2) are now the input device — steer, jump, whatever the sketched vehicle needs — with zero code difference from a keyboard-driven session, because that's literally what they emulate.  
4. **Grab a rule.** Tap the on-canvas rule tag (the "∿"/"😤"/"❄" tags from §5.1) or pick from a small dropdown to "arm" the cabinet's knob against that rule's live-editable field. The UI shows the same binding readout described in §13.3.  
5. **Turn the knob mid-play.** The spring gets stiffer, gravity gets lighter, the rope gets longer — live, while the sim keeps running — via the same patch-in-place mechanism (§6.4) a typed "make it stiffer" would trigger, just sourced from serial instead of the Rule Bar.  
6. **The cabinet's LEDs/OLED (Tracks C, §13.4, and the stretch in §13.5) reflect state back** — a green flash on a successful patch, the current mode's color, the explanation text of whatever was just compiled — so a bystander watching the cabinet, not the laptop, still reads the story.  
7. **Optionally, tap in.** An RFID badge (§13.5, stretch) loads that person's saved worlds (§8.4) before they start playing — the existing cross-session picker, physically triggered.  
8. **Everything above still logs to `events` (§8) exactly as before** — a knob-driven patch is an `actor: 'hardware'` row with the same `rule_edited` shape a typed edit gets, so replay (§8.3) and undo don't need to know or care where an edit came from.

### **13.2 Track A — Arcade controller *(primary — build this first if only one hardware track happens)***

|  |  |
| ----- | ----- |
| **Hardware (from the HackMIT sheet)** | 2-player arcade control kit (joystick \+ pushbuttons); **Teensy 4.1 with pins** as the brain |
| **Firmware** | Teensyduino's `Joystick`/`Keyboard` library — poll the joystick's microswitches and button pins, emit standard USB HID keyboard/gamepad events (arrow keys or WASD for the stick, space/enter for buttons) |
| **Browser-side work** | **None.** The tab's existing `keydown`/`Gamepad API` listeners for game mode don't know or care that the "keyboard" is a Teensy |
| **Wiring** | Screw terminals or quick-connects on the arcade kit — no soldering. If a connection genuinely needs a solder joint, that's the one job routed to the restricted hot-work bench (§11), not this track's normal path |
| **Why first** | Highest demo value (a real cabinet with a joystick reads as "arcade" instantly) for the least engineering risk — it's a USB HID device, which every laptop already knows how to accept |

### **13.3 Track B — Live rule-variable knob *(secondary — best payoff per hour if Track A is done)***

|  |  |
| ----- | ----- |
| **Hardware** | A **potentiometer**; an **Arduino Uno R4 WiFi** or **ESP32-WROOM-32** (either works — R4 WiFi's built-in USB-serial is marginally simpler to wire up for this) |
| **Firmware** | Read the analog pin on a timer (\~20 Hz is plenty), print a smoothed value as a plain line over USB serial |
| **Browser-side work** | **Web Serial API** (Chrome/Edge only — note this in demo logistics, §11) reads the serial stream and maps it to whichever rule field is currently "armed" — `variables.k`, `constraint_spec.stiffness`, whatever the selected rule exposes. Render the position every frame; call the §6.4 patch function debounced (e.g. every 250 ms, or on release) so a knob sweep doesn't spam `rules`/`events` with dozens of versions |
| **UI** | A small persistent readout — "🎛 bound to: spring on `obj_lion_1`, `variables.k`" — mirrors the existing "Paper understood" trust affordance so the binding is never a mystery |
| **Why this one** | It's the hardware idea that actually dramatizes the doc's own thesis (rules are live and re-editable, not one-shot) rather than just being "a controller" — turning a physical dial and watching physics change in real time is the single best stage moment hardware can add |

### **13.4 Track C — Ambience feedback *(nice-to-have, cheap once A or B exists)***

**WS2812B LED strip/ring**, driven by the same microcontroller already running Track A or B (one more digital pin, FastLED library). The browser sends a single short string over the existing serial link on events it's already firing for the on-screen UI — a `rule_compiled` success (green flash), `status: 'error'` (red flash), a mode change (a color per mode — draw/game/movie), an active ambience rule (a slow palette pulse for snow/fog). This is not a new event pathway; it's the same `events` the app already produces, echoed to one more output device.

### **13.5 Stretch — OLED readout \+ RFID badge load *(cut first if hours run short, per §11)***

* **SSD1306 OLED** on the same microcontroller, showing the latest `explanation` string over serial — lets someone standing at the cabinet read what Paper just understood without looking at a laptop screen.  
* **RC522 RFID reader** \+ a card per teammate: a tap sends a UID over serial, the browser resolves it to a `session_id` and loads that person's "your creations" list (§8.4) — a physical spin on a picker that already exists, not a new backend feature.

Both terminate in the browser tab exactly like the tracks above; neither touches Supabase directly.

### **13.6 3D-printed parts**

* A cabinet **bezel/marquee** framing the joystick and buttons — turns a breadboard rig into something that reads as a cabinet from across the room, and doubles as a logo card for photos and judging  
* A chunky, grippable **knob cap** for the potentiometer — sells the "turning a real dial" moment visually before anyone's close enough to see the screen  
* Small **mounting brackets** for the OLED and LED strip so wiring stays hidden behind the bezel  
* Optional: a low **base plate** so the panel doesn't slide around on a demo table

### **13.7 What NOT to build here**

No custom PCB. No soldering beyond what the arcade kit's own connectors require (most of this parts list is screw-terminal/JST/Dupont/breadboard-friendly by design — see the hot-work-bench note in §11). No wireless link for the controller — USB HID over a cable is far more reliable on noisy conference wifi than adding BLE would be. And no routing hardware input through Supabase/Realtime on its way to the game — it terminates in the browser tab exactly like a keypress does, which is the one guarantee that keeps the cabinet working even if the backend hiccups mid-demo.

### **13.8 Hardware pull list**

Everything below is named to match the HackMIT hardware sheet exactly, grouped by which track it belongs to, so whoever goes to the hardware desk can grab in one pass. Quantities assume one cabinet.

**Track A — arcade controller (grab this first)**

* \[ \] 2-player arcade control kit (joystick \+ pushbuttons) — ×1  
* \[ \] Teensy 4.1 with pins — ×1  
* \[ \] Male-female and female-female jumper wire kits — enough to run from the kit's connectors to the Teensy's pins  
* \[ \] Wire strippers, cutters, and crimping multi-tools — tool, not consumed, but grab it anyway in case the kit's leads need trimming

**Track B — live rule-variable knob**

* \[ \] Potentiometers — ×1 (grab 2 if you want a spare; they're small and easy to lose)  
* \[ \] Arduino Uno R4 WiFi *or* ESP32-WROOM-32 / ESP-32S development board — ×1 (pick one, don't grab both)  
* \[ \] Solderless breadboard (mini is fine) — ×1  
* \[ \] Male-male jumper wire kit — ×1 (on top of the set pulled for Track A)

**Track C — ambience LEDs**

* \[ \] WS2812B addressable LED strip or ring — ×1 (a ring is easier to mount behind a small bezel window; a strip reads better run along the top of the cabinet)  
* \[ \] 5 V power supply (micro-USB 2 A is enough for a short run under \~30 LEDs; only grab a barrel-jack supply if going longer) — only needed if not powering the strip off the microcontroller's own 5 V pin

**Stretch — OLED \+ RFID (grab last, only once A and B are working)**

* \[ \] 0.91 in. or 0.96 in. monochrome OLED breakout (SSD1306, I2C) — ×1  
* \[ \] RC522 RFID reader/writer module — ×1  
* \[ \] Check with hardware staff whether blank RFID tags/cards are stocked separately from the reader — the sheet lists the reader module but not loose cards, so confirm before committing to this track

**General / shared across tracks — grab once, use everywhere**

* \[ \] Solderless breadboards (mini \+ full-size) — a couple of spares are cheap insurance  
* \[ \] Break-away header pin strips — in case a board's headers aren't already soldered on  
* \[ \] Heat shrink tubing kit and electrical tape — strain relief on the arcade kit's leads so a yanked cable doesn't kill the demo mid-play  
* \[ \] Cable/zip ties — dressing the cabinet's internal wiring so it survives being carried to the stage  
* \[ \] Digital multimeter — for the "why isn't this reading anything" moment that always happens once

**Explicitly skip pulling:** anything from Batteries/Power (this runs off USB power the whole time — no LiPo packs, no battery packs, nothing restricted), anything from the hot-work bench (soldering iron, fume extractor, hot glue — see §13.7), and anything from Robotics and Motors / Biosignal / Wearables — none of it is in scope here.

### **13.9 If time gets tight**

Hardware doesn't get its own cut order — see **§10.1** for the single, unified list that ranks every software *and* hardware nice-to-have together, top to bottom, by how much of the demo survives without each one. The reason it's not split by lane: a software stretch idea and a hardware track cost the same kind of thing (hours, on top of an already-working demo), so ranking them separately would just hide which one is actually cheaper to lose at any given point in the day. The short version, reading only the hardware rows out of that list: stretch (§13.5) → ambience LEDs (§13.4) → the knob (§13.3) → the controller (§13.2) → keyboard-only. But treat §10.1's ordering as authoritative, since it interleaves those with the software cuts around them rather than assuming hardware is always cheaper (or always more expensive) to drop.

---

## **14\. Sponsor Track Integration**

Everything below is additive to the architecture in §2–§13, not a fork of it. The rule of thumb that kept hardware (§13) from becoming a second architecture applies again here: **nothing in this section is allowed to make the core loop (canvas → Rule Compiler → tick engine) know these tracks exist.** Each one plugs in at a seam the design already has.

### **14.1 Paper Worlds — a platform to share worlds**

The strokes/objects/rules/worlds split (§2) already produces something worth sharing: a `world_id` is a complete, replayable scene. "Publish" just means taking that scene out of one session's private Supabase rows and putting a read-only copy somewhere anyone can browse, search, and fork.

* Extend `worlds` (§4): `is_public boolean default false`, `forked_from uuid references worlds(id)`, `published_at timestamptz`.  
* **Publish** assembles one denormalized snapshot — `{world, objects[], rules[], a short list of the best "explanation" strings}` — and writes it to the Mongo collection described in §14.2. Postgres stays the live-editing store (it's good at that); the snapshot is a read-mostly document, which is a Mongo-shaped problem, not a Postgres one.  
* **Browse/search** reads only from Mongo — a gallery page of published worlds, searchable by tag ("snow," "sneezing," "spring") and, once §14.2's embeddings exist, by meaning ("something like a lion that's afraid of the cursor").  
* **Fork ("remix this world")** re-inserts a snapshot's `objects[]` and `rules[]` back into Postgres under a fresh `world_id`, sets `forked_from`, and drops the hacker straight into freeform/game/movie mode exactly where the original left off. This is only a few lines of code *because* objects/rules/worlds were already three clean layers — forking is just "re-insert this snapshot under a new id," never a special case.  
* This is also the single feature that makes the two other software-adjacent tracks (§14.2, §14.3) legible as more than backend plumbing: a judge can open the gallery, see other teams' worlds, and fork one live.

### **14.2 MongoDB — the gallery store, plus a large dataset for guide-strokes**

Two separate jobs, one Atlas cluster:

* **Gallery store.** §14.1's published-world snapshots live in a `paper_worlds_public` collection, one document per world, with an Atlas Vector Search index over an embedding of the world's `name` \+ object `semantic_tags` \+ rule `explanation` strings. This is the natural data shape for Mongo specifically because it's the opposite access pattern from live editing: read-heavy, rarely mutated, and naturally nested — exactly what §4 deliberately normalizes *away* from for the live canvas, and exactly what you want denormalized for browsing.  
* **Large dataset: Google's Quick, Draw\! set** (\~50M labeled sketches, 345 categories) loaded into a `quickdraw_strokes` collection (`{word, drawing: [[x,y],...], key_id}`), also Atlas-Vector-Search-indexed. Two payoffs, both cheap since it's the same cluster and the same index type as the gallery:  
  1. The Guide-Stroke Generator (§5.1) gets grounded instead of purely generative: "help me draw a lion" can pull the nearest real human-drawn lions from the dataset and either hand one to Claude as a reference alongside the existing vision call, or, if time is short, render a fetched path directly as the low-opacity guide layer — a strictly cheaper fallback than a fresh generation call.  
  2. It's a free pre-built eval set for the Object Interpreter (§3): 345 categories at \~50k drawings each is enough to spot-check whether the interpreter reliably calls a lion a lion before relying on it live in front of judges.

### **14.3 Devin — building the autonomous layer alongside the core team**

The cleanest fit for "Devin for X" is to give Devin ownership of a piece that's well-specified, genuinely separable from the fast-iterating core, and useless to hand-build under time pressure: **the §14.1 gallery/publish/fork API backed by the §14.2 Mongo cluster.** It consumes a fixed snapshot shape, touches none of the realtime canvas or Rule Compiler code, and can be built and tested against a real Supabase branch and a real Atlas cluster in parallel with the humans building §6–§7.

* Give Devin the schema from §14.1, two example snapshot payloads, and the publish/browse/fork contract above; let it run unattended against the actual dev infra while the core team stays on the compiler and tick engine.  
* Log every Devin-authored change as its own `events` row (`actor: 'devin'`, reusing the shape §13 already gives hardware input) — this makes the existing replay/memory feature (§8) double as a visible audit trail of what the autonomous layer shipped, which is also the cleanest single demo beat for judges scoring this track specifically.  
* **Don't** hand Devin the Rule Compiler prompt/schema (§7) or the tick-loop evaluator (§6) — those are the load-bearing, all-day-iterating heart of the pitch and need a human reacting to live demo behavior, not an autonomous agent working off a spec written at hour zero.

### **14.4 Arduino (cross-reference to §13)**

The cabinet (§13) is already Arduino-track-eligible — Teensy 4.1 for the controller (Track A) and, for the rule-variable knob (Track B), pick **Arduino Uno R4 WiFi** over the ESP32 alternative the pull list (§13.8) leaves open. Same wiring, same code path into Web Serial (§13.3), no design change — just makes the whole cabinet genuinely Arduino hardware rather than half of it.

### **14.5 ASUS hardware \+ Zenni Claw**

* Build and run the judged demo on an ASUS laptop (a ROG machine matching Zenni Claw's supported-device list) rather than whatever's on hand — this alone qualifies the build for the hardware track at zero design cost.  
* For Zenni Claw itself — ASUS's agentic layer that turns a prompt into a guided multi-step workflow — build one small custom skill: **"Publish my Paper world."** Given a `world_id`, the skill (1) calls the §14.1 publish endpoint, (2) reads back the snapshot's `explanation` strings and object names, (3) drafts a title and a one-paragraph caption, and (4) posts the listing. This is deliberately a *different* agent from the Rule Compiler: Zenni Claw orchestrates a multi-step workflow *around* Paper (publish → summarize → post) rather than compiling behavior *inside* it, which is exactly the "everyday multi-step task" framing Zenni Claw's own pitch is built for — and it gives the demo a second, visibly distinct "watch an agent do a real task" beat beyond the Rule Compiler.

### **14.6 Long Lake: Convince a Non-Believer — demo notes**

See §1 for the pitch-level framing; this is the tactical version for the person actually running the demo in front of a skeptical judge.

* **Name the skepticism out loud before doing anything else** — "if you think AI is just autocomplete or search, watch this" — rather than leading with the canvas and hoping the point lands on its own.  
* **Let the skeptic type — or say — the input.** The headline moment (§1, "I said something ridiculous and it just happened") only functions as proof, not a magic trick, if the team didn't choose the sentence, and a spoken rule (§5.5) is the harder one to suspect of being rehearsed.  
* **Pause on the "Paper understood:" gloss (§3, step 6\) for a beat** before the effect plays — that plain-English readout is the actual moment of proof (an LLM reasoned about arbitrary text and produced a structured program), and cutting straight to the visual throws away the one part a non-believer needs to see.  
* **Say the distinction plainly at the end:** the compiled rule is a small re-runnable program, not a canned animation — that's the exact claim a skeptic doesn't already believe, so it should be said, not implied.

### **14.7 Deepgram (cross-reference to §5.5)**

Full design in §5.5 — voice is wired in as a third input modality feeding the same Rule Compiler funnel as typed and handwritten text, through a dedicated token-broker edge function so raw audio never touches our own server, only a short-lived credential does. It's worth demoing on its own terms: the live interim-transcript captions in the Rule Bar are a visible "it's listening" moment, and — per §14.6 above — a spoken rule reads as a stronger, less rehearsed-looking proof point than a typed one for a skeptical judge specifically.

---

*This document is meant to be handed to teammates and coding agents as a shared source of truth — when in doubt, check whether a proposed feature fits the strokes → objects → rules → worlds model before building something bespoke. The single sentence to keep re-reading: every input, however it's phrased — numeric, verbal, comedic, or atmospheric — compiles once into a small deterministic rule or trigger that a cheap client-side loop re-evaluates or re-checks forever after. Equations are one flavor of that; they are not the point. The point is that anything you can say happens.*

&nbsp;