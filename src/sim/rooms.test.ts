import { describe, expect, it } from "vitest";
import {
  CROQUET,
  HALL,
  POOL,
  RIVERBANK,
  SHELVES,
  TEA_PARTY,
  TRIAL,
  wonderland,
} from "../board/boards/wonderland";
import type { BoardDefinition } from "../board/types";
import { type Rect, rectContains, type Stroke } from "../core/geometry";
import { judgePlacement } from "../ink/placement";
import type { Drawing } from "../ink/types";
import {
  aliceOf,
  blob,
  drawingOf,
  enter,
  feetOf,
  happeningsOf,
  idOf,
  LEFT,
  line,
  RIGHT,
  rulingOf,
  runSteps,
  runUntil,
  saw,
  standsOn,
  typesOf,
  UP,
  zonesOf,
} from "./testSupport";
import type { SimEvent, Simulation, WalkIntent } from "./types";

const GROUND_TOP = 560;
const PLATEAU_TOP = 340;
const COURT_TOP = 210;
const PLATEAU_FACE_X = SHELVES.plateauFaceX;
const WALL_X = HALL.wall.x;
const RESTING = 5;
const SHIFTS = [-20, 0, 20] as const;
const JUMP_RIGHT: WalkIntent = { x: 1, y: -1 };

const zoneOf = (zoneId: string, board: BoardDefinition = wonderland) => {
  const zone = board.zones.find((candidate) => candidate.id === zoneId);
  if (zone === undefined) throw new Error(`no zone ${zoneId}`);
  return zone;
};

const startingIn = (zoneId: string, board: BoardDefinition = wonderland): Simulation =>
  enter({ ...board, spawn: zoneOf(zoneId, board).checkpoint });

const topOf = (rect: Rect): number => rect.y;
const rightOf = (rect: Rect): number => rect.x + rect.width;

const bridge = (): Drawing => drawingOf("bridge", line({ x: 370, y: 556 }, { x: 610, y: 556 }));

const mushroom = (shift = 0): Drawing =>
  drawingOf("mushroom", blob(1430 + shift, GROUND_TOP - RESTING, 60, 40));

const cake = (shift = 0): Drawing =>
  drawingOf("cake", blob(1830 + shift, PLATEAU_TOP - RESTING, 30, 24));

const bottle = (shift = 0): Drawing =>
  drawingOf("bottle", blob(2150 + shift, PLATEAU_TOP - RESTING, 24, 30));

const poolFloor = topOf(POOL.bowl);

/** A low spring on the floor of the bowl by its far wall, low enough for a small Alice to step onto. */
const poolMushroom = (shift = 0): Drawing =>
  drawingOf("pool mushroom", blob(3490 + shift, poolFloor - RESTING, 60, 20));

const poolCake = (): Drawing => drawingOf("pool cake", blob(3100, poolFloor - RESTING, 30, 24));

const lawnCake = (): Drawing => drawingOf("lawn cake", blob(3750, PLATEAU_TOP - RESTING, 30, 24));

const portal = (name: string, x: number, floor: number): Drawing =>
  drawingOf(name, blob(x, floor, 40, 90));

const courtBottle = (): Drawing =>
  drawingOf("court bottle", blob(5100, COURT_TOP - RESTING, 24, 30));

const courtCake = (): Drawing => drawingOf("court cake", blob(5600, COURT_TOP - RESTING, 30, 24));

const box = (centreX: number, bottom: number, width: number, height: number): Stroke => {
  const left = centreX - width / 2;
  const right = centreX + width / 2;
  const top = bottom - height;
  return [
    ...line({ x: left, y: bottom }, { x: left, y: top }),
    ...line({ x: left, y: top }, { x: right, y: top }),
    ...line({ x: right, y: top }, { x: right, y: bottom }),
    ...line({ x: right, y: bottom }, { x: left, y: bottom }),
  ];
};

/** A chest that fills the gap in the wall of cards nearly to the brim. */
const chest = (): Drawing => {
  const gap = TRIAL.gap;
  return drawingOf("chest", box(gap.x + gap.width / 2, topOf(gap) - RESTING, gap.width - 20, 80));
};

const enteredZone =
  (zoneId: string) =>
  (events: readonly SimEvent[]): boolean =>
    zonesOf(events).includes(zoneId);

const rule = (sim: Simulation, drawing: Drawing, nature: Parameters<typeof rulingOf>[0]): void => {
  sim.addDrawing(drawing);
  sim.applyRuling(drawing.id, rulingOf(nature));
};

const shrunk = (sim: Simulation, potion: Drawing): void => {
  rule(sim, potion, "shrink");
  sim.setWalkIntent(RIGHT);
  runUntil(sim, saw("consumed"));
  expect(aliceOf(sim).size).toBe("small");
};

const blockedAt = (sim: Simulation, faceX: number): boolean => {
  const { x, width } = sim.aliceBounds();
  return aliceOf(sim).grounded && x + width >= faceX - 4;
};

describe("the board", () => {
  it("tells the seven pages of the journey in order", () => {
    expect(wonderland.zones.map((zone) => zone.id)).toEqual([
      "riverbank",
      "shelves",
      "hall-of-doors",
      "pool-of-tears",
      "croquet-ground",
      "trial",
      "tea-party",
    ]);
    const starts = wonderland.zones.map((zone) => zone.fromX);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThan(starts[i - 1] ?? Number.POSITIVE_INFINITY);
    }
  });

  it("sets every checkpoint down on the top of a solid", () => {
    for (const zone of wonderland.zones) {
      const footing = wonderland.solids.find(
        ({ rect }) =>
          rect.y === zone.checkpoint.y &&
          zone.checkpoint.x >= rect.x &&
          zone.checkpoint.x <= rightOf(rect),
      );
      expect(footing, zone.id).toBeDefined();
    }
  });

  it("gives every zone three hints, an intro and a title", () => {
    for (const zone of wonderland.zones) {
      expect(zone.hints).toHaveLength(3);
      expect(zone.intro.length).toBeGreaterThan(0);
      expect(zone.title.length).toBeGreaterThan(0);
    }
  });

  it("puts the rabbit hole at the tea party, past the trial", () => {
    expect(wonderland.goal).toBeDefined();
    expect(wonderland.goal?.x).toBeGreaterThan(zoneOf("tea-party").fromX);
    expect(rightOf(TRIAL.farRim)).toBeLessThanOrEqual(zoneOf("tea-party").fromX + 40);
  });
});

describe("the ditch", () => {
  it("swallows Alice when nothing is drawn and returns her to the bank", () => {
    const sim = enter(wonderland);
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("fell"));
    expect(happeningsOf(events)).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeCloseTo(wonderland.spawn.x, 0);
  });

  it("is crossed on a drawn bridge without falling", () => {
    const sim = enter(wonderland);
    sim.addDrawing(bridge());
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, standsOn(GROUND_TOP, 680));
    expect(feetOf(sim).x).toBeGreaterThanOrEqual(680);
    expect(typesOf(events)).not.toContain("fell");
  });

  it("is crossed by a pair of portals, one on each bank", () => {
    const sim = enter(wonderland);
    rule(sim, portal("portal here", 300, GROUND_TOP), "portal");
    rule(sim, portal("portal there", 700, GROUND_TOP), "portal");
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, standsOn(GROUND_TOP, 720), 600);
    expect(typesOf(events)).toContain("warped");
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).x).toBeGreaterThanOrEqual(720);
  });

  it("hangs the willow bough clear of her head as an anchor over the water", () => {
    const boughFoot = RIVERBANK.bough.y + RIVERBANK.bough.height;
    expect(GROUND_TOP - boughFoot).toBeGreaterThan(120);
    expect(RIVERBANK.bough.x).toBeGreaterThan(RIVERBANK.ditch.from);
    expect(rightOf(RIVERBANK.bough)).toBeLessThan(RIVERBANK.ditch.to);
  });
});

describe("the ledge", () => {
  it.each(SHIFTS)("is cleared by bouncing off a mushroom shifted %i px", (shift) => {
    const sim = startingIn("shelves");
    rule(sim, mushroom(shift), "bouncy");
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, standsOn(PLATEAU_TOP, PLATEAU_FACE_X));
    expect(typesOf(events)).toContain("bounced");
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);
  });

  it("stops her when nothing is drawn", () => {
    const sim = startingIn("shelves");
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 600);
    expect(feetOf(sim).x).toBeLessThan(PLATEAU_FACE_X);
    expect(feetOf(sim).y).toBeCloseTo(GROUND_TOP, 0);
  });

  it("is climbed by a ladder stood against the plateau face", () => {
    const sim = startingIn("shelves");
    const ladderX = PLATEAU_FACE_X - 10;
    sim.addDrawing(
      drawingOf("ladder", line({ x: ladderX, y: GROUND_TOP }, { x: ladderX, y: PLATEAU_TOP - 25 })),
    );
    sim.applyRuling(idOf("ladder"), rulingOf("climbable"));
    const drawnAt = sim.snapshot().drawings[0]?.pose.position;

    sim.setWalkIntent(RIGHT);
    runSteps(sim, 400);
    expect(feetOf(sim).y).toBeCloseTo(GROUND_TOP, 0);
    sim.setWalkIntent(UP);
    runSteps(sim, 100);
    expect(aliceOf(sim).climbing).toBe(true);
    expect(sim.snapshot().drawings[0]?.pose.position).toEqual(drawnAt);
    runSteps(sim, 50);

    sim.setWalkIntent(RIGHT);
    runUntil(sim, standsOn(PLATEAU_TOP, PLATEAU_FACE_X + 40));
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);
    expect(feetOf(sim).x).toBeGreaterThan(PLATEAU_FACE_X);
  });

  it("hangs its book-shelves too high to jump onto and clear of her head", () => {
    for (const shelf of [SHELVES.lowShelf, SHELVES.highShelf]) {
      expect(GROUND_TOP - topOf(shelf)).toBeGreaterThan(100);
      expect(GROUND_TOP - (shelf.y + shelf.height)).toBeGreaterThan(60);
    }
  });
});

describe("the glass table and the tiny door", () => {
  it.each(SHIFTS)("are solved by cake, key, bottle, door (blobs shifted %i px)", (shift) => {
    const sim = startingIn("hall-of-doors");
    rule(sim, cake(shift), "grow");
    sim.setWalkIntent(RIGHT);
    const eaten = runUntil(sim, saw("consumed"));
    expect(happeningsOf(eaten)).toEqual(["consumed"]);
    expect(aliceOf(sim).size).toBe("big");
    expect(sim.snapshot().drawings).toHaveLength(0);

    expect(happeningsOf(runUntil(sim, saw("key-taken")))).toEqual(["key-taken"]);
    expect(aliceOf(sim).hasKey).toBe(true);
    expect(aliceOf(sim).height).toBeCloseTo(120, 0);
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);

    rule(sim, bottle(shift), "shrink");
    const events = runUntil(sim, enteredZone("pool-of-tears"));
    expect(happeningsOf(events)).toEqual(["consumed", "door-opened"]);
    expect(aliceOf(sim).size).toBe("small");
    expect(sim.snapshot().doorOpen).toBe(true);
    expect(feetOf(sim).x).toBeGreaterThan(WALL_X);
  });

  it("keep the key out of reach of a normal-sized Alice", () => {
    const sim = startingIn("hall-of-doors");
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 400);
    expect(feetOf(sim).x).toBeGreaterThan(2100);
    expect(typesOf(events)).not.toContain("key-taken");
    expect(sim.snapshot().keyTaken).toBe(false);
  });

  it("do not let a normal-sized Alice through the gap even with the door gone", () => {
    const { door: _door, ...doorless } = wonderland;
    const sim = enter({ ...doorless, spawn: { x: WALL_X - 200, y: PLATEAU_TOP } });
    sim.setWalkIntent(RIGHT);
    const events = runSteps(sim, 600);
    expect(zonesOf(events)).not.toContain("pool-of-tears");
    expect(sim.aliceBounds().x + sim.aliceBounds().width).toBeLessThanOrEqual(WALL_X + 1);
  });
});

describe("the pool of tears", () => {
  it("is a glass bowl: nothing drawn in it or on its rims can anchor", () => {
    for (const rect of [POOL.nearRim, POOL.bowl, POOL.farRim]) {
      const piece = wonderland.solids.find((solid) => solid.rect === rect);
      expect(piece?.material).toBe("glass");
    }
    expect(poolFloor - PLATEAU_TOP).toBeGreaterThan(100);
  });

  it("keeps a small Alice in the bowl when nothing is drawn", () => {
    const sim = startingIn("pool-of-tears");
    shrunk(sim, drawingOf("sip", blob(2790, PLATEAU_TOP - RESTING, 24, 30)));
    const events = runSteps(sim, 900);
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).y).toBeCloseTo(poolFloor, 0);
    expect(feetOf(sim).x).toBeLessThan(POOL.farRim.x);
  });

  it("keeps a normal Alice in the bowl too", () => {
    const sim = startingIn("pool-of-tears");
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 900);
    expect(feetOf(sim).y).toBeCloseTo(poolFloor, 0);
    expect(feetOf(sim).x).toBeLessThan(POOL.farRim.x);
  });

  it("lets a ledge drawn against its glass wall drop: nothing anchors to tears", () => {
    const sim = startingIn("pool-of-tears");
    const wallX = POOL.farRim.x;
    const ledgeY = PLATEAU_TOP + 60;
    sim.addDrawing(
      drawingOf("ledge", line({ x: wallX - 200, y: ledgeY }, { x: wallX - 4, y: ledgeY }), [
        { x: wallX - 4, y: ledgeY },
        { x: wallX - 4, y: ledgeY + 50 },
      ]),
    );
    runSteps(sim, 120);
    const pose = sim.snapshot().drawings[0]?.pose;
    expect(pose?.position.y).toBeGreaterThan(poolFloor - 40);
  });

  it.each(SHIFTS)("springs a small Alice out on a mushroom by the far wall (%i px)", (shift) => {
    const sim = startingIn("pool-of-tears");
    shrunk(sim, drawingOf("sip", blob(2790, PLATEAU_TOP - RESTING, 24, 30)));
    rule(sim, poolMushroom(shift), "bouncy");
    const events = runUntil(sim, standsOn(PLATEAU_TOP, POOL.farRim.x));
    expect(typesOf(events)).toContain("bounced");
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);
  });

  it("springs a normal Alice out the same way", () => {
    const sim = startingIn("pool-of-tears");
    rule(sim, poolMushroom(), "bouncy");
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, standsOn(PLATEAU_TOP, POOL.farRim.x));
    expect(typesOf(events)).toContain("bounced");
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);
  });

  it("is left by a giant: cake on the pool floor, then a jump up the far wall", () => {
    const sim = startingIn("pool-of-tears");
    rule(sim, poolCake(), "grow");
    sim.setWalkIntent(RIGHT);
    runUntil(sim, saw("consumed"));
    expect(aliceOf(sim).size).toBe("big");
    runUntil(sim, (_events, world) => blockedAt(world, POOL.farRim.x));
    sim.setWalkIntent(JUMP_RIGHT);
    const events = runUntil(sim, standsOn(PLATEAU_TOP, POOL.farRim.x), 600);
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 30);
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);
    expect(feetOf(sim).x).toBeGreaterThan(POOL.farRim.x);
  });
});

describe("the croquet ground", () => {
  const lawnCentreY = PLATEAU_TOP - 30;
  const dab = (x: number, y: number): readonly Stroke[] => [[{ x, y }]];
  const rules = {
    noInkZones: wonderland.noInkZones,
    solids: wonderland.solids.map(({ rect }) => rect),
    aliceBounds: null,
  };

  it("paints the whole lawn red, from the arbour to the dais, up past her head", () => {
    for (let x = rightOf(CROQUET.arbour) + 24; x < CROQUET.daisFaceX; x += 40) {
      expect(judgePlacement(dab(x, lawnCentreY), rules), `${x}`).toBe("no-ink-zone");
      expect(judgePlacement(dab(x, PLATEAU_TOP - 130), rules), `${x} high`).toBe("no-ink-zone");
    }
    expect(judgePlacement(dab(CROQUET.daisFaceX - 4, COURT_TOP + 20), rules)).toBe("no-ink-zone");
  });

  it("leaves the margins open: under the arbour, in the sky, and on the dais", () => {
    expect(judgePlacement(dab(3750, PLATEAU_TOP - 10), rules)).toBe("ok");
    expect(judgePlacement(dab(4200, PLATEAU_TOP - 160), rules)).toBe("ok");
    expect(judgePlacement(dab(4700, COURT_TOP - 10), rules)).toBe("ok");
    expect(
      wonderland.noInkZones.every((zone) => !rectContains(zone, { x: 4700, y: COURT_TOP })),
    ).toBe(true);
  });

  it("stops a normal Alice at the foot of the Queen's dais", () => {
    const sim = startingIn("croquet-ground");
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 700);
    expect(feetOf(sim).y).toBeCloseTo(PLATEAU_TOP, 0);
    expect(sim.aliceBounds().x + sim.aliceBounds().width).toBeLessThanOrEqual(
      CROQUET.daisFaceX + 1,
    );
  });

  it("is crossed by a giant: cake in the margin, then a hop onto the dais", () => {
    const sim = startingIn("croquet-ground");
    rule(sim, lawnCake(), "grow");
    sim.setWalkIntent(RIGHT);
    const eaten = runUntil(sim, saw("consumed"));
    expect(happeningsOf(eaten)).toEqual(["consumed"]);
    expect(aliceOf(sim).size).toBe("big");
    runUntil(sim, (_events, world) => blockedAt(world, CROQUET.daisFaceX));
    sim.setWalkIntent(JUMP_RIGHT);
    const events = runUntil(sim, standsOn(COURT_TOP, CROQUET.daisFaceX), 600);
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 30);
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).y).toBeCloseTo(COURT_TOP, 0);
    expect(feetOf(sim).x).toBeGreaterThan(CROQUET.daisFaceX);
  });

  it("is crossed by a pair of portals: one in the margin, one on the dais", () => {
    const sim = startingIn("croquet-ground");
    rule(sim, portal("portal here", 3780, PLATEAU_TOP), "portal");
    rule(sim, portal("portal there", 4700, COURT_TOP), "portal");
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, standsOn(COURT_TOP, 4700), 600);
    expect(typesOf(events)).toContain("warped");
    expect(feetOf(sim).x).toBeGreaterThan(CROQUET.daisFaceX);
  });
});

describe("the trial", () => {
  const juryFaceX = TRIAL.juryBox.x;
  const underJury = rightOf(TRIAL.juryBox);

  it("stops a normal Alice at the jury box", () => {
    const sim = startingIn("trial");
    sim.setWalkIntent(RIGHT);
    runSteps(sim, 500);
    expect(feetOf(sim).y).toBeCloseTo(COURT_TOP, 0);
    expect(sim.aliceBounds().x + sim.aliceBounds().width).toBeLessThanOrEqual(juryFaceX + 1);
  });

  it("lets a small Alice under the jury box and drops her in the gap in the cards", () => {
    const sim = startingIn("trial");
    shrunk(sim, courtBottle());
    runSteps(sim, 700);
    expect(feetOf(sim).x).toBeGreaterThan(underJury);
    expect(feetOf(sim).y).toBeCloseTo(topOf(TRIAL.gap), 0);
    expect(feetOf(sim).x).toBeLessThan(TRIAL.farRim.x);
  });

  it("is crossed by filling the gap with a heavy chest", () => {
    const sim = startingIn("trial");
    shrunk(sim, courtBottle());
    rule(sim, chest(), "heavy");
    const events = runUntil(sim, standsOn(COURT_TOP, rightOf(TRIAL.farRim)));
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).x).toBeGreaterThanOrEqual(rightOf(TRIAL.farRim));
  });

  it("is crossed by growing again past the jury box and jumping the gap", () => {
    const sim = startingIn("trial");
    shrunk(sim, courtBottle());
    rule(sim, courtCake(), "grow");
    runUntil(sim, saw("consumed"));
    expect(aliceOf(sim).size).toBe("big");
    runUntil(sim, (_events, world) => feetOf(world).x >= TRIAL.gap.x - 60);
    sim.setWalkIntent(JUMP_RIGHT);
    const events = runUntil(sim, standsOn(COURT_TOP, rightOf(TRIAL.farRim)), 600);
    expect(typesOf(events)).not.toContain("fell");
    expect(feetOf(sim).y).toBeCloseTo(COURT_TOP, 0);
  });
});

describe("the whole board", () => {
  it("is played from the first bank to the tea party in one go", () => {
    const sim = enter(wonderland);
    const events: SimEvent[] = [];
    const play = (done: Parameters<typeof runUntil>[1]): void => {
      events.push(...runUntil(sim, done));
    };

    sim.addDrawing(bridge());
    sim.setWalkIntent(RIGHT);
    play(enteredZone("shelves"));

    rule(sim, mushroom(), "bouncy");
    play(standsOn(PLATEAU_TOP, PLATEAU_FACE_X));
    play(enteredZone("hall-of-doors"));

    rule(sim, cake(), "grow");
    play(saw("key-taken"));

    rule(sim, bottle(), "shrink");
    play(enteredZone("pool-of-tears"));

    rule(sim, poolMushroom(), "bouncy");
    play(standsOn(PLATEAU_TOP, POOL.farRim.x));
    play(enteredZone("croquet-ground"));

    rule(sim, lawnCake(), "grow");
    play((seen) => happeningsOf(seen).filter((type) => type === "consumed").length === 3);
    play((_seen, world) => blockedAt(world, CROQUET.daisFaceX));
    sim.setWalkIntent(JUMP_RIGHT);
    play(standsOn(COURT_TOP, CROQUET.daisFaceX));
    sim.setWalkIntent(RIGHT);
    play(enteredZone("trial"));

    rule(sim, courtBottle(), "shrink");
    rule(sim, chest(), "heavy");
    play(saw("goal-reached"));

    expect(zonesOf(events)).toEqual([
      "riverbank",
      "shelves",
      "hall-of-doors",
      "pool-of-tears",
      "croquet-ground",
      "trial",
      "tea-party",
    ]);
    expect(happeningsOf(events)).toEqual([
      "bounced",
      "consumed",
      "key-taken",
      "consumed",
      "door-opened",
      "bounced",
      "consumed",
      "consumed",
      "goal-reached",
    ]);
    expect(feetOf(sim).y).toBeCloseTo(COURT_TOP, 0);
    expect(feetOf(sim).x).toBeGreaterThan(TEA_PARTY.goal.x - 30);
  });
});

describe("zones", () => {
  it("are announced once each, however often she walks back and forth", () => {
    const sim = enter(wonderland);
    sim.addDrawing(bridge());
    sim.setWalkIntent(RIGHT);
    const events = [...runUntil(sim, standsOn(GROUND_TOP, 760))];
    sim.setWalkIntent(LEFT);
    events.push(...runSteps(sim, 80));
    sim.setWalkIntent(RIGHT);
    events.push(...runSteps(sim, 120));
    expect(zonesOf(events)).toEqual(["riverbank", "shelves"]);
  });

  it("return her to the checkpoint of the furthest zone she has reached", () => {
    const sim = enter(wonderland);
    sim.addDrawing(bridge());
    sim.setWalkIntent(RIGHT);
    runUntil(sim, enteredZone("shelves"));

    sim.removeDrawing(idOf("bridge"));
    sim.setWalkIntent(LEFT);
    const events = runUntil(sim, saw("fell"));
    expect(typesOf(events)).toEqual(["fell"]);
    expect(feetOf(sim).x).toBeCloseTo(760, 0);
    runSteps(sim, 30);
    expect(feetOf(sim).y).toBeCloseTo(GROUND_TOP, 0);
  });

  it("let the party go on past the rabbit hole", () => {
    const sim = startingIn("tea-party");
    sim.setWalkIntent(RIGHT);
    const events = runUntil(sim, saw("goal-reached"));
    expect(typesOf(events)).toContain("goal-reached");
    runSteps(sim, 200);
    expect(feetOf(sim).x).toBeGreaterThan(rightOf(TEA_PARTY.goal));
    expect(feetOf(sim).y).toBeCloseTo(COURT_TOP, 0);
  });
});
