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

## Git

- The remote is `origin` → `github.com/SnowballSH/kami`. Work happens on `main` unless told otherwise.
- Commit in small, working increments and **push to `origin` frequently** — after every passing gate (`bun run check`), and at least once per finished feature or fix. Unpushed work should never outlive a work session.
- Never commit secrets, `node_modules/`, or build output.

## Commands

| Command | What |
|---|---|
| `bun install` | Install dependencies |
| `bun run dev` | Dev server on the LAN (open the printed Network URL on the iPad) |
| `bun run check` | Typecheck + lint + tests — the gate before every push |
| `bun run format` | Auto-format and apply safe lint fixes |
| `bun run build` | Production build to `dist/` |
