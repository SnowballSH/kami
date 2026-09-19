# Kami

**HackMIT 2026 · Alice in Wonderland · Entertainment track**

> Alice can't jump. You can draw.
> Draw it. Name it. It wakes up.

*Kami* (紙) is paper; *kami* (神) is the spirit in a thing. A hand-drawn puzzle-platformer down the rabbit hole: what you draw becomes solid ink, and becomes whatever you say it is. The Cheshire Cat listens, talks back, and helps when you're stuck. Playable on a laptop, or on the cabinet — arcade stick to walk, two Etch A Sketch knobs to draw.

## Play the software demo

A proof of concept of Rooms 1–3 — draw, name, watch it wake up — that runs in any browser and is built for an iPad (finger or Apple Pencil draws, the on-screen d-pad walks, guess chips name things). No network or API keys: the Cat is an offline stand-in behind the same interface the real model will use.

```bash
bun install
bun run dev
```

Open the printed **Network** URL on an iPad on the same Wi-Fi (landscape; *Share → Add to Home Screen* makes it full-screen). On a laptop: mouse draws, arrow keys / WASD walk, `1`–`3` jump to a room, `0` resets for the next player.

| Room | Try |
|---|---|
| The Riverbank | Draw a line across the ditch, touching both banks. |
| The Shelves | Draw a blob by the bookcase → *a bouncy mushroom*. Or a tall line → *a ladder*. Or a platform → *a cloud*. |
| The Hall of Doors | *A cake* → grow → key. *Drink me* → shrink → door. Order matters. |

`bun run check` is the gate: typecheck, lint, tests — including a headless playthrough of all three rooms. How it fits together: [`docs/architecture.md`](docs/architecture.md).

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
