"""Pen strokes as the readers see them: split into lines of writing, each drawn black on white.

`render_line` is the one rasteriser of handwriting: the readers' own resizing happens after it.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TypeAlias

import cv2
import numpy as np
from numpy.typing import NDArray

INK_HEIGHT = 64
MARGIN = 8
PEN_THICKNESS = 3
DOT_RADIUS = 2
MAX_WIDTH = 2048
PAPER = 255
INK = 0
SUBPIXEL_BITS = 4
MIN_LINE_SHARE = 0.35
MAX_LINES = 4

Point: TypeAlias = tuple[float, float]
Stroke: TypeAlias = Sequence[Point]
Strokes: TypeAlias = Sequence[Stroke]
Image: TypeAlias = NDArray[np.uint8]


def _inked(strokes: Strokes) -> list[NDArray[np.float64]]:
    arrays = [np.asarray(stroke, dtype=np.float64).reshape(-1, 2) for stroke in strokes]
    return [points for points in arrays if len(points) > 0]


def _scale_to_fit(width: float, height: float) -> float:
    limits = [
        INK_HEIGHT / height if height > 0 else math.inf,
        (MAX_WIDTH - 2 * MARGIN - 1) / width if width > 0 else math.inf,
    ]
    scale = min(limits)
    return 1.0 if math.isinf(scale) else scale


def render_line(strokes: Strokes) -> Image:
    """One line of writing, its ink `INK_HEIGHT` px tall (narrower if it would pass `MAX_WIDTH`)."""
    inked = _inked(strokes)
    if not inked:
        raise ValueError("a line of writing needs at least one point")
    every_point = np.concatenate(inked)
    origin = every_point.min(axis=0)
    width, height = every_point.max(axis=0) - origin
    scale = _scale_to_fit(float(width), float(height))
    canvas_width = min(MAX_WIDTH, math.ceil(width * scale) + 2 * MARGIN + 1)
    canvas_height = math.ceil(height * scale) + 2 * MARGIN + 1
    canvas = np.full((canvas_height, canvas_width), PAPER, dtype=np.uint8)
    precision = 1 << SUBPIXEL_BITS
    for points in inked:
        pixels = np.rint(((points - origin) * scale + MARGIN) * precision).astype(np.int32)
        if len(pixels) == 1:
            centre = (int(pixels[0, 0]), int(pixels[0, 1]))
            radius = DOT_RADIUS * precision
            cv2.circle(canvas, centre, radius, INK, cv2.FILLED, cv2.LINE_AA, SUBPIXEL_BITS)
        else:
            cv2.polylines(canvas, [pixels], False, INK, PEN_THICKNESS, cv2.LINE_AA, SUBPIXEL_BITS)
    return canvas


@dataclass(slots=True)
class _Band:
    top: float
    bottom: float
    members: list[int]

    @property
    def height(self) -> float:
        return self.bottom - self.top

    def gap_to(self, other: _Band) -> float:
        return max(other.top - self.bottom, self.top - other.bottom, 0.0)

    def absorb(self, other: _Band) -> None:
        self.top = min(self.top, other.top)
        self.bottom = max(self.bottom, other.bottom)
        self.members.extend(other.members)


def _overlapping_bands(strokes: Sequence[NDArray[np.float64]]) -> list[_Band]:
    spans = sorted(
        (float(points[:, 1].min()), float(points[:, 1].max()), index)
        for index, points in enumerate(strokes)
    )
    bands: list[_Band] = []
    for top, bottom, index in spans:
        if bands and top <= bands[-1].bottom:
            bands[-1].absorb(_Band(top, bottom, [index]))
        else:
            bands.append(_Band(top, bottom, [index]))
    return bands


def _fold_slivers(bands: list[_Band]) -> list[_Band]:
    """A band much shorter than the tallest (the dots of i's, an underline) joins its neighbour."""
    while len(bands) > 1:
        tallest = max(band.height for band in bands)
        sliver = min(bands, key=lambda band: band.height)
        if sliver.height >= MIN_LINE_SHARE * tallest:
            break
        bands.remove(sliver)
        min(bands, key=sliver.gap_to).absorb(sliver)
    return sorted(bands, key=lambda band: band.top)


def split_lines(strokes: Strokes) -> list[list[Stroke]]:
    """The strokes as lines of writing, top first; one line when it cannot tell them apart."""
    kept = [stroke for stroke in strokes if len(stroke) > 0]
    bands = _fold_slivers(_overlapping_bands(_inked(kept)))
    if len(bands) > MAX_LINES:
        return [kept]
    return [[kept[index] for index in sorted(band.members)] for band in bands]
