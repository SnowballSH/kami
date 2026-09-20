# Gameplay gallery — UX sweep

Screenshots taken in the browser against the local dev stack (`bun run dev`, 1600×1200 window), one entry per scenario.
`-before` shots show the problem as found; `-after` shots show the fix. Every entry lists what it demonstrates,
what was wrong, what was fixed and what still needs polish. Branch: `devin/ux-sweep`.

## Puzzle

### puzzle-01-wall-open-before.png — Puzzle room 1 ("The Wall"), first frame
- **Shows:** room entry with `?mode=puzzle`.
- **Wrong:** the title card sits on top of four handwritten Kami lines (wordmark, tagline, the Sumikui's waking line, and the
  room intro written a second time by hand); the Sumikui is already loose beside Alice before the player has drawn anything.
- **Status:** fixing — the ink eater should wake only after the player's first drawing, and the room card should be the only
  text on screen at entry.

### puzzle-01-wall-8s-before.png — same room, 8 s later, no input
- **Shows:** Alice fleeing the Sumikui under autopilot.
- **Wrong:** Kami writes "Look at her go. Fear is a fine teacher." / "It is on her heels…" ~12 times in 8 s; the flee
  news fires every time the pilot replans. Notes stack on top of each other and cover Alice.
- **Status:** fixing — one remark per dread episode, and Kami keeps at most two remarks on screen (the older one leaves).
