# Kami

**HackMIT 2026 · Alice in Wonderland · Entertainment track**

> Alice can't jump. You can draw.
> Draw it. Name it. It wakes up.

*Kami* (紙) is paper; *kami* (神) is the spirit in a thing. A hand-drawn puzzle-platformer down the rabbit hole: what you draw becomes solid ink, and becomes whatever you say it is. The Cheshire Cat listens, talks back, and helps when you're stuck. Playable on a laptop, or on the cabinet — arcade stick to walk, two Etch A Sketch knobs to draw.

## Read these

| Doc | What |
|---|---|
| [`docs/spec.md`](docs/spec.md) | **The spec. Source of truth for what Kami is** — pillars, mechanics, rulings, the Cat, the rooms, demo, scope, schedule. No code. |
| [`docs/hardware.md`](docs/hardware.md) | The cabinet: parts status, what's still missing, wiring, serial protocol, bring-up steps. |
| [`docs/engineering-notes.md`](docs/engineering-notes.md) | How to build it, for when we get there: architecture, tested physics snippets, level-file conventions, agent tools, eval prompts. |
| [`hardware/cabinet/cabinet.ino`](hardware/cabinet/cabinet.ino) | UNO R4 WiFi firmware draft. Not yet compiled. |

`docs/archive/` is history: the original "Paper" ideation doc, its review, plan v2, and plan v3 ("Curiouser"). **Don't build from the archive.**

## House rules

- The four pillars in spec §2 settle feature arguments.
- Every schedule block ends at a gate. A failed gate gets fixed before anything new starts.
- New idea → top of the cut list (spec §12), not into the build.
