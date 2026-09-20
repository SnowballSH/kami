# Boss mode

Two players at one board. One holds the pen; the other holds the keys (or the on-screen thumbstick, or the Arduino joystick — [controllers.md](controllers.md)). The room opens with nobody on it: a small blue heart pulsing at the spawn. The drawer draws a body around it and names it — *alice*, *me*, *a knight*, *my cat*, any body noun — and the strokes become the body. Then the page tears open above the heart and something comes through to snip the body apart, one part at a time. The drawer redraws what is snipped; the player dodges and swings whatever the drawer arms them with. Hurt it until the tear closes.

`?mode=boss`. The mode is `BOSS_MODE` in `src/modes/modes.ts`, built on the spirit groundwork described in [modes.md](modes.md). Everything below is client-side (`src/sim/body`, `src/sim/boss`, `src/modes/spiritDirector.ts`, `src/render/bossPainter.ts`, `src/game/bossLines.ts`).

## Lore

Kami is the paper. Long ago the one under the page tore it; the Sumikui, the ink eater, is one shard of that thing that came through and was bound by what is written. This servant is another shard, sent through a fresh tear, and it is not bound: it does not eat ink, it *cuts* it. Kami is frightened of it and says so; he is proud of the two who face it, and says that too (`src/game/bossLines.ts`).

## The body (`src/sim/body/drawnBody.ts`)

The drawing's own strokes are the body. Nothing is generated; the strokes stay authoritative for physics (the `AliceController` is built from their bounds), for cutting and for painting (`paintDrawnAlice` fills the very same paths). The strokes are kept in **body space** — centred on the body, scaled by the body's current `aliceSize` — so laws that grow or shrink her keep working.

```ts
interface DrawnBody {
  strokes: { stroke; part: BodyPartKind; sinceMs }[];  // sinceMs: when it was drawn on; fresh ink glows
  heart: Vec;                                          // in body space
  frame: { width; height };                            // the controller's size
  fullest: Record<BodyPartKind, number>;               // the most ink each part ever had
}
type BodyPartKind = "head" | "torso" | "arms" | "legs" | "wings";
interface Abilities { walk; jump; climb; fly; see }
```

**Segmentation** (`classifyParts`) first finds the torso strokes around the heart, then reads every other stroke relative to their bounding box: below the torso is legs; above it is wings when it is also out to the side by more than `wingsOut` (0.3 of width), otherwise head; anything beside the torso is arms. A body whose *name* is winged (*a bird*, *an angel*, *a fairy*, *a dragon*…) needs only `namedWingsOut` (0.15) to count something up-and-out as wings: a bird's wings are closer in than an angel's. If no torso is present, it falls back to the frame bands, so grafting a body back together remains possible.

**Abilities** (`abilitiesOf`): legs → walk and jump; arms → climb (and the push and grab that climbing gives); wings → fly (the `flight` law's semantics, without the law); head → see. A part is *alive* while it keeps at least `partAliveRatio` (half) of the most ink it ever had. A body with no legs still has a heart and a torso: it can be pushed and it can fall, but it cannot go anywhere by itself. A body with no head sees dimly: the renderer veils the screen edges (`paintDimVeil`).

**Snipping** (`snip`): a cut is a segment aimed at one body part, and only the strokes of that part it crosses are removed whole; other strokes it passes are spared. The heart is cut only when it is *bare* — no torso stroke left around it — and the segment passes within `heartRadius` of it; that is the loss. A cut through a heart still wrapped in a torso takes the torso, and the mercy window that follows is the drawer's chance to wrap it again.

**Grafting** (`graft`): committed strokes that come within `graftReach` (36 px) of any body stroke, or of the heart, join the body, are segmented like the rest, and glow blue for `graftGlowMs` (1.4 s) so the drawer sees the graft take. A part comes back the moment it is above its alive ratio again; the ability comes back with it, in the same tick. Redrawing fast is the whole loop, so grafting has no cost but ink and no cooldown.

Movement scales with the body: the controller is built with the drawing's frame, and `aliceSize` semantics (and their clamps) do the rest — a tall body strides and jumps further, a tiny one is quick to turn and easy to miss.

**One body, one heart.** The drawn body is Alice herself's (`ALICE_HERSELF`) and nobody else's. While the player is a soul, `sim.alices()` is empty: the `Party` hires no pilot, drives nobody, and a `clones` law makes no twins of a heart. Boss mode forbids `clones` outright; in Spirit mode, where a clone law may stand, her twins are Kami's own sketch of her (the plain `AliceLook`), not copies of the drawn strokes — the ink is authoritative for exactly one body, and cutting a copy would mean nothing. The servant's prey is her body alone; a twin falling or being eaten does not unmake her, since the heart is in her. The drawing that became her leaves the ink ledger the moment it is named, so it is never sent to Kami to be tidied and the tidiness slider never moves it: grafts join the body directly (`Game.land` → `sim.graft`) and never become drawings.

The soul hovers `SOUL_HOVER_PX` (40 px) above the heart's standing seat until a drawing gives it a body. That keeps the heart visible above the ground and leaves room for a natural body to settle onto the page under gravity.

## The servant (`src/sim/boss/snipper.ts`)

A dark folded thing with two blades for arms and one pale eye. It is a new entity, not the Sumikui, though it borrows its silhouette language (a black ink blot, a pupil that widens at what it wants) and its perishing (it shrinks and pales for `perishMs`).

Its life is a small state machine, stepped in the sim's fixed step:

```
arriving → circling → winding → lunging → recovering → circling → …
                                                     ↘ perishing → perished
```

- **arriving**: drifts from the tear to its orbit spot.
- **circling** (`circleMs`): orbits the body at `orbitRadius`, reading it.
- **winding** (`windUpMs`, 1.1 s for the servant): picks a part by `SNIP_PRIORITY` (legs, wings, arms, head, torso — what lets her run first, the bare heart last), lays down the **cut** it means to make (across the limb between the heart and the part's tip, perpendicular to it, `cutReach` times its own radius long), and freezes there with its blades opening. The renderer draws the cut as a dashed red line brightening with progress (`paintTelegraph`): the player sees exactly where the blades will close and has a second to be elsewhere; the drawer can draw something across the line.
- **lunging** (`lungeMs`): the blades snap along the cut. The cut is fixed when the wind-up began — dodging works because the cut does not follow.
- **recovering** (`recoverMs`): still, whether it hit or not.

A lunge is judged once, when the lunge ends (`Simulation.suffer`): if a drawing of the player's crosses the cut, the *drawing* is cut and the body is spared (`shielded`) — a drawn shield is a real shield, and it costs a drawing. Otherwise the body is snipped; if nothing came off, `snip-missed`.

**Speed ramp**: each landed snip multiplies its speeds by `1 + snips × speedRampPerSnip` up to `maxSpeedRamp` (1.6×). The fight quickens as the body is worn down, never faster than that.

**Hurting it** (`src/sim/boss/weapons.ts`): drawings touching it hurt it if they are moving faster than `weaponMinSpeed` — swung, thrown or dropped — for `hitDamage` (12 of 100), doubled for a `heavy` drawing and ×1.5 for a spinning one (a drawn hammer on a string is the best weapon on the board); a `hazard` drawing burns it on contact whether it moves or not, so it can be baited over lava. After a blow it is invulnerable for `hitInvulnerableMs` (0.5 s) and knocked back by `knockback`; a blow during its wind-up interrupts the snip.

## The tear (`src/sim/boss/tear.ts`)

The rip opens `aboveHeart` (220 px) over the body the moment it is named. After `entryDelayMs` (3 s — long enough for Kami's two lines and a first breath) the servant comes through. It keeps the **mercy window**: after any snip lands, no blade moves for `mercyMs` (3.2 s) — the drawer's moment to redraw. It also sends the **waves**: when the servant's health drops below 0.6, one lesser comes; below 0.3, two more. Lessers (`SNIPPER_TUNING.lesser`) are half the size, faster, shorter in the wind-up, and die in three blows; they never count toward the health bar. When the servant perishes the tear closes over `closingMs`; `tear-closed` is the `defeat-foe` win.

Loss: a cut through the heart is `heart-swallowed`. The spirit director answers `unmade`; the mode's `board-restarts` loss rule reopens a fresh page after a beat, with the heart alone again under an “Again” card.

## Tuning (`src/sim/boss/tuning.ts`)

Every number the fight is tuned by lives in that one file. The reasoning:

| Constant | Value | Why |
|---|---|---|
| `windUpMs` | 1100 / 800 | A person reading a dashed line and pressing a direction needs about a second. The lesser's 0.8 s is tense but readable; below 0.7 s the snip feels unfair on a thumbstick. |
| `lungeMs` | 260 / 200 | Fast enough to feel like a snip, long enough for the blades to visibly close. |
| `firstCircleMs` | 4800 / 3200 | The first servant or lesser circle is longer, giving both players time to read the fight before the first wind-up. |
| `mercyMs` | 3200 | One stroke takes 0.5–1 s to draw and commit. The mercy covers one confident stroke and more room to redraw. |
| `circleMs` | 3400 / 1900 | The breath between snips; with `recoverMs` it gives ~5.3 s per servant snip at the start, ~2.8 s at full ramp. |
| `speedRampPerSnip`, `maxSpeedRamp` | 0.06, 1.6 | Ten landed snips to reach the cap; the ramp rewards a drawer who keeps up, never a runaway. |
| `orbitRadius` | 150 / 105 | Far enough that the telegraph starts well outside the body; near enough to be watched. |
| `health`, `hitDamage` | 100, 12 | Nine plain blows; five heavy ones; a spinning hammer in three or four. |
| `hitInvulnerableMs` | 500 | A hammer resting on it is not a beating; it has to be swung again. |
| `waves` | 0.6 → 1, 0.3 → 2 | The first lesser arrives once the players have shown they can hurt it; the pair arrives for the finish. Three blades at once is the most two people can track. |
| `entryDelayMs` | 3000 | Kami's two tear lines and a first look at the body before anything moves. |
| `partAliveRatio` | 0.5 | Half the ink of a part is a part. Below that, drawing one line brings back the ability only if the part was small to begin with — which is fair: a small part is easy to redraw. |
| `graftReach` | 36 | A forgiving reach around the body: the drawer can redraw a part a little off its old stroke. |
| `heartRadius` | 9 | The heart is a target only a cut through the middle finds, and only once the torso is gone; the torso around it takes the rest. |
| `aboveHeart` | 220 | The tear is in view over the body at the default zoom without covering the title card. |

## Feel

- Telegraphs are the fight: the cut line, the blades opening, the pupil widening. Nothing hits without being shown first.
- Snips are visible: the cut mark flashes red where ink came off, grey where it only cut paper (`cutFlashMs`), and the removed strokes are simply gone from her.
- Grafts glow: fresh strokes are painted with a wide blue halo that fades over `graftGlowMs`.
- The health bar is drawn in ink at the top of the screen, wobbling like a hand-drawn box, turning red under 0.3.
- Losing the head dims the view rather than blinding it; the fight stays playable while the drawer fixes it.

## Deliberately not built

- The body is not persisted: the drawing that became it is deleted from the store, and a reload opens the room as a soul again (see the columns in [modes.md](modes.md)).
- Lessers do not ramp with the servant; they have their own gentler ramp.
- The servant does not chase a body that leaves its orbit far behind; it re-approaches, which is the intended breather.
- No second boss, no phases beyond the two waves.
