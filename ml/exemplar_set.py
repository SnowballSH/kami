"""The exemplar file set of ml/CONTRACT.md: prototypical drawings per category, next to a model."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import TypeVar

import numpy as np
from numpy.typing import NDArray

EXEMPLARS_DIR = "exemplars"
MODEL_FILE = "model.onnx"
META_FILE = "meta.json"
EMBEDDINGS_FILE = "embeddings.npy"
LABELS_FILE = "labels.npy"
PROBABILITIES_FILE = "probabilities.npy"
KEY_IDS_FILE = "key_ids.npy"
POINTS_FILE = "points.npy"
STROKE_OFFSETS_FILE = "stroke_offsets.npy"
DRAWING_OFFSETS_FILE = "drawing_offsets.npy"
FORMAT_VERSION = 1
EMBEDDING_SIZE = 512
HASH_CHUNK_BYTES = 1 << 20

PointsU8 = NDArray[np.uint8]
ScalarT = TypeVar("ScalarT", bound=np.generic)


class ExemplarSetError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Exemplar:
    label: int
    probability: float
    key_id: int
    embedding: NDArray[np.float32]
    strokes: Sequence[PointsU8]


@dataclass(frozen=True, slots=True)
class ExemplarSet:
    """Exemplars sorted by label, their strokes ragged: points -> strokes -> drawings."""

    categories: tuple[str, ...]
    embeddings: NDArray[np.float16]
    labels: NDArray[np.int32]
    probabilities: NDArray[np.float16]
    key_ids: NDArray[np.uint64]
    points: PointsU8
    stroke_offsets: NDArray[np.uint32]
    drawing_offsets: NDArray[np.uint32]

    def __post_init__(self) -> None:
        count = len(self.labels)
        consistent = (
            self.embeddings.shape == (count, EMBEDDING_SIZE)
            and self.probabilities.shape == (count,)
            and self.key_ids.shape == (count,)
            and self.drawing_offsets.shape == (count + 1,)
            and self.points.ndim == 2
            and self.points.shape[1] == 2
            and int(self.drawing_offsets[-1]) == len(self.stroke_offsets) - 1
            and int(self.stroke_offsets[-1]) == len(self.points)
            and bool(np.all(np.diff(self.labels) >= 0))
            and (count == 0 or 0 <= self.labels[0] <= self.labels[-1] < len(self.categories))
        )
        if not consistent:
            raise ExemplarSetError("the exemplar arrays do not describe one set of drawings")

    @property
    def count(self) -> int:
        return len(self.labels)

    def of_label(self, label: int) -> range:
        first, last = np.searchsorted(self.labels, [label, label + 1])
        return range(int(first), int(last))

    def strokes(self, index: int) -> list[PointsU8]:
        first, last = int(self.drawing_offsets[index]), int(self.drawing_offsets[index + 1])
        bounds = self.stroke_offsets[first : last + 1].tolist()
        return [self.points[start:end] for start, end in pairwise(bounds)]

    @staticmethod
    def of(categories: Sequence[str], exemplars: Sequence[Exemplar]) -> ExemplarSet:
        """Exemplars of one label keep the order they are given in: best first."""
        ordered = sorted(exemplars, key=lambda exemplar: exemplar.label)
        strokes = [stroke for exemplar in ordered for stroke in exemplar.strokes]
        return ExemplarSet(
            categories=tuple(categories),
            embeddings=np.concatenate(
                [
                    np.zeros((0, EMBEDDING_SIZE), dtype=np.float32),
                    *(exemplar.embedding.reshape(1, EMBEDDING_SIZE) for exemplar in ordered),
                ]
            ).astype(np.float16),
            labels=np.asarray([exemplar.label for exemplar in ordered], dtype=np.int32),
            probabilities=np.asarray(
                [exemplar.probability for exemplar in ordered], dtype=np.float16
            ),
            key_ids=np.asarray([exemplar.key_id for exemplar in ordered], dtype=np.uint64),
            points=np.concatenate(
                [np.zeros((0, 2), dtype=np.uint8), *(stroke.reshape(-1, 2) for stroke in strokes)]
            ).astype(np.uint8),
            stroke_offsets=_offsets([len(stroke) for stroke in strokes]),
            drawing_offsets=_offsets([len(exemplar.strokes) for exemplar in ordered]),
        )

    def save(self, directory: Path, meta: dict[str, object]) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / META_FILE).unlink(missing_ok=True)
        for name, array in self._arrays().items():
            np.save(directory / name, array, allow_pickle=False)
        described = {
            **meta,
            "version": FORMAT_VERSION,
            "count": self.count,
            "categories": list(self.categories),
        }
        (directory / META_FILE).write_text(json.dumps(described, indent=2, sort_keys=True))

    def _arrays(self) -> dict[str, NDArray[np.generic]]:
        return {
            EMBEDDINGS_FILE: self.embeddings,
            LABELS_FILE: self.labels,
            PROBABILITIES_FILE: self.probabilities,
            KEY_IDS_FILE: self.key_ids,
            POINTS_FILE: self.points,
            STROKE_OFFSETS_FILE: self.stroke_offsets,
            DRAWING_OFFSETS_FILE: self.drawing_offsets,
        }


def _offsets(lengths: Sequence[int]) -> NDArray[np.uint32]:
    return np.concatenate([[0], np.cumsum(lengths, dtype=np.int64)]).astype(np.uint32)


def _load_array(path: Path, dtype: type[ScalarT]) -> NDArray[ScalarT]:
    loaded: NDArray[ScalarT] = np.load(path, allow_pickle=False)
    if loaded.dtype != np.dtype(dtype):
        raise ExemplarSetError(f"{path.name} holds {loaded.dtype}, not {np.dtype(dtype)}")
    return loaded


def model_sha256(model_dir: Path) -> str:
    digest = hashlib.sha256()
    with (model_dir / MODEL_FILE).open("rb") as model:
        while chunk := model.read(HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def load_meta(directory: Path) -> dict[str, object]:
    meta: dict[str, object] = json.loads((directory / META_FILE).read_text())
    if meta.get("version") != FORMAT_VERSION:
        raise ExemplarSetError(f"{directory} is not a version {FORMAT_VERSION} exemplar set")
    return meta


def load_exemplars(directory: Path) -> ExemplarSet:
    meta = load_meta(directory)
    categories = meta.get("categories")
    if not isinstance(categories, list):
        raise ExemplarSetError(f"{directory / META_FILE} names no categories")
    return ExemplarSet(
        categories=tuple(str(category) for category in categories),
        embeddings=_load_array(directory / EMBEDDINGS_FILE, np.float16),
        labels=_load_array(directory / LABELS_FILE, np.int32),
        probabilities=_load_array(directory / PROBABILITIES_FILE, np.float16),
        key_ids=_load_array(directory / KEY_IDS_FILE, np.uint64),
        points=_load_array(directory / POINTS_FILE, np.uint8),
        stroke_offsets=_load_array(directory / STROKE_OFFSETS_FILE, np.uint32),
        drawing_offsets=_load_array(directory / DRAWING_OFFSETS_FILE, np.uint32),
    )


def load_exemplars_of_model(model_dir: Path) -> ExemplarSet | None:
    """The model's exemplar set; None when it has none; an error when it is another model's."""
    directory = model_dir / EXEMPLARS_DIR
    if not (directory / META_FILE).exists():
        return None
    if load_meta(directory).get("modelSha256") != model_sha256(model_dir):
        raise ExemplarSetError(f"{directory} was built with another model.onnx; rebuild it")
    return load_exemplars(directory)
