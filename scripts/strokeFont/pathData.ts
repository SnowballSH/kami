export type Point = readonly [x: number, y: number];
export type Polyline = readonly Point[];

export const CUBIC_SEGMENTS = 6;

const PATH_TOKEN = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z]/g;
const COMMAND = /^[A-Za-z]$/;

class PathTokens {
  readonly #tokens: readonly string[];
  #index = 0;

  constructor(pathData: string) {
    this.#tokens = pathData.match(PATH_TOKEN) ?? [];
  }

  get isDone(): boolean {
    return this.#index >= this.#tokens.length;
  }

  get nextIsCommand(): boolean {
    return COMMAND.test(this.#tokens[this.#index] ?? "");
  }

  command(): string {
    return this.#take();
  }

  point(): Point {
    return [this.#number(), this.#number()];
  }

  #number(): number {
    const value = Number(this.#take());
    if (!Number.isFinite(value)) throw new Error("path data: expected a number");
    return value;
  }

  #take(): string {
    const token = this.#tokens[this.#index];
    if (token === undefined) throw new Error("path data: ended unexpectedly");
    this.#index += 1;
    return token;
  }
}

const cubicAt = (from: Point, c1: Point, c2: Point, to: Point, t: number): Point => {
  const u = 1 - t;
  const weights = [u ** 3, 3 * u ** 2 * t, 3 * u * t ** 2, t ** 3] as const;
  const blend = (axis: 0 | 1): number =>
    weights[0] * from[axis] + weights[1] * c1[axis] + weights[2] * c2[axis] + weights[3] * to[axis];
  return [blend(0), blend(1)];
};

const flattenCubic = (from: Point, c1: Point, c2: Point, to: Point): Point[] =>
  Array.from({ length: CUBIC_SEGMENTS }, (_, i) =>
    cubicAt(from, c1, c2, to, (i + 1) / CUBIC_SEGMENTS),
  );

/** Absolute `M`, `L` and `C` only — all that the EMS single-stroke fonts use. */
export const parsePathData = (pathData: string): Polyline[] => {
  const tokens = new PathTokens(pathData);
  const polylines: Point[][] = [];
  let command = "";
  while (!tokens.isDone) {
    if (tokens.nextIsCommand) command = tokens.command();
    const current = polylines.at(-1);
    const from = current?.at(-1);
    if (command === "M") {
      polylines.push([tokens.point()]);
      command = "L";
    } else if (command === "L" && current !== undefined) {
      current.push(tokens.point());
    } else if (command === "C" && current !== undefined && from !== undefined) {
      current.push(...flattenCubic(from, tokens.point(), tokens.point(), tokens.point()));
    } else {
      throw new Error(`path data: unsupported command "${command}"`);
    }
  }
  return polylines;
};
