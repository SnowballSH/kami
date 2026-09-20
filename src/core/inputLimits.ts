import type { Stroke, Vec } from "./geometry";

export const INPUT_LIMITS = {
  strokes: 256,
  pointsPerStroke: 1024,
  points: 2048,
  coordinate: 1_000_000_000,
  text: 4000,
  name: 80,
  sketchBytes: 262_144,
  textBytes: 131_072,
  controllerBytes: 256,
} as const;

export const TEXT_LIMIT_MESSAGE = `Please use at most ${INPUT_LIMITS.text} characters.`;

export const isInputPoint = ({ x, y }: Vec): boolean =>
  Number.isFinite(x) &&
  Number.isFinite(y) &&
  Math.abs(x) <= INPUT_LIMITS.coordinate &&
  Math.abs(y) <= INPUT_LIMITS.coordinate;

export const strokeBudgetIssue = (strokes: readonly unknown[]): string | null => {
  if (strokes.length > INPUT_LIMITS.strokes)
    return `Use at most ${INPUT_LIMITS.strokes} strokes per drawing.`;
  let points = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke)) return "Every stroke must be an array of points.";
    if (stroke.length > INPUT_LIMITS.pointsPerStroke)
      return `Use at most ${INPUT_LIMITS.pointsPerStroke} points per stroke.`;
    points += stroke.length;
    if (points > INPUT_LIMITS.points)
      return `Use at most ${INPUT_LIMITS.points} points per drawing.`;
  }
  return null;
};

export const isInputStrokes = (strokes: readonly Stroke[]): boolean =>
  strokeBudgetIssue(strokes) === null && strokes.every((stroke) => stroke.every(isInputPoint));
