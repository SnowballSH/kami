"""Kami finishes your drawing: its own strokes, tidied toward the exemplar most like it."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from exemplar_set import ExemplarSet
from likeness import ExemplarMatcher
from morph import DEFAULT_FIRMNESS, Points, inked_strokes, morph_onto
from pose import Pose
from recognizer import Reading
from render import Strokes

MIN_TOP1_PROBABILITY = 0.5
COORDINATE_DECIMALS = 2
_LEADING_ARTICLE = re.compile(r"^(?:a|an|the)\s+")


class SketchReader(Protocol):
    @property
    def labels(self) -> Sequence[str]: ...

    def read(self, strokes: Strokes) -> Reading: ...


def _as_json(strokes: Sequence[Points]) -> list[list[dict[str, float]]]:
    return [
        [{"x": float(x), "y": float(y)} for x, y in np.round(stroke, COORDINATE_DECIMALS)]
        for stroke in strokes
    ]


@dataclass(frozen=True, slots=True)
class Completion:
    tidied: list[Points]
    added: list[Points]
    category: str
    confidence: float
    similarity: float
    boldness: float
    exemplar_key_id: int
    pose: Pose

    def to_json(self) -> dict[str, object]:
        return {
            "tidied": _as_json(self.tidied),
            "added": _as_json(self.added),
            "category": self.category,
            "confidence": self.confidence,
            "similarity": self.similarity,
            "boldness": self.boldness,
            "exemplar": str(self.exemplar_key_id),
            "pose": {"mirrored": self.pose.mirrored, "quarterTurns": self.pose.quarter_turns},
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


def _as_arrays(strokes: Strokes | Sequence[NDArray[np.uint8]]) -> list[Points]:
    return [np.asarray(stroke, dtype=np.float64).reshape(-1, 2) for stroke in strokes]


def category_key(name: str) -> str:
    """How names are compared: lower case, single spaces, no leading article."""
    return _LEADING_ARTICLE.sub("", " ".join(name.lower().split()))


class SketchCompleter:
    def __init__(self, reader: SketchReader, exemplars: ExemplarSet) -> None:
        if tuple(reader.labels) != exemplars.categories:
            raise ValueError("the exemplar set was built for other labels than this model's")
        self._reader = reader
        self._exemplars = exemplars
        self._matcher = ExemplarMatcher(exemplars)
        self._label_of = {category_key(label): index for index, label in enumerate(reader.labels)}

    @property
    def exemplar_count(self) -> int:
        return self._exemplars.count

    def complete(
        self, strokes: Strokes, name: str | None = None, firmness: float = DEFAULT_FIRMNESS
    ) -> Completion | None:
        ink = Bounds.of(strokes)
        if ink is None or not ink.size.any():
            return None
        reading = self._reader.read(strokes)
        label = self._choose_label(reading.probabilities[0], name)
        if label is None:
            return None
        player = _as_arrays(strokes)
        alike = self._matcher.most_alike(label, reading.embeddings[0], inked_strokes(player))
        if alike is None:
            return None
        confidence = float(reading.probabilities[0, label])
        shaped = morph_onto(player, alike.fitted, certainty=confidence, firmness=firmness)
        if shaped is None:
            return None
        return Completion(
            tidied=shaped.tidied,
            added=shaped.added,
            category=self._exemplars.categories[label],
            confidence=confidence,
            similarity=alike.similarity,
            boldness=shaped.boldness,
            exemplar_key_id=int(self._exemplars.key_ids[alike.index]),
            pose=alike.pose,
        )

    def _choose_label(self, probabilities: NDArray[np.float64], name: str | None) -> int | None:
        named = self._named_label(name) if name else None
        if named is not None:
            return named
        top = int(probabilities.argmax())
        return top if probabilities[top] >= MIN_TOP1_PROBABILITY else None

    def _named_label(self, name: str) -> int | None:
        """The label the name ends with: "a bouncy mushroom" is a mushroom, adjectives and all."""
        words = category_key(name).split()
        for start in range(len(words)):
            label = self._label_of.get(" ".join(words[start:]))
            if label is not None:
                return label
        return None
