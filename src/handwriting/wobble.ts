import { distance, type Stroke, type Vec } from "../core/geometry";
import type { SeededRandom } from "./prng";
import { resample } from "./resample";

const TAU = Math.PI * 2;

const BASELINE_SWAY = 0.04;
const BASELINE_SWAY_SHARE = { min: 0.4, max: 1 } as const;
const BASELINE_SWAY_WAVELENGTH = { min: 8, max: 16 } as const;
const LINE_TILT = 0.01;
const GLYPH_NUDGE = 0.025;
const GLYPH_SCALE_JITTER = 0.06;
const HAND_SLANT = 0.04;
const GLYPH_SLANT_JITTER = 0.035;
const WAVER = 0.015;
const WAVER_WAVELENGTH = { min: 0.7, max: 1.5 } as const;
const MAX_SEGMENT = 0.18;

/** How far a line's baseline has wandered, as a function of distance along the line. */
export interface LineDrift {
  readonly tilt: number;
  readonly sway: number;
  readonly phase: number;
  readonly wavelength: number;
}

export interface GlyphJitter {
  readonly nudge: Vec;
  readonly scale: number;
  /** Horizontal shear per unit of height above the baseline. */
  readonly slant: number;
}

interface Range {
  readonly min: number;
  readonly max: number;
}

interface Wave {
  readonly phase: number;
  readonly wavelength: number;
}

export const driftAt = (drift: LineDrift, x: number): number =>
  drift.tilt * x + drift.sway * Math.sin(drift.phase + (TAU * x) / drift.wavelength);

const waveAt = (wave: Wave, travelled: number): number =>
  Math.sin(wave.phase + (TAU * travelled) / wave.wavelength);

/** One writer's unsteadiness. Every amplitude is a fraction of the em size, drawn in a fixed order. */
export class Wobble {
  readonly #random: SeededRandom;
  readonly #emSize: number;
  readonly #handSlant: number;

  constructor(random: SeededRandom, emSize: number) {
    this.#random = random;
    this.#emSize = emSize;
    this.#handSlant = random.around(HAND_SLANT);
  }

  nextLine(): LineDrift {
    return {
      tilt: this.#random.around(LINE_TILT),
      sway: this.#within(BASELINE_SWAY_SHARE) * BASELINE_SWAY * this.#emSize,
      phase: this.#random.between(0, TAU),
      wavelength: this.#within(BASELINE_SWAY_WAVELENGTH) * this.#emSize,
    };
  }

  nextGlyph(): GlyphJitter {
    return {
      nudge: {
        x: this.#random.around(GLYPH_NUDGE * this.#emSize),
        y: this.#random.around(GLYPH_NUDGE * this.#emSize),
      },
      scale: 1 + this.#random.around(GLYPH_SCALE_JITTER),
      slant: this.#handSlant + this.#random.around(GLYPH_SLANT_JITTER),
    };
  }

  /** Bends a stroke with a slow wave along its length, after giving long segments points to bend at. */
  waver(stroke: Stroke): Stroke {
    const across = this.#nextWave();
    const along = this.#nextWave();
    const amplitude = WAVER * this.#emSize;
    let travelled = 0;
    return resample(stroke, MAX_SEGMENT * this.#emSize).map((point, i, points) => {
      travelled += distance(points[i - 1] ?? point, point);
      return {
        x: point.x + amplitude * waveAt(across, travelled),
        y: point.y + amplitude * waveAt(along, travelled),
      };
    });
  }

  #nextWave(): Wave {
    return {
      phase: this.#random.between(0, TAU),
      wavelength: this.#within(WAVER_WAVELENGTH) * this.#emSize,
    };
  }

  #within(range: Range): number {
    return this.#random.between(range.min, range.max);
  }
}
