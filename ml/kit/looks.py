"""How a drawing is shown to the model: finished or cut to a prefix, and — in training only — gently
re-shaped before `render.py` rasterises it.

Training draws a fresh look for every image pass from a generator seeded by (seed, step), so a
drawing seen twice is seen two ways, and a resumed run sees exactly what it would have seen.
Held-out drawings always get the same two looks: finished, and one prefix whose fraction comes from
the drawing's key_id — uniform in [0.3, 1.0), the mixture every earlier model was scored on.

The re-shaping acts on the points, not the pixels: rotation, shear and a change of aspect. The
renderer fits every drawing to its own bounds, so a shift or a uniform zoom would change nothing,
and the image stays exactly what serving would draw for such ink.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from metrics import FULL_FRACTION
from render import Image, PointArray, render, take_prefix

FINISHED = FULL_FRACTION
MIN_PREFIX = 0.3
HELD_OUT_STREAM = 0x4B414D49


@dataclass(frozen=True, slots=True)
class LookPolicy:
    finished_share: float = 0.5
    min_prefix: float = MIN_PREFIX
    max_rotation_degrees: float = 10.0
    max_shear: float = 0.1
    max_log_stretch: float = 0.1

    def __post_init__(self) -> None:
        if not 0.0 <= self.finished_share <= 1.0:
            raise ValueError("finished_share must be in [0, 1]")
        if not 0.0 < self.min_prefix < 1.0:
            raise ValueError("min_prefix must be in (0, 1)")
        if min(self.max_rotation_degrees, self.max_shear, self.max_log_stretch) < 0:
            raise ValueError("augmentation bounds must not be negative")

    def fraction(self, rng: np.random.Generator) -> float:
        if rng.random() < self.finished_share:
            return FINISHED
        return float(rng.uniform(self.min_prefix, FINISHED))

    def reshaping(self, rng: np.random.Generator) -> NDArray[np.float64]:
        """A 2x2 linear map: stretch x by e^s and y by e^-s, then shear, then rotate."""
        angle = math.radians(rng.uniform(-self.max_rotation_degrees, self.max_rotation_degrees))
        shear = rng.uniform(-self.max_shear, self.max_shear)
        stretch = math.exp(rng.uniform(-self.max_log_stretch, self.max_log_stretch))
        rotation = np.array(
            [[math.cos(angle), -math.sin(angle)], [math.sin(angle), math.cos(angle)]]
        )
        shearing = np.array([[1.0, shear], [0.0, 1.0]])
        scaling = np.diag([stretch, 1.0 / stretch])
        return np.asarray(rotation @ shearing @ scaling, dtype=np.float64)


def cut(strokes: list[PointArray], fraction: float) -> list[PointArray]:
    return strokes if fraction >= FINISHED else take_prefix(strokes, fraction)


def training_look(
    strokes: list[PointArray], policy: LookPolicy, rng: np.random.Generator
) -> tuple[Image, float]:
    fraction = policy.fraction(rng)
    reshaping = policy.reshaping(rng).T
    return render([points @ reshaping for points in cut(strokes, fraction)]), fraction


def held_out_prefix_fraction(key_id: int, min_prefix: float = MIN_PREFIX) -> float:
    rng = np.random.default_rng([HELD_OUT_STREAM, key_id])
    return float(rng.uniform(min_prefix, FINISHED))


def held_out_look(strokes: list[PointArray], fraction: float) -> Image:
    return render(cut(strokes, fraction))
