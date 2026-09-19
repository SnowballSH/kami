# cat/ — the scripted Cheshire Cat

`ScriptedCat` is the offline stand-in for the model behind the `Cat` contract. It is composed from small pure parts; the only state it keeps is the current room, the hint ladder, whether help was offered, and the last drawing it was asked to guess at.

## How `name` rules

`ruleOn(utterance, context)` in `ruling.ts` runs these steps in order; the first that applies decides.

1. **Nothing said** → plain ink, and he asks what it is again.
2. **Scripted refusals** (`scriptedRefusals.ts`), always plain ink with the authored line from `spec.md` §4:
   - *Aimed at Alice* — a gadget for her (jetpack, superpowers), a verb acting on her ("make Alice fly", "let her jump"), Alice doing something ("she can fly"), or any mention of her that names nothing real. "A cake for Alice" is still a cake.
   - *Aimed at the room* — a verb acting on a piece of the page ("make the door bigger", "remove the wall"). "A door" on its own is just a drawing of a door.
   - *A key*, then *weapons and violence*.
3. **No nature found** → plain ink, with a tag line if the name carries a tag (`rose`, `tart`, `queen`), else a shrug.
4. **Nature not allowed in this room** → plain ink: "No *cake* down here. It's only ink."
5. **Accepted** → nature, strength from adjectives, tags, and a line: "The smallest *ladder* I ever saw." for a dot, "Near enough. Up it goes." for helicopter-likes, otherwise one of the nature's lines picked by a hash of the words, so the same name always gets the same answer.

## How a nature is found

`natureResolver.ts` matches whole keywords (possibly several words) against the stemmed utterance, so plurals work and "cupcake" never matches "cup".

- The player's own **description** ("bouncy", "sticky", "eat me") overrules any **thing** ("balloon"): a *bouncy balloon* bounces. Their word is law.
- Within a kind, the **longest keyword wins** ("bowling ball" over "ball"); ties go to the later word, the head of an English noun phrase.
- When a description decides the nature and a thing of the same nature was also named, the thing is reported as the keyword so the Cat's lines can mention it.

All vocabulary lives in `lexicon.ts`; `lexicon.test.ts` checks that no keyword belongs to two natures and that every guess chip resolves to the nature it promises.

## The dot joke

`name(utterance)` receives no drawing, so the Cat remembers the drawing from the preceding `guess(drawing)` call (the game always guesses before it names) and forgets it once a name lands.

## Guesses

`shape.ts` sorts a drawing into dot / tall / flat / round / blob from its bounds, aspect ratio and whether its longest stroke closes on itself. `shapeGuesser.ts` holds an ordered candidate list per shape; candidates whose nature the room allows come first, other shapes' candidates fill any gap, and forbidden natures appear only if nothing else is left.
