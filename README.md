# Kami

**HackMIT 2026 · Alice in Wonderland · Entertainment track**

> Alice can't jump. You can draw.
> Draw it. Name it. It wakes up.

*Kami* (紙) is paper; *kami* (神) is the spirit in a thing. A hand-drawn puzzle-platformer down the rabbit hole: what you draw becomes solid ink, and becomes whatever you say it is. The Cheshire Cat listens, talks back, and helps when you're stuck. Playable on a laptop, or on the cabinet — arcade stick to walk, two Etch A Sketch knobs to draw.

## Play the software demo

One endless whiteboard. **Sketch** and the ink is solid. **Write a note beside a sketch** and it *is* that thing — *a bouncy mushroom*, *ground*, *goal*, *lava*. **Write a law anywhere else** — *set g equal to the moon's gravity*, *no friction*, *wind blows right*, *slow motion* — and the world obeys. Kami answers in his own handwriting, on the board. Everything is remembered in MongoDB. Built for an iPad: finger or Apple Pencil draws, two fingers pan and pinch, the d-pad walks Alice, and the write tool takes typing or Pencil Scribble.

```bash
bun install
bun run quickdraw:ingest   # once: teaches Kami to recognise sketches from Google's Quick, Draw! set
bun run dev                # web on :5173 + API/MongoDB on :8787
```

Open the printed **Network** URL on an iPad on the same Wi-Fi (landscape; *Share → Add to Home Screen* for full-screen). On a laptop: mouse draws, arrows / WASD walk, `D` `T` `E` `H` pick draw / write / erase / pan, wheel pans, pinch or ctrl-wheel zooms.

- **The Alice demo** is the `wonderland` board: bridge the ditch → get up the ledge (*a bouncy mushroom*, *a ladder*, *a cloud* — or just write *g = moon* and see what that does to a bounce) → *a cake* to grow and take the key, *drink me* to shrink through the tiny door → the rabbit hole. Stuck? Write *help*.
- **A new game** is a blank board: board menu → *new board* (or `?board=anything`). Sketch ground and write *ground*; sketch a flag and write *goal*; add *lava*, *start here*, a few laws of physics. It saves as you go.

`MONGODB_URI` points the server at Atlas; without it a real `mongod` is run for you with its data in `.kami-data/`. `KAMI_LLM_URL` + `KAMI_LLM_MODEL` (any OpenAI-compatible endpoint — e.g. a model served from the ASUS Ascent GX10) lets a model compile the laws the offline grammar can't; it is asked once per rule, never in the frame loop. Details: [`server/README.md`](server/README.md).

`bun run check` is the gate: typecheck, lint, tests — including a headless playthrough of the whole Wonderland board and of a game made from scratch. How it fits together: [`docs/architecture.md`](docs/architecture.md).

## Read these

| Doc | What |
|---|---|
| [`docs/spec.md`](docs/spec.md) | **The spec. Source of truth for what Kami is** — pillars, mechanics, rulings, the Cat, the rooms, demo, scope, schedule. No code. |
| [`docs/hardware.md`](docs/hardware.md) | The cabinet: parts status, what's still missing, wiring, serial protocol, bring-up steps. |
| [`docs/architecture.md`](docs/architecture.md) | How the software demo is actually built: modules, contracts, the numbers that must agree. |
| [`docs/engineering-notes.md`](docs/engineering-notes.md) | How to build it, for when we get there: architecture, tested physics snippets, level-file conventions, agent tools, eval prompts. |
| [`hardware/cabinet/cabinet.ino`](hardware/cabinet/cabinet.ino) | UNO R4 WiFi firmware draft. Not yet compiled. |

`docs/archive/` is history: the original "Paper" ideation doc, its review, plan v2, and plan v3 ("Curiouser"). **Don't build from the archive.**

## House rules

- The four pillars in spec §2 settle feature arguments.
- Every schedule block ends at a gate. A failed gate gets fixed before anything new starts.
- New idea → top of the cut list (spec §12), not into the build.
