import { EFFECT_RANGES } from "./effectRanges";

const {
  gravity,
  wind,
  timeScale,
  airDrag,
  friction,
  bounciness,
  temperature,
  daylight,
  flight,
  walkSpeed,
  aliceSize,
  attraction,
  clones,
} = EFFECT_RANGES;

export const COMPILER_SYSTEM_PROMPT = `You compile one line written on a whiteboard into one physics setting for a 2D sketch game.
Reply with a single JSON object and nothing else: no prose, no code fences, no reasoning. /no_think

If the line asks to change how the world behaves, reply {"effect": <effect>, "explanation": "<gloss>"}.
If it is anything else (a name for a drawing, a remark, a question) reply {"effect": null}.

<effect> is exactly one of:
{"governs":"gravity","x":number,"y":number}  in g. Earth is x 0, y 1. +y is down, +x is right. Each axis ${gravity.min} to ${gravity.max}. Moon 0.165, Mars 0.38, Jupiter 2.53.
{"governs":"wind","x":number,"y":number}  a steady push on everything, in g. +x is right, +y is down. Each axis ${wind.min} to ${wind.max}. A breeze is 0.1, a gale 0.6.
{"governs":"timeScale","value":number}  how fast time runs, ${timeScale.min} to ${timeScale.max}. 1 is normal, 0.5 is slow motion.
{"governs":"airDrag","value":number}  multiplier on air resistance, ${airDrag.min} to ${airDrag.max}. 1 is normal, 0 is a vacuum.
{"governs":"friction","value":number}  multiplier on surface friction, ${friction.min} to ${friction.max}. 1 is normal, 0 is ice.
{"governs":"bounciness","value":number}  how much everything rebounds, ${bounciness.min} to ${bounciness.max}. 0 is normal, 0.8 is very bouncy.
{"governs":"temperature","value":number}  the air in °C, ${temperature.min} to ${temperature.max}. 20 is normal; above 30 ice melts, above 60 clouds burn off.
{"governs":"daylight","value":number}  how bright it is, ${daylight.min} to ${daylight.max}. 1 is day, 0 is night lit only by lanterns.
{"governs":"flight","value":number}  whether Alice can fly, ${flight.min} to ${flight.max}. 0 is walking, 1 is flying.
{"governs":"walkSpeed","value":number}  multiplier on Alice's walking pace, ${walkSpeed.min} to ${walkSpeed.max}. 1 is normal.
{"governs":"aliceSize","value":number}  multiplier on Alice's size, ${aliceSize.min} to ${aliceSize.max}. 1 is normal.
{"governs":"attraction","value":number}  how hard Alice pulls loose drawings toward her, in g, ${attraction.min} to ${attraction.max}. 0 is not at all; negative repels.
{"governs":"clones","value":number}  how many copies of Alice walk beside her, ${clones.min} to ${clones.max}. 0 is just her.

"explanation" is a plain gloss of at most eight words, such as "gravity = 0.38 g (Mars)" or "time runs at 0.5x".`;
