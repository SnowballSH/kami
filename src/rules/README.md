# rules/ — text into standing physics

`createRuleCompiler()` is the offline half of "compile once, run forever": a note becomes a `CompiledRule` (one `RuleEffect` plus the gloss Kami writes back) or `null`, and `null` is what lets the funnel in `game/` fall through to naming a drawing. Nothing here runs per frame.

## Generous about phrasing, strict about meaning

1. **`normalise.ts`** lower-cases, drops apostrophes and `'s`, rewrites symbols (`²`, `×`, `½`, `%`, every spelling of m/s² → one unit word), splits `2g` / `x2`, keeps only numerals and words, then throws away filler — *set, make, let, please, the, is, to, equal(s), like, …*. `=`, "is", "to" and "equals" all unify to nothing: no recogniser needs them. A few two-word units are fused afterwards (`slow motion` → `slowmo`, `air resistance` → `airdrag`, `upside down` → `flipped`).
2. **Recognisers** (`recognisers/*.ts`, tried in the order listed in `grammarCompiler.ts`) each read one kind of rule. The strictness comes from one shared law in `recogniser.ts`: a recogniser only answers when **every remaining word is in its own vocabulary** (plus numerals, amount words and scope words). "bouncy mushroom", "hot air balloon", "gravity boots" and "a cow on the moon" all fail on the unknown noun and stay names.
3. Beyond that, each recogniser wants **evidence that the sentence is about the world**, not about a drawing:
   - a subject noun (`subjects.ts`: *g, gravity, time, speed, friction, bounciness, air, wind…*) together with an amount, a qualifier, a body or a direction — so bare "gravity", "wind" or "time" say nothing;
   - or a universal word (*everything, world, all…*) with an adjective — "everything is ice" is a rule, "ice" is a drawing of ice;
   - for gravity only, a celestial body needs a gravity word or "on" — "the moon" is a drawing of the moon, "on the moon" is a place.
4. A sentence with more than one number ("gravity = (0.3, -1)") is left for the remote compiler.

## Quantities

`amounts.ts` reads the one quantity in a sentence: a numeral (decimals, fractions, number words) with the unit that follows it (`g`, m/s², `%`, `x`/`times`), else *half / double / twice / triple…*, else *no / off / without…* as zero. For gravity a bare number is m/s² (`g = 3.7` → 0.38 g) and a multiple is of 1 g; with a body, a multiple scales the body ("twice earth gravity"). `bodies.ts` holds real surface gravities; `directions.ts` maps up/down/left/right (sideways is to the right) and never produces `-0`.

## Effects and glosses

`effects.ts` is the only place that builds a `CompiledRule`: it clamps (gravity ≤ 5 g, wind ≤ 2 g, time 0.1–3, friction 0–5, bounciness 0–1, air drag 0–10), rounds stored values to three decimals, and writes the gloss — `gravity = 0.17 g (the Moon)`, `gravity = 1 g, upward`, `time runs at 0.5x`, `friction off`, `wind = 0.3 g, to the right`. A value that had to be clamped says so: `gravity = 5 g (the Sun, capped)`. Glosses are plain ASCII so the stroke font can always write them. Resets ("normal gravity", "reset time", "back to earth", "gravity on") go through the same builders with `EARTH`'s values.

## The other two entry points

`chainCompilers` asks each compiler in turn; a compiler that throws or rejects counts as "didn't understand". `resolvePhysics` sorts rules by `createdAt` (ties by id) and folds them over `EARTH`, so the newest rule per `governs` wins and erasing it restores the one before.
