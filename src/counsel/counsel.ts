import type { Counsel, Surroundings } from "./types";

export const BRIDGE_LINE = "A gap. A bridge would do — here is the start of one. Draw it stronger.";
export const LADDER_LINE = "Too tall to jump. Ladders climb walls — I've leaned one there.";
export const DROP_LINE =
  "The page ends there, for now. Draw the ground onward, or write 'she can fly'.";

/** Ideas for an empty stretch of page, taken in turn; a word is a creature Kami sketches too. */
export const IDEAS: readonly { readonly line: string; readonly word: string | null }[] = [
  { line: "Draw her a friend. A rabbit, say — like this one. Then name it.", word: "rabbit" },
  { line: "Write a law: 'g = moon'. Then draw a hill and watch her float over it.", word: null },
  { line: "Sketch a mushroom and write 'bouncy' beside it. Then a taller one.", word: null },
  { line: "Draw a cat, and write 'the cat follows me'.", word: "cat" },
  { line: "Write 'wind blows right', then draw a cloud for her to ride.", word: null },
];

const BRIDGE_HEIGHT = 48;
const BRIDGE_OVERLAP = 24;
const LADDER_WIDTH = 56;
const CREATURE_SIZE = 96;

/** What Kami says and sketches for what he sees around Alice; `turn` picks the next idea. */
export const counselFor = (seen: Surroundings, turn: number): Counsel => {
  switch (seen.kind) {
    case "gap":
      return {
        line: BRIDGE_LINE,
        sketch: {
          word: "bridge",
          fit: "stretch",
          box: {
            x: seen.span.x - BRIDGE_OVERLAP,
            y: seen.span.y - BRIDGE_HEIGHT,
            width: seen.span.width + 2 * BRIDGE_OVERLAP,
            height: BRIDGE_HEIGHT,
          },
        },
      };
    case "wall": {
      const { face, toward } = seen;
      const x = toward === 1 ? face.x - LADDER_WIDTH : face.x;
      return {
        line: LADDER_LINE,
        sketch: {
          word: "ladder",
          fit: "stretch",
          box: { x, y: face.y, width: LADDER_WIDTH, height: face.height },
        },
      };
    }
    case "drop":
      return { line: DROP_LINE, sketch: null };
    case "open": {
      const idea = IDEAS[((turn % IDEAS.length) + IDEAS.length) % IDEAS.length];
      if (idea === undefined) return { line: DROP_LINE, sketch: null };
      return {
        line: idea.line,
        sketch:
          idea.word === null
            ? null
            : {
                word: idea.word,
                fit: "keep",
                box: {
                  x: seen.beside.x - CREATURE_SIZE / 2,
                  y: seen.beside.y - CREATURE_SIZE,
                  width: CREATURE_SIZE,
                  height: CREATURE_SIZE,
                },
              },
      };
    }
  }
};
