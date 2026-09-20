import type { Rect } from "../../core/geometry";
import type { BoardDefinition, SolidDef, Zone } from "../types";

const GROUND_TOP = 560;
const PLATEAU_TOP = 340;
const COURT_TOP = 210;
const DEPTH = 400;
const SKY = -2000;
const TINY_GAP = 40;

const slab = (x: number, width: number, top: number, bottom = top + DEPTH): Rect => ({
  x,
  y: top,
  width,
  height: bottom - top,
});

const marker = (rect: Rect): SolidDef => ({ rect, material: "marker" });
const glass = (rect: Rect): SolidDef => ({ rect, material: "glass" });

/** The riverbank: two banks and the ditch the Rabbit hopped, under a willow bough. */
export const RIVERBANK = {
  leftBank: slab(-2000, 2380, GROUND_TOP),
  ditch: { from: 380, to: 600 },
  bough: slab(420, 140, 400, 424),
  rightBank: slab(600, 900, GROUND_TOP),
} as const;

/** The shelves: two book-ledges hung in the air, then the plateau face she has to get up. */
export const SHELVES = {
  lowShelf: slab(1000, 160, 400, 420),
  highShelf: slab(1200, 160, 440, 460),
  plateauFaceX: 1500,
  plateau: slab(1500, 1300, PLATEAU_TOP),
} as const;

/** The hall: a glass table with the key on it and a wall with a door only a small girl fits. */
export const HALL = {
  table: slab(1850, 150, PLATEAU_TOP - 160, PLATEAU_TOP - 140),
  wall: slab(2500, 40, SKY, PLATEAU_TOP - TINY_GAP),
  door: { x: 2505, y: PLATEAU_TOP - TINY_GAP, width: 30, height: TINY_GAP },
} as const;

/** The pool: a glass bowl of tears between two glass rims, 130 deep and 640 wide; ink holds nowhere. */
export const POOL = {
  depth: 130,
  nearRim: slab(2800, 100, PLATEAU_TOP),
  bowl: slab(2900, 640, PLATEAU_TOP + 130, PLATEAU_TOP + DEPTH),
  farRim: slab(3540, 100, PLATEAU_TOP),
} as const;

/** The croquet ground: a rose arbour, the red lawn and its hoops, and the Queen's dais at the end. */
export const CROQUET = {
  lawn: slab(3640, 960, PLATEAU_TOP),
  arbour: slab(3700, 100, 150, 180),
  hoops: [3950, 4150, 4350].map((x) => slab(x, 30, PLATEAU_TOP - 10, PLATEAU_TOP)),
  redLawn: { x: 3820, y: PLATEAU_TOP - 140, width: 796, height: 140 },
  daisFaceX: 4600,
} as const;

/** The trial: the court floor, the jury box she must duck under, and the gap in the wall of cards. */
export const TRIAL = {
  floor: slab(4600, 1220, COURT_TOP),
  juryBox: slab(5250, 200, SKY, COURT_TOP - TINY_GAP),
  nearRim: slab(5820, 80, COURT_TOP),
  gap: slab(5900, 150, COURT_TOP + 90, COURT_TOP + DEPTH),
  farRim: slab(6050, 80, COURT_TOP),
} as const;

/** The tea party: a long table, two tall chairs and the rabbit hole at the gate. */
export const TEA_PARTY = {
  floor: slab(6130, 2500, COURT_TOP),
  table: slab(6600, 1200, COURT_TOP - 90, COURT_TOP - 74),
  chairs: [6500, 7900].map((x) => slab(x, 40, COURT_TOP - 60, COURT_TOP)),
  goal: { x: 6260, y: COURT_TOP - 100, width: 90, height: 100 },
} as const;

const zones: readonly Zone[] = [
  {
    id: "riverbank",
    title: "The Riverbank",
    intro: "She can hop, not fly. You can draw.",
    fromX: Number.NEGATIVE_INFINITY,
    checkpoint: { x: 120, y: GROUND_TOP },
    allowedNatures: "all",
    hints: [
      "The Rabbit hopped it. She can't.",
      "Ink is solid. Bank to bank would do.",
      "Draw a line across the ditch, touching both banks. Then walk.",
    ],
  },
  {
    id: "shelves",
    title: "The Shelves",
    intro: "The way on is up. Draw it, then tell me what it is.",
    fromX: 700,
    checkpoint: { x: 760, y: GROUND_TOP },
    allowedNatures: "all",
    hints: [
      "Up is a long way when all you can do is walk.",
      "Things that spring, things with rungs, things that rise. Say what it is.",
      "Draw a blob by the ledge, write 'bouncy mushroom' beside it, and walk onto it.",
    ],
  },
  {
    id: "hall-of-doors",
    title: "The Hall of Doors",
    intro: "Curiouser and curiouser.",
    fromX: 1700,
    checkpoint: { x: 1760, y: PLATEAU_TOP },
    allowedNatures: "all",
    hints: [
      "Too big for the door, too small for the table. How inconvenient to be only one size.",
      "In this house, size is a matter of diet. But mind the order you dine in.",
      "Draw a cake — eat, grow, take the key. Then a bottle — drink, shrink, and through you go.",
    ],
  },
  {
    id: "pool-of-tears",
    title: "The Pool of Tears",
    intro: "She cried this herself. Nothing you draw will hold in it.",
    fromX: 2700,
    checkpoint: { x: 2760, y: PLATEAU_TOP },
    allowedNatures: "all",
    hints: [
      "Ink sinks in tears. Whatever you draw down there must carry itself.",
      "Things that spring need no anchor. Nor does a bigger girl. Draw it on the pool's floor.",
      "Draw a small blob by the far wall and write 'bouncy mushroom'. Or a cake: eat, grow, jump out.",
    ],
  },
  {
    id: "croquet-ground",
    title: "The Croquet Ground",
    intro: "The Queen's lawn. Ink on the red and it's off with your head.",
    fromX: 3700,
    checkpoint: { x: 3720, y: PLATEAU_TOP },
    allowedNatures: "all",
    hints: [
      "The lawn takes no ink. The margins do.",
      "Change her before she steps on the grass. Or draw a door out, and a door in.",
      "Draw a cake under the arbour and let her grow; a giant hops the dais. Or two portals: one here, one up there.",
    ],
  },
  {
    id: "trial",
    title: "The Trial",
    intro: "Everything at once. Who stole the tarts?",
    fromX: 4900,
    checkpoint: { x: 4960, y: COURT_TOP },
    allowedNatures: "all",
    hints: [
      "The jury box sits low. The cards have left a gap you can't bridge.",
      "Only a small girl fits under. Something heavy fills a hole; something enormous steps over it.",
      "A bottle: drink, shrink, duck under. Then a heavy chest in the gap — or a cake, and jump it.",
    ],
  },
  {
    id: "tea-party",
    title: "The Mad Tea Party",
    intro: "No puzzle here. Sit anywhere. Draw anything.",
    fromX: 6100,
    checkpoint: { x: 6160, y: COURT_TOP },
    allowedNatures: "all",
    hints: [
      "There is nothing to solve. That is the trick of it.",
      "Draw whatever you like. Name it. See what it does.",
      "It's a party. The table takes anything, and so do I.",
    ],
  },
];

/** The Alice demo: seven pages sketched left to right along one board, ending at a party. */
export const wonderland: BoardDefinition = {
  id: "wonderland",
  title: "Wonderland",
  spawn: { x: 120, y: GROUND_TOP },
  killY: 1400,
  solids: [
    marker(RIVERBANK.leftBank),
    marker(RIVERBANK.bough),
    marker(RIVERBANK.rightBank),
    marker(SHELVES.lowShelf),
    marker(SHELVES.highShelf),
    marker(SHELVES.plateau),
    glass(HALL.table),
    marker(HALL.wall),
    glass(POOL.nearRim),
    glass(POOL.bowl),
    glass(POOL.farRim),
    marker(CROQUET.lawn),
    marker(CROQUET.arbour),
    ...CROQUET.hoops.map(marker),
    marker(TRIAL.floor),
    marker(TRIAL.juryBox),
    glass(TRIAL.nearRim),
    glass(TRIAL.gap),
    glass(TRIAL.farRim),
    marker(TEA_PARTY.floor),
    marker(TEA_PARTY.table),
    ...TEA_PARTY.chairs.map(marker),
  ],
  zones,
  noInkZones: [CROQUET.redLawn],
  key: { x: HALL.table.x + HALL.table.width - 15, y: HALL.table.y - 25 },
  door: HALL.door,
  goal: TEA_PARTY.goal,
};
