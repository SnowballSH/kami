"""Kami finishes your drawing: the exemplar most like the player's sketch, placed on their ink."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from exemplar_set import ExemplarSet
from recognizer import Reading
from render import Point, Stroke, Strokes

MIN_TOP1_PROBABILITY = 0.5
PROBABILITY_BONUS = 0.05
COORDINATE_DECIMALS = 2
_LEADING_ARTICLE = re.compile(r"^(?:a|an|the)\s+")


class SketchReader(Protocol):
    @property
    def labels(self) -> Sequence[str]: ...

    def read(self, strokes: Strokes) -> Reading: ...


@dataclass(frozen=True, slots=True)
class Completion:
    strokes: list[list[Point]]
    category: str
    confidence: float
    similarity: float

    def to_json(self) -> dict[str, object]:
        return {
            "strokes": [[{"x": x, "y": y} for x, y in stroke] for stroke in self.strokes],
            "category": self.category,
            "confidence": self.confidence,
            "similarity": self.similarity,
        }


@dataclass(frozen=True, slots=True)
class Bounds:
    low: NDArray[np.float64]
    high: NDArray[np.float64]

    @property
    def size(self) -> NDArray[np.float64]:
        return self.high - self.low

    @property
    def centre(self) -> NDArray[np.float64]:
        return (self.low + self.high) / 2

    @staticmethod
    def of(strokes: Strokes) -> Bounds | None:
        """None for a drawing without points, or with points that are not finite numbers."""
        inked = [np.asarray(stroke, dtype=np.float64).reshape(-1, 2) for stroke in strokes]
        points = np.concatenate([np.zeros((0, 2)), *inked])
        if len(points) == 0 or not np.isfinite(points).all():
            return None
        return Bounds(points.min(axis=0), points.max(axis=0))


def category_key(name: str) -> str:
    """How names are compared: lower case, single spaces, no leading article."""
    return _LEADING_ARTICLE.sub("", " ".join(name.lower().split()))


def place(exemplar: Strokes, onto: Bounds) -> list[list[Point]] | None:
    """The exemplar at one scale for both axes, as large as fits inside `onto`, centred on it.

    None when no positive scale fits: a dot for an exemplar, or ink flat where the exemplar is not.
    """
    source = Bounds.of(exemplar)
    if source is None:
        return None
    spans = source.size > 0
    scale = float((onto.size[spans] / source.size[spans]).min(initial=np.inf))
    if not 0 < scale < np.inf:
        return None
    offset = onto.centre - source.centre * scale

    def fitted(stroke: Stroke) -> list[Point]:
        moved = np.round(np.asarray(stroke, dtype=np.float64) * scale + offset, COORDINATE_DECIMALS)
        return [(float(x), float(y)) for x, y in np.clip(moved, onto.low, onto.high)]

    return [fitted(stroke) for stroke in exemplar if len(stroke) > 0]


class SketchCompleter:
    def __init__(self, reader: SketchReader, exemplars: ExemplarSet) -> None:
        if tuple(reader.labels) != exemplars.categories:
            raise ValueError("the exemplar set was built for other labels than this model's")
        self._reader = reader
        self._exemplars = exemplars
        self._label_of = {category_key(label): index for index, label in enumerate(reader.labels)}

    @property
    def exemplar_count(self) -> int:
        return self._exemplars.count

    def complete(self, strokes: Strokes, name: str | None = None) -> Completion | None:
        ink = Bounds.of(strokes)
        if ink is None or not ink.size.any():
            return None
        reading = self._reader.read(strokes)
        label = self._choose_label(reading.probabilities[0], name)
        if label is None:
            return None
        best = self._most_alike(label, reading.embeddings[0])
        if best is None:
            return None
        index, similarity = best
        placed = place(self._exemplars.strokes(index), ink)
        if placed is None:
            return None
        return Completion(
            strokes=placed,
            category=self._exemplars.categories[label],
            confidence=float(reading.probabilities[0, label]),
            similarity=similarity,
        )

    def _choose_label(self, probabilities: NDArray[np.float64], name: str | None) -> int | None:
        named = self._label_of.get(category_key(name)) if name else None
        if named is not None:
            return named
        top = int(probabilities.argmax())
        return top if probabilities[top] >= MIN_TOP1_PROBABILITY else None

    def _most_alike(self, label: int, embedding: NDArray[np.float32]) -> tuple[int, float] | None:
        rows = self._exemplars.of_label(label)
        if len(rows) == 0:
            return None
        window = slice(rows.start, rows.stop)
        similarities = self._exemplars.embeddings[window].astype(np.float32) @ embedding
        sureness = self._exemplars.probabilities[window].astype(np.float32)
        best = int((similarities + PROBABILITY_BONUS * sureness).argmax())
        return rows.start + best, float(similarities[best])
