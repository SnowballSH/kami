"""Random Quick, Draw!-shaped drawings, and the forms the tests need them in."""

import numpy as np

from quickdraw_bin import Drawing, XyStroke
from render import Point

JsonStrokes = list[list[dict[str, float]]]
EMPTY_CATEGORY = "circle"
PER_CLASS = 5


def xy_stroke(points: list[tuple[int, int]]) -> XyStroke:
    xs, ys = zip(*points, strict=True)
    return np.asarray(xs, dtype=np.uint8), np.asarray(ys, dtype=np.uint8)


def random_drawing(
    rng: np.random.Generator,
    key_id: int,
    stroke_count: int = 3,
    points_per_stroke: int = 6,
    recognized: bool = True,
) -> Drawing:
    strokes = [
        (
            rng.integers(0, 256, points_per_stroke).astype(np.uint8),
            rng.integers(0, 256, points_per_stroke).astype(np.uint8),
        )
        for _ in range(stroke_count)
    ]
    return Drawing(key_id, "US", recognized, 1_490_000_000, strokes)


def as_points(drawing: Drawing) -> list[list[Point]]:
    return [
        [(float(x), float(y)) for x, y in zip(xs, ys, strict=True)] for xs, ys in drawing.strokes
    ]


def as_json(drawing: Drawing, scale: float = 1.0, shift: Point = (0.0, 0.0)) -> JsonStrokes:
    return [
        [{"x": x * scale + shift[0], "y": y * scale + shift[1]} for x, y in stroke]
        for stroke in as_points(drawing)
    ]
