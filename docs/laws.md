# Laws — the formal framework behind "write it and it happens"

Kami has two ways for the player to change the world: **draw** something and **write** something. This document is the formal specification of the second — how a sentence on the board becomes a change to the world, how several sentences combine, how erasing one undoes it, and how the simulation turns the result into motion. It borrows the vocabulary of category theory because the vocabulary is exactly right: the things we compose are *arrows between states*, and every property we rely on (order matters, erasing is refolding, a model can never break physics) is a property of that composition.

`src/rules/` implements what is written here. `docs/spec.md` says what the game is; `docs/architecture.md` says how the code is arranged.

## 1. Objects

The framework has one kind of state and a few kinds of thing a sentence can be *about*.

**Board state.** A single immutable document `W : Physics` holding every dial the sentences can turn. Today:

```
Physics = { gravity: Vec, wind: Vec,                       -- fields on the world, in g
            timeScale, airDrag, friction, bounciness,      -- world ratios
            temperature (°C), daylight (0..1),             -- world ambience
            flight (0|1), walkSpeed, aliceSize,            -- Alice's own dials
            attraction (g), clones (count),                 -- Alice's reach into the world
            inkEater (0|1),                                -- whether the Sumikui is loose
            tilt (°, + clockwise), worldSpin (°/s),        -- how the paper is turned on screen
            bodies: [BodyLaw] }                            -- laws about drawings, oldest first (§2.1)
```

`EARTH : Physics` is the distinguished starting point: Earth gravity, still air, noon, 20 °C, one ordinary Alice.

**Subjects.** Each dial belongs to a subject — the thing a sentence talks about. The subjects are

| Subject | What it names | Dials today |
|---|---|---|
| `World` | the board as a whole | gravity, wind, timeScale, airDrag, friction, bounciness, temperature, daylight, inkEater, tilt, worldSpin |
| `Alice` | the protagonist | flight, walkSpeed, aliceSize, attraction, clones |
| `Drawing` | one committed drawing | its *nature* and *strength* (§6); its **motion** dials spin, thrust, mass, bounce, grip (§2.1) |
| `Kind` | every drawing sharing a nature (“all clouds”) | *reserved* — see §9 |

`Physics` is the product of the `World` and `Alice` dials, together with the list of laws about drawings; a drawing's nature lives on the drawing itself. Nothing in the framework depends on the list being this list: adding a dial is adding a field to the product, a row to the ranges table, and (usually) a few words to the grammar.

## 2. Morphisms: a sentence is an edit

A **rule** is a morphism on board state:

```
edit_r : Physics → Physics
```

Every rule Kami understands today has the same very simple shape, a **dial set**:

```
set(d, v)(W) = W with W.d := v
```

That is, `RuleEffect = { governs: d, value: v }` (or `{ governs: d, x, y }` for the two vector fields) *is* the morphism, written as data so it can be stored, sent to the server and checked. The rule additionally carries its `sourceText`, a gloss for Kami to write back, the note it lives in, and `createdAt`.

Two morphisms are always available and cost nothing:

- **identity** `id(W) = W` — what a sentence that is *not* a rule compiles to (the compiler returns `null`, the funnel treats it as a name or a remark instead);
- **composition** `(g ∘ f)(W) = g(f(W))` — apply `f`, then `g`.

Together with `Physics` as the single object this is a **monoid acting on `Physics`**: a one-object category whose arrows are edits. Associativity — `(h ∘ g) ∘ f = h ∘ (g ∘ f)` — is free because arrows are functions, and it is what lets the fold in §3 be written as a plain `reduce`.

### 2.1 Laws about drawings: edits with a target

A drawing has its own dial set, its **motion**:

```
Motion = { spin (turns/s, + clockwise), thrust: Vec (g, the push it gives itself),
           mass (× its weight), bounce (0..1), grip (× its surface friction),
           pace (× how fast it moves of itself), wings (0 | 1, whether it flies), size (× its own size),
           heed (−1 | 0 | 1: how a creature takes to Alice — flees her, its own way, follows her) }
STILL : Motion = { 0, (0,0), 1, 0, 1, 1, 0, 1, 0 }
```

The last three are **powers**: the dials Alice has as world effects (`walkSpeed`, `flight`, `aliceSize`) given to any drawing by name — “the cat is twice as fast”, “the dog can fly”, “the rabbit is huge”. A sentence about Alice keeps her own dials; a sentence about a named drawing is a body effect like any other.

A sentence about a drawing — “the wheel spins”, “the rock is twice as heavy”, “everything is slippery” — is a **body effect** `{ governs: d, of: Target, value }`, where

```
Target = all | named(word)
```

`all` speaks of every drawing on the board; `named(w)` speaks of every drawing whose name shares a word with `w` (“the wheels” finds “a spinning wheel”). A body effect denotes a **partial edit** `MotionEdit = Partial<Motion>` aimed at a target; the fold (§3) keeps these as `bodies: [BodyLaw = { of, edit }]` in `createdAt` order rather than applying them, because *which* bodies a target names is only known at tick time (drawings are named after the law may have been written).

The motion of one drawing with name `n` and own motion `own` (what its *name* asked for — “a spinning wheel” is `{ spin: 1 }`, given by the Cat) is then

```
motion(n, own, bodies) = fold((m, law) ⇒ m ⊕ law.edit, STILL ⊕ own, [law ∈ bodies | speaksOf(law.of, n)])
```

where `⊕` is record override. This is the same later-wins monoid as §2 restricted to the laws that speak of the drawing: the newest sentence about a dial wins, older ones return when it is erased, dials commute. `src/rules/motion.ts` is `speaksOf` and `motionOf`; `InkLayer` recomputes every drawing's motion whenever the fold changes or a drawing is (re)named.

### Why dial sets and not arbitrary functions

A dial set is the smallest edit that is *inspectable*: given the morphism as data you can validate it (§5), gloss it, store it, and replay it on another device. An opaque `Physics → Physics` closure could do none of those. Two consequences fall out:

- **Later wins.** `set(d, v₂) ∘ set(d, v₁) = set(d, v₂)`. The newest sentence about a dial is the one in force; the older one is still on the board, still a rule, and comes back the moment the newer one is erased.
- **Different dials commute.** `set(d, v) ∘ set(e, u) = set(e, u) ∘ set(d, v)` when `d ≠ e`. Order only ever matters between sentences about the *same* dial, which is the one place a player would expect it to.

Additive or multiplicative sentences (“gravity is twice what it was”) are compiled *at write time* against the physics then in force, into a dial set. The framework never stores a relative edit; it stores the absolute value the player saw take effect. This keeps every stored rule independent of the order it is replayed in, except for the deliberate later-wins rule above.

## 3. The fold: what the world is right now

Let `R = {r₁ … rₙ}` be the rules currently on the board, ordered by `createdAt` (ties broken by id). The board's physics is the composite of all of them applied to Earth:

```
physics(R) = (edit_rₙ ∘ … ∘ edit_r₂ ∘ edit_r₁)(EARTH)
           = fold(enact, EARTH, sort(R))
```

`src/rules/resolvePhysics.ts` is exactly this fold; a body effect appends its `BodyLaw` to `bodies` instead of setting a field. Properties:

- **Erasing is refolding.** There is no “inverse edit”. Erasing the note that holds `rᵢ` gives `physics(R \ {rᵢ})`, recomputed from `EARTH`. This is why repeal is free of bookkeeping and why an older sentence about the same dial comes back on its own.
- **Loading is the same operation.** Persistence stores `R`; a board opens by running the same fold. Nothing about “the current world” is stored separately.
- **Determinism.** The fold is a pure function of `R`; two devices holding the same set of rules see the same physics.

The game calls `sim.setPhysics(physics(R))` whenever `R` changes. The simulation never sees rules, only the folded state.

## 4. Sentences to morphisms: the compiler

```
compile : Text → Maybe (Edit × Gloss)
```

The offline grammar (`src/rules/grammarCompiler.ts`) is a chain of **recognisers**, each of which claims a sentence or passes. `dials.ts` is table-driven: one `Dial` row per scalar governs, listing the *vocabulary* that names it, the *readings* (words like “huge”, “freezing”, “night” with their numeric value) and an *implied* value when the dial is merely mentioned (“make Alice fly” → `flight = 1`). Adding a dial to the grammar is adding a row.

`recognisers/motion.ts` does the same for body effects, plus the target: `normalise` keeps the nouns that followed a determiner (“the *wheel*”, “every *rock*”), and the first of those that is neither a dial word nor a number is the `named` target; “everything” / “all drawings” is `all`; a sentence about Alice is passed on so her dials keep their own grammar. The world dial recognisers run first, so “everything is bouncy” stays the world's `bounciness` and only sentences the world has no dial for (spin, thrust, mass, grip) fall through to `all`.

The model-backed compiler on the server is asked to emit the same shape. `server/schemas.ts` and `server/compile/effectRanges.ts` are the shared contract; the server typecheck fails if the two ends drift. A remote answer that does not validate is dropped, not repaired — the model may pick values, never a shape.

### 4.1 Scenes: one sentence, many edits

```
scene : Text → Maybe (Place × [Edit × Gloss] × [Prop] × Line)
```

“Teleport us to the moon” is not one dial. A **scene** (`src/rules/scenes/`) is a finite list of ordinary edits — the Moon is `set(gravity,(0,.165))`, `set(airDrag, low)`, `set(daylight, .3)` — plus props Kami draws (`{ word, at, size }`, each a summons) and an arrival line. Nothing new is added to `Edit`: the scene's edits are enacted in order and each becomes a rule of its own, but all of them carry the same source note, so **erasing the note repeals the whole list** and the refold is the ordinary one. The composite is just `e_n ∘ … ∘ e_1`, the fold of the list; a scene is a name for a word in the free monoid of edits. The offline atlas (`atlas.ts`) is a table of such words; the model (`server/scene/`) may write another for a place the table lacks, validated edit by edit against the same schema and ranges as single laws (§5), so it too can only pick values. A scene is enacted whole or refused whole under the mode policy — a half-Moon is not a place.

## 5. Validation and clamping

Every dial `d` has a closed range `[lo_d, hi_d]` (`src/rules/effects.ts`; the server's wider table in `effectRanges.ts`). `set(d, v)` is only admitted with `v := clamp(v, lo_d, hi_d)` and the gloss says “(capped)” when clamping bit. Because the fold only ever composes admitted dial sets, `physics(R)` lies inside the product of the ranges for *any* `R` — the invariant the simulation relies on, and the reason a model or a mischievous player cannot produce a world the engine cannot simulate.

Persisted values use `src/rules/effectDomains.ts`: gravity ±30 g per axis, wind ±3 g per
axis, time 0.1–3, drag/friction 0–10, bounce/daylight/flight/inkEater 0–1, temperature
−100–1000 °C, walking 0.1–5, size 0.25–4, attraction ±3 g, integer clones 0–8, tilt ±180°
and worldSpin ±90°/s.
These domains include both compilers' outputs. The offline grammar deliberately retains
its narrower vector magnitude caps (gravity 5 g, wind 2 g) and friction cap of 5.
Both compilers round clone counts to the nearest integer after clamping. Flight and
inkEater retain their existing positive-means-enabled behavior within 0–1.
Persistence rejects out-of-domain values rather than clamping stored player intent.
The fold ignores invalid numeric effects from historic rules; simulation entry points
reject unsafe physics before modifying bodies. Ruling strength must stay in 0.5–2.

## 6. Drawings: natures as morphisms on one body

A drawing's state is its **nature**, **strength** and **own motion** (§2.1): `ruling : Drawing → Drawing` sets all three (`sim.applyRuling`). The Cat reads the motion out of the name's adjectives — “spinning”, “rotating”, “powered”, “boosted” — so a drawing can move by its name alone, before any law speaks of it. Natures are presets — “mushroom” is `bouncy`, “black hole” is `attractor`, “lantern” is `lantern` — chosen by the Cat from the player's words and scaled by their adjectives. They compose like dial sets on one subject: the newest ruling wins, erasing the drawing removes it entirely.

The nature table (`src/sim/natures.ts`) is the second place the framework grows. A nature is a record of hooks — `beforeStep`, `onAliceTouch`, `onInkTouch` — over a small **`NatureWorld`** interface (feelers, emit, consume, freeze, `pullToward`, …). A new behaviour is a new record and, usually, one new capability on `NatureWorld`.

## 7. Systems: from state to motion

A **system** reads the folded state each tick and produces forces or state transitions; it is the functor from “what the dials say” to “what the bodies do”. Systems never read rules, only `Physics` and the natures. The ones that exist:

| System | Reads | Does |
|---|---|---|
| gravity / wind / drag | `gravity`, `wind`, `airDrag` | engine gravity, a push on every dynamic body, air friction |
| motion | `bodies`; each drawing's name and own motion | `spin` sets a loose body's angular velocity (a held one turns in place; creatures and roles are exempt); `thrust` pushes the body by `mass × g` each tick; `mass`, `grip`, `bounce` scale the body's density and friction and raise its restitution — `materialMoved` over the world material |
| powers | `bodies`; each drawing's nature | `pace` multiplies a creature's or vehicle's own speed; `wings` makes a walker or hopper fly (it climbs to perch height, then roams like a flier), holds a plain drawing in the air, and lets a vehicle take off once rolling (up/down steer it; still on the ground, up is a jump off as before); `size` scales the drawing about its own centre — strokes, body and pose alike, feet kept on the ground — and refolds back when the law goes |
| tempers | `bodies`; each creature's own `heed` | `heed > 0` makes a walker, hopper or flier follow Alice (heel at `HEEL_PX`, perch above her), `heed < 0` makes it bolt when she is within `FLEE_RADIUS_PX`, `0` lets it roam; a name's temper ("a shy dog", a dog's loyalty by birth) is the drawing's own `heed`, so a later law overrules it and its repeal restores it |
| Alice movement | `walkSpeed`, `flight`, `aliceSize` | her pace, whether air holds her like a ladder, her body scale |
| attraction | `attraction`; `attractor` natures | `pullToward(center, g, bodies)` with `1/r²` falloff, capped up close |
| weather | `temperature` | `slippery` melts above 30 °C, `floaty` burns off above 60 °C, after a dwell; emits `perished` |
| twins | `clones` | `n` further Alice bodies spawned beside her, never colliding with her; each has an intent of her own (`setWalkIntent(intent, who)`), her own portal memory, and her own `fell` / `goal-reached` / `alice-devoured` (events carry `who`); a pilot per body lives in `game/party.ts` |
| lighting | `daylight`; `lantern` natures | a night layer cut out around Alice and every lantern — presentation only |
| creatures | natures `walker`/`hopper`/`flier` | per-body minds; Alice rides them |
| the paper's turn | `tilt`, `worldSpin` | `PaperTurn`: the angle the paper is turned on screen — `tilt` plus what `worldSpin` has accumulated (a new tilt restarts the count). The camera turns by it, so the whole page rotates; gravity stays the paper's, so Alice, creatures, vehicles and the autopilot are *of the paper* and keep walking on it, while loose ink is nudged toward the *room's* down (`tumble`: the difference between room-down seen on the paper and the paper's own gravity) and slides off a turned page |
| the Sumikui | `inkEater`; Alice's touches; the board's solids | a ghost that shadows Alice, wakes at the second drawing, and eats everything on the paper that she depends on: ink she has used (never roles), the board's ground under her feet (bitten out, healing later), and Alice herself (swallowed; she respawns) — never where Kami sets her down, and never untouched scribbles until it is quick enough to sweep them up in one gulp. Doubles its pace every 20 s awake up to a cap; emits `sumikui-woke`, `devoured`, `paper-bitten`, `paper-healed`, `alice-devoured` |

The autopilot is a system too: `Scene.canFly` marks every cell of air climbable, so a flight law makes “fly over the gap” a plan rather than a special case.

## 8. Worked examples

| Written | Compiles to | Fold effect | System that acts |
|---|---|---|---|
| `make Alice fly` | `set(flight, 1)` | `W.flight := 1` | Alice movement (air is a ladder); autopilot plans through air |
| `Alice walks twice as fast` | `set(walkSpeed, 2)` | `W.walkSpeed := 2` | Alice movement; autopilot's `walkSpeed` |
| `it's 100 degrees` | `set(temperature, 100)` | `W.temperature := 100` | weather: ice and clouds perish, plain ink is untouched |
| `it's night` then draw a lamp, write `lantern` | `set(daylight, 0.1)`; `ruling(lantern)` | `W.daylight := 0.1`; drawing.nature := lantern | lighting cuts a pool of light around the lamp |
| `clone Alice` | `set(clones, 1)` | `W.clones := 1` | twins: one more Alice beside her, with a mind of her own — she walks her own route to the goal, or wanders when there is none |
| `give Alice gravitational attraction` | `set(attraction, 1)` | `W.attraction := 1` | attraction pulls loose drawings toward her |
| `summon the ink eater` then `banish the Sumikui` | `set(inkEater, 1)`, `set(inkEater, 0)` | `0` while both stand; `1` again if the banishment is erased | the Sumikui exists exactly while the fold says `1`; sealing forgets its hunger |
| `g = moon` then `no gravity` then erase the second note | `set(gravity,(0,.165))`, `set(gravity,(0,0))` | `(0,0)` while both stand; `(0,.165)` after refold | gravity |
| `tilt the world 90°` then `the world spins slowly` | `set(tilt, 90)`, `set(worldSpin, 5)` | `{ tilt: 90, worldSpin: 5 }` | the paper's turn: the page is drawn a quarter clockwise and keeps turning 5°/s; loose pebbles roll toward the room's floor, Alice walks on as before |
| `the wheel spins` | `set(spin, 1) of named(wheel)` | `W.bodies ++ [{ wheel, { spin: 1 } }]` | motion: every drawing named “…wheel…” turns once a second |
| `the cart accelerates` | `set(thrust, (0.5, 0)) of named(cart)` | `W.bodies ++ [...]` | motion: the cart pushes itself rightward at half a g |
| `everything spins` then `the rock stops spinning` | `set(spin, 1) of all`, `set(spin, 0) of named(rock)` | both kept; `motion("rock") = { spin: 0 }`, `motion("wheel") = { spin: 1 }` | motion |
| `the dog can fly` · `the cat is twice as fast` · `the rabbit is huge` | `set(wings, 1) of named(dog)` · `set(pace, 2) of named(cat)` · `set(size, 2) of named(rabbit)` | `W.bodies ++ [...]` | powers: the dog takes to the air, the cat paces twice as fast, the rabbit doubles about its centre; Alice can ride any of them |
| `the cat chases me` · `the mouse runs away from her` · `the cat ignores me` | `set(heed, 1) of named(cat)` · `set(heed, −1) of named(mouse)` · `set(heed, 0) of named(cat)` | `W.bodies ++ [...]` | tempers: the cat heels, the mouse bolts, the cat goes its own way again |
| `a spinning wheel` (as a name) | `null` (identity); the ruling carries `own = { spin: 1 }` | — | funnel names the drawing; motion turns it |
| `a mushroom` | `null` (identity) | — | funnel falls through to naming |
| `teleport us to the moon` | `[set(gravity,(0,.165)), set(airDrag,·), set(daylight,.3)]`, all of one note; props `moon`, `star ×3` | the three edits in order; erasing the note refolds without all three | gravity, drag, lighting; Kami inks the props above the words |

## 9. Extension paths

What each of the remaining ideas is, in this vocabulary, and what it costs:

- **Vehicles** (“a car”) — *built*: a `vehicle` nature whose `beforeStep` (`sim/vehicles.ts`) reads the new `NatureWorld.intent` capability and rolls the body toward `intent.x × VEHICLE_SPEED × strength` while Alice is aboard; `alice.drive` makes her movement yield to it, and jumping dismounts. One nature record, one capability, exactly as costed.
- **Follow / flee** (“a dog”, “a mouse”) — *built*: not new natures but a `temper` on the ruling, orthogonal to how the creature moves, so every walker, hopper and flier can follow or flee. `urgeOf` (`sim/creatures.ts`) reads `world.alice` and returns the creature's urge; the three strategies take their facing from it. One field, one function, no new nature records.
- **Portals** (“a portal”, twice) — *built*: a `portal` role whose touch hook calls `NatureWorld.warp`; `sim/portals.ts` pairs them in drawing order as a ring and bars the exit until Alice steps clear. One nature, one capability, one hook.
- **Kinds** (“all clouds are heavy”): a third `Target` variant, `kind(Nature)`, matched in `speaksOf` against the drawing's nature instead of its name. One variant, one line in `speaksOf`; the fold, the compiler chain and the motion system are untouched.
- **More motion dials** (“the rock is dragless”, “the wheel is glued down”): a field on `Motion`, a default in `STILL`, a row in the body ranges and the server prompt, and a line in `materialMoved` or the motion system.
- **Independent clones** — *built*: the dial and its fold are untouched; what changed is who hears the intent. `Simulation` keeps one `WalkIntent` per Alice, `Scene` takes an `alice` per pilot (and `others` for the rest, never stamped solid), and `game/party.ts` hires one `Pilot` per body; tapping an Alice makes her the one the stick steers. See `docs/agency.md`.
- **Arbitrary characters**: the Cat's lexicon already maps any noun to a nature; the `/api/name` contract lets a model choose the nature for words the lexicon lacks — choosing among presets, never writing behaviour.

None of these require touching the fold, the compiler chain, or the way rules are stored: the framework is closed under adding dials, natures and systems.
