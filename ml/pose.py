"""The eight ways a flat drawing can face: as drawn or mirrored, turned by quarter turns."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

Points = NDArray[np.float64]

_QUARTER_TURN = np.array([[0.0, -1.0], [1.0, 0.0]])
_MIRROR = np.diag([-1.0, 1.0])


@dataclass(frozen=True, slots=True)
class Pose:
    mirrored: bool = False
    quarter_turns: int = 0

    @property
    def matrix(self) -> Points:
        turned = np.linalg.matrix_power(_QUARTER_TURN, self.quarter_turns % 4)
        return turned @ _MIRROR if self.mirrored else turned

    def of(self, strokes: list[Points]) -> list[Points]:
        """The drawing in this pose, turned about the centre of its bounds so it stays in place."""
        if not self.mirrored and self.quarter_turns % 4 == 0:
            return strokes
        points = np.concatenate(strokes)
        centre = (points.min(axis=0) + points.max(axis=0)) / 2
        return [(stroke - centre) @ self.matrix.T + centre for stroke in strokes]


UPRIGHT = Pose()
POSES: tuple[Pose, ...] = tuple(
    Pose(mirrored, turns) for turns in range(4) for mirrored in (False, True)
)
