# Kami — Project Spec

**HackMIT 2026 · theme: Alice in Wonderland · Entertainment track**

> **Alice can hop, not fly. You can draw.**
> Draw it. Name it. It wakes up.

*Kami* (紙) is paper. *Kami* (神) is also the spirit that lives in a thing. The game is both: a world made of paper, where anything you draw gets a spirit the moment you say what it is.

This is the source of truth for **what we're making and why**. How it's built lives in `engineering-notes.md`; the cabinet lives in `hardware.md`.

---

## 1. The game in one paragraph

Alice has fallen into a book. Each room is a page; the rabbit hole is a hole torn through the pages, and the White Rabbit is always one page ahead. Alice can walk — nothing else. You are the unseen hand with the pen. Whatever you draw becomes solid ink in her world, and whatever you *call* it, it becomes: a blob you name "a bouncy mushroom" bounces; a box you name "eat me" makes her grow. You can't draw well? Neither can anyone, and in Wonderland a thing is what you say it is. The Cheshire Cat hears you, answers out loud, and — if you ask — helps you when you're stuck.

## 2. Pillars

Every feature argument gets settled against these four.

1. **Drawing is the only verb.** Alice walks; everything else is ink. If a problem can be solved without drawing, the room is broken.
2. **It is what you say it is.** Bad art is canon, not a failure state. The AI guesses; the player's word is law.
3. **Think, don't twitch.** Time crawls while the pen is down. Nobody dies. Erasing refunds ink. The challenge is the idea, never the execution.
4. **The Cat never plays for you.** He teases, confirms, refuses and hints — in that order of preference. He gives the answer only when asked three times.

## 3. The core loop

**See the obstacle → draw → name it → watch what happens → erase or build on it.** One turn of the loop should take 10–20 seconds. A room is 3–8 turns.

What makes it a puzzle rather than a sketchpad:

- **The name gives the spirit; the shape gives the body.** Calling a dot "a ladder" gets you a climbable dot. Natures act through the geometry you actually drew — so *what* you draw, *where*, and *how big* all matter, even though *how well* doesn't.
- **Ink is scarce.** Every room has an ink budget measured in stroke length. The obvious solution (a giant ramp) never fits. Small, clever ink wins.
- **Some paper won't take ink.** The Queen has had parts of the page painted red. You can't draw there.
- **Alice isn't yours to rewrite.** Nothing you say can change her, the room, or the rules — only your own drawings. She changes only by touching what you drew.

## 4. Three layers (also the cut order)

Each layer is a complete game without the ones above it.

| Layer | What the player does | What it needs | Status |
|---|---|---|---|
| **1. Ink is solid** | Draws a line; Alice walks on it | Physics only. No AI, no latency. | Floor |
| **2. Ink is what you say it is** | Names the drawing; it takes on a nature | Vision + voice + the Cat | **The game** |
| **2½. Adjectives** | "A *very* bouncy mushroom." "A *huge* heavy rock." | Same call — one extra dial | Cheap, high charm |
| **3. Enchantments** | Speaks a *behavior* onto a drawing: "it drifts to the right" | The compile-once rule engine from the original Paper concept | Lives mainly in the Tea Party sandbox; optional solution in Room 4. First big thing to cut. |

### Natures

One per drawing. The player never sees this list — they see the ink change tint and hear the Cat.

| Nature | Things people will say | What it does |
|---|---|---|
| *plain ink* | anything else | Solid. The default, and always useful. |
| **bouncy** | mushroom, spring, trampoline, jelly | Launches Alice when she lands on it |
| **climbable** | ladder, vine, rope, stairs | Alice can go up and down it |
| **floaty** | balloon, cloud, bubble | Rises |
| **heavy** | rock, anvil, safe | Very dense — tips seesaws, holds things down, presses levers |
| **light** | feather, leaf, paper | Drifts, barely weighs anything |
| **buoyant** | boat, raft, lily pad, cork | Floats on water and carries her |
| **slippery** | ice, soap, butter | No friction |
| **sticky** | glue, nail, tape, honey | Fixes itself wherever it lands |
| **grow** | cake, biscuit, "eat me" | One use: Alice doubles in size |
| **shrink** | bottle, potion, "drink me" | One use: Alice shrinks to fit tiny doors |

Plus free-form **tags** the inhabitants react to — *rose*, *tart*, *queen* — see Room 5.

Adjectives scale a nature between half and double strength. That's the whole of layer 2½.

### Rulings for the clever and the cheeky

The Cat refuses in character. He never says "invalid."

| Player tries | Ruling | Cat |
|---|---|---|
| "It's a key" | Plain ink. Drawn keys open drawn doors; that one's real. | *"A lovely picture of a key."* |
| "A jetpack for Alice" / "make Alice fly" | Nothing attaches to Alice. | *"She isn't yours to rewrite. Only what you draw."* |
| "A helicopter" | Nearest honest nature: floaty. | *"Near enough. Up it goes."* |
| "A sword" / anything violent at the guard | Plain ink. Nobody gets hurt in Kami. | *"He's only cardboard. Be kind."* |
| "Make the door bigger" / "remove the wall" | The page isn't yours either. | *"I didn't draw it. Neither did you."* |
| A cake in a room where cake isn't allowed | Plain ink. | *"No cake down here. It's only ink."* |
| A dot called "a ladder" | It's a climbable dot. | *"The smallest ladder I ever saw."* |
| Names nothing | Stays plain ink. The Cat offers three guesses (§5). | *"And what is* that *supposed to be?"* |

## 5. Being kind to people who can't draw

This is a pillar, so it gets its own section.

| Worry | How Kami handles it |
|---|---|
| "I can't draw." | You don't need to. Shape matters for physics; identity comes from your voice. The Cat's teasing is affectionate and universal — he teases good drawings too. |
| "It won't recognize my mushroom." | It doesn't have to. Say "it's a mushroom." The vision guess only matters when you stay silent. |
| Too shy or too loud to talk | **Guess chips:** stay silent for three seconds and the Cat offers his three best guesses as buttons — *"A mushroom? A rock? A cloud?"* One click. A typed box is always there too. |
| Slow hands | Time crawls from pen-down until the drawing is finished. |
| Multi-part drawings | Everything drawn within about a second of the last stroke is one drawing. |
| Fear of wasting ink | Erase refunds all of it. The ink meter shows the cost live *as* you draw. |
| "What does a mushroom even look like?" | *"Cat, show me a mushroom"* → faint strokes to trace, taken from real people's doodles (Quick, Draw!), so the guide is as wobbly as you are. |
| Trackpads | A mouse at minimum; a stylus or touchscreen if we can borrow one. On the cabinet, Etch A Sketch knobs — where *nobody* can draw, which is the point. |

## 6. The Cheshire Cat

The single face of all the AI in the game. Every recognition, refusal and hint is him — captioned instantly, spoken a beat later.

- **Hold to talk** (Space, or the CAT button). Never an open mic; the hall is loud.
- **Voice:** amused, riddling, secretly helpful. Fifteen words or fewer. Never cruel, never says "error."
- **He teaches naming.** The first time you draw anything in Room 2, he fades in: *"And what is* that *supposed to be?"* Your answer is the tutorial.
- **He notices when you're stuck** — 45 seconds without progress, or three falls — and the grin appears: *"Ask, if you like."* Once per room. He never volunteers more.
- **The hint ladder.** Each room has three authored hints: a nudge, a direction, the answer. Each time you ask, he climbs one rung, phrasing it around what you've already tried. He never skips a rung. **Nobody leaves the booth stuck.**

Room 3's ladder, as the model for the rest:
1. *"Too big for the door, too small for the table. How inconvenient to be only one size."*
2. *"In this house, size is a matter of diet. But mind the order you dine in."*
3. *"Draw a cake — eat, grow, take the key. Then draw a bottle — drink, shrink, and through you go."*

## 7. The rooms

One book, six pages, each a page deeper. The Rabbit runs the room first — his path shows *where* to go; the puzzle is *how*. Each room needs at least two real solutions and one that makes the player say "I can't believe that worked." Treat these as first drafts; the hour-17 playtest decides.

| # | Page | Teaches | The problem | Intended solutions | What stops the lazy answer |
|---|---|---|---|---|---|
| 1 | **The Riverbank** | Ink is solid | A ditch. The Rabbit hops it. Alice stops at the edge and looks at you. | Draw a bridge. | Nothing — ink is generous, only plain ink exists yet. Twenty seconds, then the fall, then the title. |
| 2 | **The Shelves** | Names give natures. *The Cat arrives.* | The way on is a ledge far above her. | Bouncy mushroom below the drop · a ladder · a balloon lifting a plank | Ink covers less than half a ramp |
| 3 | **The Hall of Doors** | Drawings change Alice, and order matters | A tiny door. The key is on a tall glass table. | Cake → grow → take key → bottle → shrink → door. Shrink first and the key is out of reach — exactly as in the book. | The table is glass: ink won't anchor to it, nothing sticks, and the budget can't reach that high |
| 4 | **The Pool of Tears** | Things move; timing matters | She's still tiny. A pool too wide to bridge, with a current running the wrong way. | Lily pads drawn upstream, crossed as they drift past · *(layer 3)* a boat told to "sail to the right" | Water never counts as an anchor; ink is far less than the width |
| 5 | **The Croquet Ground** | *Where* you draw matters | A card guard patrols the only path. The ground is painted red — no ink. | Draw a **white rose** in the margin: he runs off to paint it red · a tart lures him · draw **the Queen** and he kneels on the spot | Only the margins take ink, so the lure has to be placed with thought |
| 6 | **The Trial** | Everything at once | A wall of cards. A ceiling too low to grow under. | Drop something heavy on the lever to raise the ceiling → cake → grow enormous → walk straight through. *"You're nothing but a pack of cards!"* | — |
| ∞ | **The Mad Tea Party** | Nothing. It's a party. | No exit, endless ink, endless enchantments. | Free play — the original "say anything and it happens" toy, safely outside the puzzles. | — |

**Ending.** Alice wakes on the riverbank. The credits are a flip-through of **everything the player drew**, each captioned with what they called it. It is always funny, and it is theirs.

**Teacups.** Each room awards up to three: cleared · under the ink par · no hints. Costs nothing to build and gives a reason to replay.

**Must ship: Rooms 1–3.** They are a complete arc — learn to draw, learn to name, solve the book's own puzzle — and they are the demo. Then 4, 5, 6, Tea Party, in that order.

## 8. Look, sound, feel

- **A yellowed book page.** Room art in black ink, Tenniel-ish, drawn by whoever on the team draws best. The player's ink is blue fountain pen — always visibly *theirs* on top of the printed world.
- **The rabbit hole is torn through the paper.** Dropping a room is falling through a ragged hole to the page beneath. Earlier pages peek through at the edges.
- **Alice and the Rabbit** are two-frame flipbook doodles. The Cat is a grin that fades in before the rest of him.
- **When ink wakes up** it shivers and takes a tint — pink for bouncy, gold for grow, and so on. That shimmer *is* the AI latency, turned into a beat.
- **Sound:** pen scratch while drawing, paper rustle on transitions, a music box underneath. The Cat's voice is the only speech.

## 9. The demo

Two minutes. The judge holds the mouse — or stands at the cabinet.

1. Riverbank. Rabbit hops the ditch and vanishes down the hole. Alice stops at the edge: too wide to hop. **"She can't fly. Draw."** A scribbled line; she crosses; she falls — slowly — through the torn page. Title: **Kami**.
2. A ledge too high, too little ink. The judge draws a blob. The Cat: *"And what is that supposed to be?"* Judge: *"A bouncy mushroom."* — *"If you say so."* It shivers pink. She bounces up.
3. The Hall of Doors. The judge gets stuck and asks the Cat out loud. He answers in a riddle. Cake, key, bottle, door.
4. **"That drawing was terrible and it didn't matter. It saw it, it heard you, and it made it true — in physics."**

**Booth mode:** number keys jump to any room; one key resets everything for the next judge; an attract loop plays the Rabbit's run when idle.

## 10. Where the AI actually is

Judges will ask. Three honest answers:

1. **It sees.** A vision model reads a bad drawing *in context* — a blob under a ledge is probably a mushroom — and offers guesses.
2. **It listens and speaks.** Deepgram both ways: your voice in, the Cat's voice out.
3. **It reasons within rules.** It maps anything you say onto a small set of natures, scales them by your adjectives, refuses in character what the game forbids, and phrases authored hints around what you've actually tried. In the Tea Party it goes further: it compiles a spoken behavior into a tiny program that then runs with no AI at all.

What it never does: generate art, control Alice, or sit in the frame loop. Ink is solid before the AI has even answered.

## 11. The cabinet

Full detail in `hardware.md`. A monitor and one panel, no mouse, no keyboard, on the Arduino UNO R4 WiFi we already hold:

- **Arcade stick** walks Alice.
- **Two knobs are an Etch A Sketch.** Left is X, right is Y. Nobody can draw on one — so nobody has to apologize, and naming the result is the punchline.
- **INK** toggles the pen. **CAT** is hold-to-talk.
- **LED strip around the monitor** is the ink meter, draining as you draw; it turns to pink-and-purple Cheshire stripes while the Cat speaks, and a pulse falls down it when Alice drops a page. The board's built-in LED matrix shows his grin.

Still needed from the desk: a breadboard, a USB-C data cable, a way onto the stick's spade tabs, ideally two real pushbuttons and knob caps, a headset mic. The game never depends on the cabinet; the mouse always works.

## 12. Scope

| Tier | Contents |
|---|---|
| **Floor** — a complete, themed, AI-load-bearing game | Rooms 1–3 · natures · the Cat in captions with the hint ladder · typed names and guess chips · ink meter, erase, bullet-time, no death |
| **Target** — what we expect to show | Voice both ways · adjectives · Rooms 4–5 · teacups · torn-page transitions and sound · the cabinet with ink-meter LEDs · booth mode |
| **Stretch** | Enchantments + the Mad Tea Party · Room 6 + the ending flip-through · trace-over guides · Cat stripes / fall pulse on the strip · "how others solved this page" gallery · the Queen's RFID cards |

**Cut from the top of this list:** gallery → RFID → LED effects beyond the ink meter → trace-over guides → Room 6 and ending → Tea Party and enchantments → Room 5 → Room 4 → the Cat's spoken voice (captions remain) → cabinet knobs, then stick → voice input (chips and typing remain). **Never cut the floor.**

## 13. Schedule

Four lanes: **sim** (physics, Alice, ink) · **Cat** (vision, voice, hints) · **pages** (room art, rendering, UI, sound) · **cabinet**. Every block ends at a gate; a failed gate is fixed before anything new starts.

| Hours | Gate — what must be true |
|---|---|
| **0–2** | In a room loaded from a drawing, you draw a line across a gap and walk Alice over it. The cabinet's stick and knobs print values in a browser tab. |
| **2–6** | Rooms 1 → 2 play end to end. A scribble named "bouncy mushroom" — typed or via chip — bounces Alice. *Demoable from here on.* |
| **6–10** | Room 3 is solvable the book's way, and the Cat talks a stuck player through it **by voice**. *This is the demo script.* |
| **10–14** | Rooms 1–4 straight through with no dev tools. Adjectives work. A full room can be cleared on the cabinet alone. |
| **14–17** | Room 5. Teacups, transitions, sound. Stretch items only if every gate above is green. |
| **17–20** | **Playtest, everyone.** Five strangers, no coaching, watch in silence. Note where they stall, what they name things, how they cheat. Tune ink budgets, hints, and the Cat's lines. |
| **20–22** | Rehearse the demo five times against a timer. Record a backup video. Write the submission. |
| **22–24** | Freeze. Bug fixes only. |

Everyone sleeps at least three hours, staggered through hours 12–19.

## 14. Risks

| Risk | Answer |
|---|---|
| The AI misreads a drawing | Your word wins; chips offer three guesses; surroundings are part of what it sees. A wrong guess is a joke, not a bug. |
| The hall is too loud for voice | Hold-to-talk, headset mic, chips and typing always on screen. |
| AI latency breaks the flow | Ink is solid instantly. The shimmer when it wakes up makes the wait part of the magic. |
| A room is too hard | The third hint is the answer. |
| A room is trivially cheated | Ink budgets, glass, red paint, per-room nature lists — tuned from watching real players, not guessed. |
| Naming makes shape irrelevant | The name gives the spirit, the shape gives the body (§3). A one-pixel trampoline is a bad trampoline. |
| Enchantments eat the day | They're stretch, and fenced into the Tea Party. |
| The cabinet half-works at hour 20 | Cut it. A laptop that fully works beats a cabinet that doesn't. |
| Scope creep | New ideas go to the top of the cut list, not into the build. |

## 15. Tracks

**Entertainment** — main. **Deepgram** — the ears and mouth of a character, the strongest sponsor fit we have. **Arduino / hardware** — the cabinet runs on the UNO R4 WiFi. **MongoDB** — only if trace-over guides get built on Quick, Draw! data. Everything else: not pursued.

## 16. Open questions

1. Who draws the room art — and can they have Rooms 1–3 sketched by hour 4?
2. Can we borrow a stylus or touchscreen for the laptop station?
3. How many of us are there, and does one person own the cabinet end to end?
4. Does the Cat get one voice for the whole game, picked by hour 8, so nobody fiddles with it at hour 20?

---

*Keep re-reading: Alice can hop, not fly. You can draw. It is what you say it is.*
