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

## Sweep plan — every mode × every feature × the edge cases

Checked as I go; each item gets a screenshot (or a note why not). Edge cases looked for on every item:
text spam / duplicate lines, notes stacking or covering Alice/HUD/walls, intro + threat text at the same time, lines
that never fade, cascades from one event, threats before the first player action, stuck/flee/cornered repeating on
every replan, dead buttons, controls that work in one mode only, camera not following, wrong poses, snapping
transitions, physics changed by presentation, stale state after respawn/room change, room card over live play.

### A. Start & modes
- [ ] A1 Start screen (three choices, `?mode=` bypass, other params kept)
- [ ] A2 Sandbox entry: card, wordmark/tagline, no ink eater, `summon the ink eater` refused politely
- [ ] A3 Puzzle entry: card only, no Sumikui before the first drawing, no repeated flee lines
- [ ] A4 Boss entry: heart alone, roles readable, no Alice/autopilot text, nothing arrives before naming

### B. Puzzle rooms (each: entry, solve, closing line, transition, room card timing, Sumikui pressure)
- [ ] B1 The Wall (spring) · B2 Keyhole (bottle/`alice is tiny`) · B3 Moon Ledge (`low gravity`) · B4 Dark Hall (lantern)
- [ ] B5 Twin Doors (portals) · B6 Shaft (`alice can fly`) · B7 Pit (spring + low gravity) · B8 after room 7
- [ ] B9 Forbidden law in a room (`Not in this game…` once, not per frame) · B10 Alice eaten in a room → respawn clean

### C. Boss (two-player)
- [ ] C1 Heart, draw body, name `alice` → incarnation, ability readout · C2 Tear + servant arrival timing/text
- [ ] C3 Wind-up telegraph readable, dodge works with keys/thumbstick · C4 Snip → part gone, ability lost, line once
- [ ] C5 Redraw/graft glow, ability back · C6 Shield with a drawing · C7 Weapon hit, health bar, waves
- [ ] C8 Win: tear closes · C9 Loss: heart cut → restart clean (no stale notes/laws/servant) · C10 Camera framing

### D. Drawing & ink
- [ ] D1 Solid stroke platform · D2 Scenery (non load-bearing) strokes walk-through · D3 Erase · D4 Placement refusals
- [ ] D5 Naming beside a drawing vs bare noun summon · D6 Guess chips tap-to-name · D7 Clear board (double tap)

### E. Alice
- [ ] E1 Autopilot to goal · E2 Manual keys/thumbstick override + return · E3 Jump · E4 Stuck line once
- [ ] E5 Size laws (headroom) · E6 Fly · E7 Speed · E8 Clones (independent) · E9 Twin select · E10 Night + lantern

### F. Vehicles & creatures
- [ ] F1 Board a car: hop-in + seated pose (user report: Alice not in car) · F2 Drive · F3 Car tips/flips rendered (user report: no flip)
- [ ] F4 Dismount by jump · F5 Boat · F6 Walker/hopper/flier alive · F7 Ride a creature (astride) · F8 Follow/flee
- [ ] F9 `the cat chases me` law · F10 Creature powers (`the dog can fly`) · F11 Portals pair + lonely portal

### G. Laws & world
- [ ] G1 Gravity (`low gravity`, `gravity points left`) · G2 Time · G3 Friction/bounce/wind/drag · G4 Repeal by erase & by panel
- [ ] G5 Laws panel after note fades · G6 Spin/thrust/mass on a drawing · G7 `everything spins` · G8 Tilt world 90° (pointer mapping, HUD)
- [ ] G9 World spins slowly · G10 Reset words (`normal gravity`) · G11 Unknown law shrug (once) · G12 Model-only path (untested tonight)

### H. Summons & scenes
- [ ] H1 `summon a rabbit` · H2 Summon unknown word · H3 `teleport us to the moon` (props, gravity, gloss) · H4 `back home`
- [ ] H5 Scene + Sumikui/autopilot interplay · H6 Unknown scene line

### I. Sumikui
- [ ] I1 Summon lore pacing (3 lines, not on top of each other) · I2 Chase speed fair · I3 Eats a drawing stroke-by-stroke, size-scaled
- [ ] I4 Particles · I5 Bites paper under Alice, heals · I6 Eats Alice → respawn, one line · I7 Ignores/sweeps scribbles
- [ ] I8 Spares scenery/named? · I9 Banish · I10 Autopilot flees/races, cornered once

### J. HUD & text
- [ ] J1 Wordmark/tagline placement · J2 Guess/hint/remark lifetimes · J3 Overlap avoidance under load · J4 Room/title card vs live play
- [ ] J5 Zoom/back-to-Alice/autopilot toggle · J6 Tidy slider · J7 Talk button feedback (deaf line locally) · J8 Persistence status
- [ ] J9 Share panel (sandbox) · J10 Small window / touch layout
