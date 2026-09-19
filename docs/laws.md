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
            inkEater (0|1) }                               -- whether the Sumikui is loose
```

`EARTH : Physics` is the distinguished starting point: Earth gravity, still air, noon, 20 °C, one ordinary Alice.

**Subjects.** Each dial belongs to a subject — the thing a sentence talks about. The subjects are

| Subject | What it names | Dials today |
|---|---|---|
| `World` | the board as a whole | gravity, wind, timeScale, airDrag, friction, bounciness, temperature, daylight, inkEater |
| `Alice` | the protagonist | flight, walkSpeed, aliceSize, attraction, clones |
| `Drawing` | one committed drawing | its *nature* and *strength* (§6) |
| `Kind` | every drawing sharing a nature (“all clouds”) | *reserved* — see §7 |

`Physics` is the product of the `World` and `Alice` dials; `Drawing` state lives on the drawing itself. Nothing in the framework depends on the list being this list: adding a dial is adding a field to the product, a row to the ranges table, and (usually) a few words to the grammar.

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

`src/rules/resolvePhysics.ts` is exactly this fold. Properties:

- **Erasing is refolding.** There is no “inverse edit”. Erasing the note that holds `rᵢ` gives `physics(R \ {rᵢ})`, recomputed from `EARTH`. This is why repeal is free of bookkeeping and why an older sentence about the same dial comes back on its own.
- **Loading is the same operation.** Persistence stores `R`; a board opens by running the same fold. Nothing about “the current world” is stored separately.
- **Determinism.** The fold is a pure function of `R`; two devices holding the same set of rules see the same physics.

The game calls `sim.setPhysics(physics(R))` whenever `R` changes. The simulation never sees rules, only the folded state.

## 4. Sentences to morphisms: the compiler

```
compile : Text → Maybe (Edit × Gloss)
```

The offline grammar (`src/rules/grammarCompiler.ts`) is a chain of **recognisers**, each of which claims a sentence or passes. The newest recogniser, `dials.ts`, is table-driven: one `Dial` row per scalar governs, listing the *vocabulary* that names it, the *readings* (words like “huge”, “freezing”, “night” with their numeric value) and an *implied* value when the dial is merely mentioned (“make Alice fly” → `flight = 1`). Adding a dial to the grammar is adding a row.

The model-backed compiler on the server is asked to emit the same shape. `server/schemas.ts` and `server/compile/effectRanges.ts` are the shared contract; the server typecheck fails if the two ends drift. A remote answer that does not validate is dropped, not repaired — the model may pick values, never a shape.

## 5. Validation and clamping

Every dial `d` has a closed range `[lo_d, hi_d]` (`src/rules/effects.ts`; the server's wider table in `effectRanges.ts`). `set(d, v)` is only admitted with `v := clamp(v, lo_d, hi_d)` and the gloss says “(capped)” when clamping bit. Because the fold only ever composes admitted dial sets, `physics(R)` lies inside the product of the ranges for *any* `R` — the invariant the simulation relies on, and the reason a model or a mischievous player cannot produce a world the engine cannot simulate.

## 6. Drawings: natures as morphisms on one body

A drawing's state is its **nature** and **strength**: `ruling : Drawing → Drawing` sets both (`sim.applyRuling`). Natures are presets — “mushroom” is `bouncy`, “black hole” is `attractor`, “lantern” is `lantern` — chosen by the Cat from the player's words and scaled by their adjectives. They compose like dial sets on one subject: the newest ruling wins, erasing the drawing removes it entirely.

The nature table (`src/sim/natures.ts`) is the second place the framework grows. A nature is a record of hooks — `beforeStep`, `onAliceTouch`, `onInkTouch` — over a small **`NatureWorld`** interface (feelers, emit, consume, freeze, `pullToward`, …). A new behaviour is a new record and, usually, one new capability on `NatureWorld`.

## 7. Systems: from state to motion

A **system** reads the folded state each tick and produces forces or state transitions; it is the functor from “what the dials say” to “what the bodies do”. Systems never read rules, only `Physics` and the natures. The ones that exist:

| System | Reads | Does |
|---|---|---|
| gravity / wind / drag | `gravity`, `wind`, `airDrag` | engine gravity, a push on every dynamic body, air friction |
| Alice movement | `walkSpeed`, `flight`, `aliceSize` | her pace, whether air holds her like a ladder, her body scale |
| attraction | `attraction`; `attractor` natures | `pullToward(center, g, bodies)` with `1/r²` falloff, capped up close |
| weather | `temperature` | `slippery` melts above 30 °C, `floaty` burns off above 60 °C, after a dwell; emits `perished` |
| twins | `clones` | `n` further Alice bodies hearing the same intent, spawned beside her, never colliding with her |
| lighting | `daylight`; `lantern` natures | a night layer cut out around Alice and every lantern — presentation only |
| creatures | natures `walker`/`hopper`/`flier` | per-body minds; Alice rides them |
| the Sumikui | `inkEater`; Alice's touches | a ghost that shadows Alice, wakes at the second drawing, hunts only ink she has used (never roles), devours it after a dwell, and doubles its pace every 20 s awake up to a cap; emits `sumikui-woke`, `devoured` |

The autopilot is a system too: `Scene.canFly` marks every cell of air climbable, so a flight law makes “fly over the gap” a plan rather than a special case.

## 8. Worked examples

| Written | Compiles to | Fold effect | System that acts |
|---|---|---|---|
| `make Alice fly` | `set(flight, 1)` | `W.flight := 1` | Alice movement (air is a ladder); autopilot plans through air |
| `Alice walks twice as fast` | `set(walkSpeed, 2)` | `W.walkSpeed := 2` | Alice movement; autopilot's `walkSpeed` |
| `it's 100 degrees` | `set(temperature, 100)` | `W.temperature := 100` | weather: ice and clouds perish, plain ink is untouched |
| `it's night` then draw a lamp, write `lantern` | `set(daylight, 0.1)`; `ruling(lantern)` | `W.daylight := 0.1`; drawing.nature := lantern | lighting cuts a pool of light around the lamp |
| `clone Alice` | `set(clones, 1)` | `W.clones := 1` | twins: one more Alice walking beside her |
| `give Alice gravitational attraction` | `set(attraction, 1)` | `W.attraction := 1` | attraction pulls loose drawings toward her |
| `summon the ink eater` then `banish the Sumikui` | `set(inkEater, 1)`, `set(inkEater, 0)` | `0` while both stand; `1` again if the banishment is erased | the Sumikui exists exactly while the fold says `1`; sealing forgets its hunger |
| `g = moon` then `no gravity` then erase the second note | `set(gravity,(0,.165))`, `set(gravity,(0,0))` | `(0,0)` while both stand; `(0,.165)` after refold | gravity |
| `a mushroom` | `null` (identity) | — | funnel falls through to naming |

## 9. Extension paths

What each of the remaining ideas is, in this vocabulary, and what it costs:

- **Vehicles** (“a car”): a `vehicle` *nature* whose `beforeStep` moves the body with Alice's intent while she stands on it; Alice movement yields to it. One nature record, one `NatureWorld` capability (`intent`).
- **Follow / flee** (“a dog”, “a mouse”): creature natures whose mind reads `world.alice` and turns toward or away. Two nature records over the existing `Feelers`.
- **Portals**: a `portal` nature; the system pairs portal bodies and teleports whatever touches one to its partner. One nature, one hook.
- **Per-drawing physics** (“the rock is twice as heavy”): a third subject with its own dials. `RuleEffect` gains `{ target: DrawingId, governs, value }`; `physics(R)` becomes a map `DrawingId → Overrides` alongside the world product. Same fold, same later-wins, same clamps.
- **Kinds** (“all clouds are heavy”): the same as per-drawing with `target: Nature`; resolved to bodies at tick time.
- **Independent clones**: twins that own an autopilot each; the `Scene` would take an `alice` per pilot.
- **Arbitrary characters**: the Cat's lexicon already maps any noun to a nature; the `/api/name` contract lets a model choose the nature for words the lexicon lacks — choosing among presets, never writing behaviour.

None of these require touching the fold, the compiler chain, or the way rules are stored: the framework is closed under adding dials, natures and systems.
