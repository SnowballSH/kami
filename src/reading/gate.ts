import { boundsOf, distance, type Stroke, strokeLength } from "../core/geometry";

/** A written line on the board; anything taller is a drawing, whatever it says. */
const MAX_WRITING_HEIGHT = 260;
const MAX_STROKES = 80;
const STRAIGHT_ENOUGH = 0.97;
/**
 * From this many strokes on, writing has three or more letters in it and runs along the line,
 * so a squarish pile of strokes is a doodle. Fewer strokes may be a short word ("hi", "ok").
 */
const STROKES_OF_A_LONG_WORD = 4;
const WIDER_THAN_TALL = 1.3;

const isNearlyStraight = (stroke: Stroke): boolean => {
  const [first] = stroke;
  const last = stroke.at(-1);
  if (first === undefined || last === undefined) return true;
  const length = strokeLength(stroke);
  return length === 0 || distance(first, last) / length >= STRAIGHT_ENOUGH;
};

/**
 * Cheap, local, and only ever says no: one straight line is a platform, a tower of strokes is a
 * castle, a squarish heap of many strokes is a face or a house. What passes is sent to the
 * reader, which has the final word.
 */
export const couldBeWriting = (strokes: readonly Stroke[]): boolean => {
  const [only] = strokes;
  if (only === undefined || strokes.length > MAX_STROKES) return false;
  if (strokes.length === 1 && isNearlyStraight(only)) return false;
  const { width, height } = boundsOf(strokes.flat());
  if (height > MAX_WRITING_HEIGHT) return false;
  return strokes.length < STROKES_OF_A_LONG_WORD || width >= WIDER_THAN_TALL * height;
};
