# Kami — Agent Guidelines

`docs/spec.md` is the source of truth for what Kami is. `docs/architecture.md` explains how the software demo is put together.

## Code and Technology Guidelines

* At most 4 subagents at any time. Use Sonnet 5 for boring (i.e. verification) tasks, Fable 5.1 for hard (i.e. large engineering or design) tasks.

- Prefer well-known libraries over lesser-known Github repos for dependencies.
- Prefer well-maintained open-source projects
- Code should be self-documenting. That is, you should not need to, and you should not, write comments explaining your code. Only do so for very non-trivial logic for certain lines. Any complicated overall design choice or logic should be documented in a markdown file instead.
- Prefer the latest version of all technologies (frameworks, languages, etc.).
- Use modern language features and practices.
- Format, lint, and test your code.
- Use good software engineering patterns, including OOP, abstractions, strict typing and contracts, write & review contracts/interfaces before implementation, concise functional programming whenever needed.
- Avoid "hacky" one-time fixes and write long-term solutions instead.
- Separate files into directories in meaningful ways. Separate logic into helper functions in meaningful ways. Use concise but meaningful variable and function names.

## Where computation happens

**All training, all model inference and all heavy computation run on the ASUS GX10 — never on a laptop,
not even a smoke test.** The box is `ssh gx10` (key login, passwordless sudo, NVIDIA GB10, 121 GB, CUDA 13,
internet). The game lives in `~/kami` there (`box/start.sh`, `box/status.sh`); Python/ML work goes in
`~/kami-ml` with `uv`. The Mac is for editing, unit tests and builds. To try ML code: copy `ml/` to the box
and run it there. Ollama on the box holds ~37 GB for `qwen3.8`; leave it running.

## Who owns what

Two agents work on this repo in parallel. Stay on your side of the seam; cross it only by agreement.

| Owner | Paths |
|---|---|
| **Client agent** | everything under `src/` — game, autopilot, sim, render, ui, ink, cat, handwriting, board, and `src/rules` (the offline grammar and its types) — except the two thin HTTP clients below |
| **Server agent** | `server/`, `scripts/` (deploy, the GX10), `src/persistence`, `src/recognition`, the trained models, and the server sections of the docs |

The seam is the HTTP API (`server/README.md` → "API contract") and `src/rules/types.ts`. The server mirrors
`RuleEffect` with a zod schema that fails the typecheck when the two drift, on purpose: a change to
`RuleEffect` updates `server/schemas.ts` and `server/compile/effectRanges.ts` in the same PR (the minimal
mirror), says so in the PR description, and the server agent follows with the model prompt. Changes to the
API are additive, or announced here first.

## Git

- The remote is `origin` → `github.com/SnowballSH/kami`. Work happens on `main` unless told otherwise.
- Commit in small, working increments and **push to `origin` frequently** — after every passing gate (`bun run check`), and at least once per finished feature or fix. Unpushed work should never outlive a work session.
- Never commit secrets, `node_modules/`, or build output.

## Commands

| Command | What |
|---|---|
| `bun install` | Install dependencies |
| `bun run dev` | Web (:5173, on the LAN — open the printed Network URL on the iPad) + API/MongoDB server (:8787) |
| `bun run quickdraw:ingest` | Once: load Quick, Draw! samples into MongoDB so Kami can recognise sketches (restart the server after) |
| `bun run font:build` | Regenerate the handwriting stroke font from `hersheytext` |
| `bun run check` | Typecheck + lint + tests — the gate before every push |
| `bun run format` | Auto-format and apply safe lint fixes |
| `bun run build` | Production build to `dist/` |
