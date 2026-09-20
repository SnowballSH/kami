import { boundsOf, type Rect, rectsOverlap, type Stroke, type Vec } from "../core/geometry";

/** How tall or wide a summoned drawing stands, in world px (Alice is 60 tall). */
export const SUMMONED_SIZE = { small: 55, usual: 110, big: 190 } as const;
export type SummonedSize = keyof typeof SUMMONED_SIZE;
const GAP = 24;
const MOST_IN_A_ROW = 4;
const ROW_GAP = 40;
const ABOVE_WRITING = 14;

const set = (names: string): ReadonlySet<string> =>
  new Set(names.split(",").map((name) => name.trim()));

const BIG = set(`
  aircraft carrier, airplane, ambulance, animal migration, barn, bear, bridge, bulldozer, bus, camel,
  castle, church, cloud, cow, cruise ship, dragon, elephant, firetruck, giraffe, helicopter, horse,
  hospital, hot air balloon, house, hurricane, jail, lighthouse, lion, mountain, ocean, palm tree,
  pickup truck, police car, rainbow, rhinoceros, river, roller coaster, sailboat, school bus,
  skyscraper, speedboat, submarine, swing set, tent, The Eiffel Tower, The Great Wall of China,
  tiger, tornado, tractor, train, tree, truck, van, waterslide, whale, windmill, zebra`);
const SMALL = set(`
  ant, apple, bandage, baseball, basketball, bee, blackberry, blueberry, bottlecap, bracelet, candle,
  carrot, coffee cup, cookie, crayon, cup, diamond, donut, ear, egg, eraser, eye, finger, fork,
  grapes, hockey puck, key, knife, leaf, lipstick, lollipop, marker, matches, mosquito, mouse, mug,
  mushroom, nail, onion, paper clip, peanut, pear, peas, pencil, popsicle, potato, screwdriver,
  snail, soccer ball, spider, spoon, star, strawberry, string bean, tennis racquet, toe, tooth`);

export const sizeOf = (category: string): SummonedSize =>
  BIG.has(category) ? "big" : SMALL.has(category) ? "small" : "usual";

/** The sketch scaled to fit `box` (aspect kept), centred, standing on the box's floor. */
export const fitSketch = (sketch: readonly Stroke[], box: Rect): readonly Stroke[] => {
  const bounds = boundsOf(sketch.flat());
  const scale = Math.min(
    box.width / Math.max(bounds.width, 1),
    box.height / Math.max(bounds.height, 1),
  );
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  const left = box.x + (box.width - width) / 2;
  const top = box.y + box.height - height;
  return sketch.map((stroke) =>
    stroke.map(({ x, y }) => ({
      x: left + (x - bounds.x) * scale,
      y: top + (y - bounds.y) * scale,
    })),
  );
};

/**
 * A box per thing: rows of at most four from `origin` (top-left) rightwards, the things in a row
 * standing on one floor, further rows below.
 */
export const layoutBoxes = (sizes: readonly SummonedSize[], origin: Vec): readonly Rect[] => {
  const boxes: Rect[] = [];
  let top = origin.y;
  for (let start = 0; start < sizes.length; start += MOST_IN_A_ROW) {
    const row = sizes.slice(start, start + MOST_IN_A_ROW).map((size) => SUMMONED_SIZE[size]);
    const floor = top + Math.max(...row);
    let x = origin.x;
    for (const side of row) {
      boxes.push({ x, y: floor - side, width: side, height: side });
      x += side + GAP;
    }
    top = floor + ROW_GAP;
  }
  return boxes;
};

const shifted = (strokes: readonly Stroke[], by: Vec): readonly Stroke[] =>
  strokes.map((stroke) => stroke.map(({ x, y }) => ({ x: x + by.x, y: y + by.y })));

/**
 * Where summoned drawings land: as laid out, centred over the words that asked for them and
 * standing just above, lifted clear of Alice when she is in the way.
 */
export const standOver = (
  drawings: readonly (readonly Stroke[])[],
  writing: Rect,
  alice: Rect | null,
): readonly (readonly Stroke[])[] => {
  const frame = boundsOf(drawings.flat(2));
  const left = writing.x + writing.width / 2 - frame.width / 2;
  const overWords = writing.y - ABOVE_WRITING - frame.height;
  const inAlicesWay =
    alice !== null &&
    rectsOverlap({ x: left, y: overWords, width: frame.width, height: frame.height }, alice);
  const top = inAlicesWay ? alice.y - ABOVE_WRITING - frame.height : overWords;
  const by = { x: left - frame.x, y: top - frame.y };
  return drawings.map((strokes) => shifted(strokes, by));
};
