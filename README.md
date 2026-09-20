# Kami

**HackMIT 2026 · Alice in Wonderland · Entertainment track**

> Alice can hop, not fly. You can draw.
> Draw it. Name it. It wakes up.

*Kami* (紙) is paper; *kami* (神) is the spirit in a thing. A hand-drawn puzzle-platformer down the rabbit hole: what you draw becomes solid ink, and becomes whatever you say it is. The Cheshire Cat listens, talks back, and helps when you're stuck. The software demo supports mouse, keyboard and touch. The cabinet remains a partial integration; knob drawing and full physical acceptance are not complete.

## Play the software demo

One endless whiteboard. **Sketch** and the ink is solid. **Write a note beside a sketch** and it *is* that thing — *a bouncy mushroom*, *ground*, *goal*, *lava*. **Write a law** — *set g equal to the moon's gravity*, *no friction*, *wind blows right*, *slow motion* — and the world obeys. Known laws take priority over nearby naming; model compilation is the last fallback. Kami answers in his own handwriting. MongoDB remembers saved drawings, notes and laws; the board menu reports unsaved edits. Touch gestures and Pencil Scribble are supported by the input code, with physical tablet verification still required.

```bash
bun install
bun run quickdraw:ingest   # once: teaches Kami to recognise sketches from Google's Quick, Draw! set
bun run dev                # web on :5173 + API/MongoDB on :8787
```

Open the printed **Network** URL on an iPad on the same trusted Wi-Fi (landscape; *Share → Add to Home Screen* for full-screen). On a laptop: mouse draws, arrow keys walk, `D` `T` `E` `H` pick draw / write / erase / pan, Space holds CAT speech input, wheel pans, pinch or ctrl-wheel zooms. Voice requires a secure browser context and the server's Deepgram configuration. See [deployment/security status](docs/architecture.md#deployment-and-security-status) before network use.

- **The Alice demo** is the `wonderland` board: bridge the ditch → get up the ledge (*a bouncy mushroom*, *a ladder*, *a cloud* — or just write *g = moon* and see what that does to a bounce) → *a cake* to grow and take the key, *drink me* to shrink through the tiny door → the rabbit hole. Stuck? Write *help*.
- **A new game** is a blank board: board menu → *new board* (or `?board=anything`). Sketch ground and write *ground*; sketch a flag and write *goal*; add *lava*, *start here*, a few laws of physics. It saves as you go.

`MONGODB_URI` points the server at Atlas; without it a real `mongod` is run for you with its data in `.kami-data/`. `KAMI_LLM_URL` + `KAMI_LLM_MODEL` (any OpenAI-compatible endpoint — e.g. a model served from the ASUS Ascent GX10) lets a model compile the laws the offline grammar can't; it is asked once per rule, never in the frame loop. Details: [`server/README.md`](server/README.md).

`bun run check` is the gate: typecheck, lint, tests — including a headless playthrough of the whole Wonderland board and of a game made from scratch. How it fits together: [`docs/architecture.md`](docs/architecture.md).

## Read these

| Doc | What |
|---|---|
| [`docs/spec.md`](docs/spec.md) | **The spec. Source of truth for what Kami is** — pillars, mechanics, rulings, the Cat, the rooms, demo, scope, schedule. No code. |
| [`docs/architecture.md`](docs/architecture.md) | **Current integration guide:** implementation, ownership, API/model contracts, security status and verification limits. |
| [`docs/hardware.md`](docs/hardware.md) | Cabinet design and bring-up reference; [current path and pending R19 integration](docs/architecture.md#controllers-and-voice) take precedence over its browser Web Serial proposal. |
| [`docs/engineering-notes.md`](docs/engineering-notes.md) | Pointer to archived design experiments; not a build plan. |
| [`hardware/cabinet/cabinet.ino`](hardware/cabinet/cabinet.ino) | UNO R4 WiFi firmware; [R19](https://github.com/SnowballSH/kami/pull/41) adds a verified build and server adapter, without claiming physical readiness. |

`docs/archive/` is history: the original "Paper" ideation doc, its review, plan v2, and plan v3 ("Curiouser"). **Don't build from the archive.**

## House rules

- The four pillars in spec §2 settle feature arguments.
- Every schedule block ends at a gate. A failed gate gets fixed before anything new starts.
- New idea → top of the cut list (spec §12), not into the build.
