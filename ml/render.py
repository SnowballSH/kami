"""The one rasteriser of Kami's Eye: strokes in any units -> uint8 [64, 64], per ml/CONTRACT.md.

Training and serving both import this file, and its sha256 travels with every trained model.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Sequence
from pathlib import Path
from typing import TypeAlias

import cv2
import numpy as np
from numpy.typing import NDArray

SIZE = 64
CANVAS = 256
MARGIN = 12
THICKNESS = 6
DOT_RADIUS = 3
INK = 255
DRAWABLE_SPAN = CANVAS - 1 - 2 * MARGIN

Point: TypeAlias = tuple[float, float]
Coordinates: TypeAlias = Sequence[float] | NDArray[np.floating] | NDArray[np.integer]
Stroke: TypeAlias = Sequence[Point] | NDArray[np.floating] | NDArray[np.integer]
Strokes: TypeAlias = Sequence[Stroke]
PointArray: TypeAlias = NDArray[np.float64]
Image: TypeAlias = NDArray[np.uint8]


def _as_point_arrays(strokes: Strokes) -> list[PointArray]:
    arrays = [np.asarray(stroke, dtype=np.float64).reshape(-1, 2) for stroke in strokes]
    inked = [points for points in arrays if len(points) > 0]
    if any(not np.isfinite(points).all() for points in inked):
        raise ValueError("stroke coordinates must be finite")
    return inked


def _fit_to_canvas(strokes: list[PointArray]) -> list[NDArray[np.int32]]:
    every_point = np.concatenate(strokes)
    origin = every_point.min(axis=0)
    box = every_point.max(axis=0) - origin
    extent = float(box.max())
    scale = DRAWABLE_SPAN / extent if extent > 0 else 0.0
    offset = (CANVAS - 1 - box * scale) / 2
    return [np.rint((points - origin) * scale + offset).astype(np.int32) for points in strokes]


def render(strokes: Strokes, *, thickness: int = THICKNESS) -> Image:
    inked = _as_point_arrays(strokes)
    if not inked:
        return np.zeros((SIZE, SIZE), dtype=np.uint8)
    canvas = np.zeros((CANVAS, CANVAS), dtype=np.uint8)
    for pixels in _fit_to_canvas(inked):
        if len(pixels) == 1:
            centre = (int(pixels[0, 0]), int(pixels[0, 1]))
            cv2.circle(canvas, centre, DOT_RADIUS, INK, thickness=cv2.FILLED, lineType=cv2.LINE_AA)
        else:
            cv2.polylines(
                canvas,
                [pixels.reshape(-1, 1, 2)],
                isClosed=False,
                color=INK,
                thickness=thickness,
                lineType=cv2.LINE_AA,
            )
    return np.asarray(
        cv2.resize(canvas, (SIZE, SIZE), interpolation=cv2.INTER_AREA), dtype=np.uint8
    )


def take_prefix(strokes: Strokes, fraction: float) -> list[PointArray]:
    """The first `fraction` of all points, in drawing order; never fewer than one point."""
    if not 0.0 < fraction <= 1.0:
        raise ValueError("fraction must be in (0, 1]")
    inked = _as_point_arrays(strokes)
    remaining = max(1, math.ceil(fraction * sum(len(points) for points in inked)))
    prefix: list[PointArray] = []
    for points in inked:
        if remaining <= 0:
            break
        prefix.append(points[:remaining])
        remaining -= len(points)
    return prefix


def render_prefix(strokes: Strokes, fraction: float, *, thickness: int = THICKNESS) -> Image:
    return render(take_prefix(strokes, fraction), thickness=thickness)


def from_xy_arrays(xy_strokes: Sequence[tuple[Coordinates, Coordinates]]) -> list[PointArray]:
    """Quick, Draw!'s stroke form, one (xs, ys) pair per stroke, as point arrays."""
    return [
        np.stack([np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)], axis=1)
        for xs, ys in xy_strokes
    ]


def to_model_input(images: Sequence[Image] | Image) -> NDArray[np.float32]:
    """uint8 image(s) -> float32 [N, 1, 64, 64] with ink = 1.0."""
    batch = np.asarray(images, dtype=np.float32).reshape(-1, 1, SIZE, SIZE)
    return batch / np.float32(INK)


def image_sha256(image: Image) -> str:
    return hashlib.sha256(np.ascontiguousarray(image).tobytes()).hexdigest()


def render_source_sha256() -> str:
    return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
