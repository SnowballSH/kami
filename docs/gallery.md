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

### puzzle-01-wall-open-after.png — room 1, first frame, after the fix
- **Shows:** the room card alone; the Sumikui stirs quietly behind Alice (grey, biding) instead of hunting.
- **Fixed:** a room's ink-eater law folded at entry bides until the first drawing (`Simulation.underway`); the
  wordmark/tagline are no longer handwritten in Puzzle/Boss; flee/stuck lines have a calm window; ≤ 2 Kami remarks.
- **Still wrong:** the handwritten room intro is written exactly where the DOM room card sits, so the two overlap for the
  card's lifetime. → fix: hold Kami's opening lines until the room card has left (or write them below it).

### puzzle-01-wall-first-ink-after.png / puzzle-01-wall-line-eaten-after.png — first drawing wakes it
- **Shows:** a flat line at Alice's feet; the Sumikui wakes ("It smells ink…"), goes for the line, and chews it
  (particles, "Gone. It drank that line to the last drop."). Alice is left alone for the first 20 s awake.
- **Wrong:** guess chips ("a trampoline? a mushroom? a ball?") are laid out downward over the ground hatch and under the
  tidiness slider — they should stay above the ground line, on the paper.

### puzzle-01-wall-note-clipped.png — 24 s
- **Wrong:** Kami's lines are written at the spawn column regardless of the camera, and run off the right edge
  ("Draw her somewher…"). Notes need to be laid out inside the visible viewport (shift left, or wrap earlier).
- **Wrong:** Kami says "She sees it. She runs." but Alice stood still for the next 10 s with the eater on her.
  → check the pilot's flee route on a flat one-way room (nothing to flee *to* → cornered, so she should at least
  keep walking away).

### puzzle-01-wall-30s-caught.png — 34 s
- **Shows:** grace over (20 s awake) — it bites the ground under her / swallows her. Intended stakes; fair now that the
  player had 20 s and a wake line first.

## Boss

Scripted the drawer's side over CDP: open `?mode=boss`, draw a stick figure around the heart, write `alice`,
then hold the keys for the player's side while the servant comes.

### boss-open-before.png / boss-named-before.png / boss-fight-before.png — as found
- **Expected**: a quiet opening (card, heart, one hint), then a body the game accepts, then a readable fight.
- **Observed**: both role paragraphs handwritten across the upper playfield under the mode card; the health bar
  sitting on the toolbar; "Only a heart, so far…" clipped at the right edge; after naming, three more lines
  stacked on top of the role text; the drawn body was offered as "a mushroom? a cake? a cloud?" unless the
  name was written touching it; an incarnated Alice with natural legs could not walk (legs read as torso/arms);
  by 10 s legs, arms and head were gone; one cut removed every stroke it crossed; the Wonderland zone intro
  ("She can hop, not fly") appeared in Boss; drawings from the previous fight came back on restart.
- **Fixed**: roles are bullets on the card, not notes; health bar below the toolbar; free notes clamp to the
  viewport and keep clear of the tear and the top strip; the opening recital waits for the card to fade; a
  nameless drawing near the soul is offered as `Alice?` ("Is this her? Write who she is.") and `alice` written
  anywhere names the drawing nearest the soul; parts are read relative to the torso (arms beside, legs below,
  head/wings above), so a stick figure walks, climbs and sees; a snip only takes the part it aimed at; first
  circle 4.8 s, circle 3.4 s, 3.2 s mercy after a hit; Boss skips the zone intro and starts on a fresh page.

### boss-01-open-after.png → boss-10-fight-35s-after.png — the fight after the fixes, one frame per beat
- `01-open`: card + hovering heart, nothing else on the page. `03-body-drawn`/`04-named`: the figure, the
  `Alice?` chip, incarnation, the missing-part line if any. `05-tear`/`06-servant`: the tear opens above her,
  the recital arrives one line at a time. `07-fight-10s`: first snip ("It took her legs… draw them back,
  quickly."), servant recovering. `08a-walking`: player steering with keys on the remaining body.
  `08c-redrawn`: drawer's strokes graft onto the body (glow) instead of becoming "a plank?". `09-fight-25s`:
  torso cut, dusk veil from the tear. `10-fight-35s`: heart cut → "Missed…"/restart, page clean.
- **Still to polish** (C-items below): `09` says "Her wings, gone" for a body that never had wings — arm
  strokes were read as wings (fixed in `f65db4c`, not yet re-shot); the redraw strokes render in the
  highlight blue, which reads as "selected" rather than "ink becoming her"; no run has reached a win yet
  (the weapon needs a drawn stroke to be swung through the servant — untested here); the two-player split
  (one device draws, one steers) is not exercised by the script.

## Vehicles

Scripted in Sandbox on a fresh board: draw a box car with two wheels beside Alice, write `a car`, hold ← until she
boards and drives off the ledge.

### vehicle-01.png → vehicle-08-after.png
- **Expected**: Alice hops in and sits; the car drives; off the ledge it tumbles like a thrown box; she comes back.
- **Observed before**: the car never tilted (upright creature strategy) and Alice stood beside/over it; a parked
  car sat crooked while she climbed on; off the ledge she fell through blank page for ~4 s with no word from
  Kami and the car was gone for good.
- **Fixed**: vehicles have their own nature (`upright: false`): they roll, tip and flip (`05`, `07`); a gentle
  keel only rights small grounded tilts and yields to "the car spins"; Alice hops aboard (`01`) and sinks into
  the seat, the car is painted over her lower body (`03`); the fall limit is 900 px and the car she was in
  returns with her, level (`08-after`); Kami says "Off the edge of the page…".
- **Still to polish**: a closed box car has no cabin, so a seated Alice reads as "standing on the roof" — an
  open-top car (or hiding her legs inside the outline) would sell the pose; the respawn is the very last
  footing, right at the ledge, so the car lands half over the edge; the "Off the edge" line was not on screen in
  `08-after` (may have faded with the note cap — check timing).

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
- [x] C1 Heart, draw body, name `alice` → incarnation, ability readout · [x] C2 Tear + servant arrival timing/text
- [x] C3 Wind-up telegraph readable, dodge works with keys · [x] C4 Snip → part gone, ability lost, line once
- [~] C5 Redraw/graft (grafts; glow colour to revisit) · [~] C6 Shield with a drawing (one stroke blocked a cut) · [ ] C7 Weapon hit, health bar, waves
- [ ] C8 Win: tear closes · [x] C9 Loss: heart cut → restart clean (fresh page, no zone intro) · [ ] C10 Camera framing, thumbstick dodge

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
