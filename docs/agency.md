# Kami — Who Moves Alice

Alice walks by herself unless the player steers; a clone is a second Alice in every sense of that
sentence. This file records how the minds and the hands are wired. `spec.md` says what Kami is;
`architecture.md` says how the modules fit; `laws.md` owns the `clones` dial and its fold.

## 1. One body, one intent

The simulation keeps a `WalkIntent` per Alice, not one for the world:

```ts
type AliceIndex = number;            // 0 is Alice herself; twins follow in spawn order
const ALICE_HERSELF: AliceIndex = 0;

interface Simulation {
  setWalkIntent(intent: WalkIntent, who?: AliceIndex): void;   // default: Alice herself
  alices(): readonly AliceSnapshot[];                          // her first, then her twins
  aliceBounds(who?: AliceIndex): Rect;
  walkSpeed(who?: AliceIndex): number;
  jumpArc(who?: AliceIndex): BounceArc;
}
```

Every tick each `AliceController` is controlled with her own intent, senses her own footing, has
her own touches resolved (`resolveAliceTouches(alice)`), her own portal memory (`Portals` per
body, so the exit that refuses one Alice lets another through), and her own fate. The events that
concern one body say which:

```ts
{ type: "goal-reached"; who }   { type: "fell"; who }
{ type: "alice-devoured"; who } { type: "warped"; who; from; to }
```

`fell` respawns only `who`. Creatures carry every Alice standing on them; a vehicle is driven by
the Alice aboard it, with her intent. The Sumikui scores every Alice as a quarry and swallows only
the one it caught (`SumikuiSnapshot.prey`). A twin who strays `TWIN_STRAY_DISTANCE` sideways from
Alice is recalled to her feet; nothing else ties them together. The `clones` law is exactly what it
was: `Twins.match(count)` brings the head count to the folded value, later laws win, repeal refolds.

## 2. One mind per body: the Party

`game/party.ts` owns the pilots. `Party` is hired with a factory (`Hire = (options: PilotOptions)
=> Autopilot`) and keeps exactly one pilot per Alice the sim reports:

```ts
interface PilotOptions {
  readonly seed: number;      // her index; fixes which way she first wanders
  readonly wanders: boolean;  // twins stroll when there is nothing to do; Alice waits
  readonly charter: Charter;  // (scene) => Chart | null — shared within a step
}

interface Scene {
  readonly alice: AliceSnapshot;             // the body this pilot moves
  readonly others: readonly AliceSnapshot[]; // the rest, never solid
  // board, inks, bites, key/door, walkSpeed, canFly, bounceArc, jumpArc as before
}
```

Before each simulation step `Party.drive(sim, page, selfDriving)` sets every intent:

- the **selected** Alice takes the held manual intent while the stick or keys are held (or
  whenever self-driving is off);
- every other Alice takes what her own pilot says, given a `Scene` whose `alice` is her and whose
  `others` are everyone else;
- with self-driving off the unselected ones stand still.

Plans, stuck detectors, route memory and the sulk after a route stalls are per pilot: one Alice
finding no way on does not stall another, and each fears the Sumikui for herself (`dread.ts`
measures from `scene.alice`). `drive` returns `News` — who has just got `stuck`, `flees` or is
`cornered` — and `Game` has Kami speak: the stuck line only for the selected Alice, the Sumikui
lines for any, prefixed with a twin's name. What *is* shared is the chart: no pilot stamps an Alice
as solid, so within one step every pilot reads the same page, and `Party` builds the `Chart` once
per set of inks and hands it to each through `charter`. `others` only widen the chart's extent and
excuse creature ink that an Alice is overlapping from being stamped, so a clone standing in a
doorway never walls her sister in.

### Wandering

A twin with no errand — no key, door or goal she can reach — does not wait like Alice does. Her
pilot plans a walk to a stance about `WANDER_PX` ahead in her `heading`, rests `WANDER_REST_TICKS`
when she gets there or finds no way, and turns about. The heading starts from her seed (even
indices right, odd left), so two clones set off in opposite directions and a room of them spreads
out. It is deterministic and offline like the rest of the autopilot; there is no randomness and no
model in the loop. When a goal appears, the errand ordering (key → door → goal → eat → wait /
wander) takes over on the next replan, and every Alice heads for it by her own route.

On an endless page ([modes.md](modes.md), the sandbox) nobody waits and nobody strolls at random:
with no errand every pilot's plan is `explore` — walk to the reachable stance nearest the top of the
newest ink, or the edge of the paper she faces when nothing has been drawn. The chart is a window
around every Alice on the page, shared by all their pilots as in a room.

## 3. One hand: selection

The thumbstick, arrow keys, a controller or the cabinet all reach `Game.onWalkIntent`, which is
`Party.steer`: it moves the selected Alice. Tapping an Alice selects her (`Game.tap` →
`selectAliceAt`, tried after tappable notes and before the write prompt, so a pen tap on a clone
never opens the keyboard); Kami answers *"Alice 2, then. Lead on."*, the camera resumes following
her, and a small caret marks her. The stick's intent is cleared on selection so the newcomer does
not inherit a held direction. When the `clones` fold shrinks below the selection, the selection
falls back to Alice herself.

Everything that was "about Alice" is about the selected one: Kami's remarks are written above her,
summoned drawings are stood clear of her, the ⌖ button reframes on her, the stuck line and the
stuck-hint clock listen to her pilot. The camera follows her, leaning `COMPANY_LEAN` of the way
toward any other Alice within half a screen so close company stays in frame without the frame
chasing a clone off on her own.

## 4. Winning, losing, being seen

Any Alice reaching the goal wins the room: `goal-reached` is handed to the mode's `won` seam
exactly as before, and Kami names her — *"Alice 2 found the rabbit hole. One of you was enough."*
(`lines.ts:TWIN_GOAL_LINE`, `aliceName(who)`). A twin swallowed by the Sumikui or fallen off the
page comes back alone, and Kami's devoured line is prefixed with her name (`aboutAlice`).

Twins are drawn like Alice, plus a tinted, numbered ribbon
(`render/alicePainter.ts:AliceLook`, colour and number by index — presentation only; the same
strokes and body are what the physics uses) and the selected one a caret over her head
(`RenderFrame.selectedAlice`). The Sumikui's closing shadow fades only its prey.

## 5. What this does not do

- Clones do not talk to each other or divide a room up on purpose; independence, not teamwork.
  Cooperation emerges from different routes and from one Alice's ink use being everyone's.
- There is no HUD roster; selection is by tapping the body. A roster is a small, additive
  affordance if the tap proves too fiddly on a crowded page.
- The chart does not predict where the others will be; like creatures, they are read fresh at
  every replan.
