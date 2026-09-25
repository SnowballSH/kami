# Kami — Agent Guidelines

`docs/spec.md` is the source of truth for what Kami is. `docs/architecture.md` explains how the software demo is put together.

## Code and Technology Guidelines

* At most 4 subagents at any time. Use Sonnet 5 for boring (i.e. verification) tasks, Opus 5.5 for hard (i.e. large engineering or design) tasks.

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

The ASUS GX10 was available only at the hackathon; it is no longer a required or available service.
Local model inference, ML tests and data preparation are allowed. Choose models and concurrency that
fit the current computer's memory and compute capacity, and verify latency through the game's API.
Keep model downloads, generated datasets and machine-specific configuration out of version control.
Large training runs remain a separate task: do not start one just to set up or run the game.

GX10 deployment scripts and historical measurements remain useful reference material, but their
hostnames, paths and compute restrictions are not requirements for local development.

## The client–server seam

The browser game (`src/`) and the API server (`server/`) meet at the HTTP API (`server/README.md` →
"API contract") and `src/rules/types.ts`. Nothing in `src/` imports `server/`; the browser reaches it only
through the thin clients in `src/persistence` and `src/recognition`. The server mirrors `RuleEffect` with a
zod schema that fails the typecheck when the two drift, on purpose: a change to `RuleEffect` updates
`server/schemas.ts`, `server/compile/effectRanges.ts` and the model prompt in the same change. Changes to
the API are additive; anything else is called out in the commit or PR description.

Hosting (the container image, compose, environment variables) is documented in `docs/hosting.md`.

## Git

- The remote is `origin` → `github.com/SnowballSH/kami`. Work happens on `main` unless told otherwise.
- Commit in small, working increments and **push to `origin` frequently** — after every passing gate (`bun run check`), and at least once per finished feature or fix. Unpushed work should never outlive a work session.
- Never commit secrets, `node_modules/`, or build output.

## Commands

| Command | What |
|---|---|
| `bun install` | Install dependencies |
| `bun run dev` | Web (:5173, on the LAN — open the printed Network URL on the iPad) + API/MongoDB server (:8787) |
| `podman build -t kami .` | The self-hostable image (`docs/hosting.md`) |
| `bun run quickdraw:ingest` | Once: load Quick, Draw! samples into MongoDB so Kami can recognise sketches (restart the server after) |
| `bun run font:build` | Regenerate the handwriting stroke font from `hersheytext` |
| `bun run check` | Typecheck + lint + tests — the gate before every push |
| `bun run format` | Auto-format and apply safe lint fixes |
| `bun run build` | Production build to `dist/` |
