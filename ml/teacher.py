"""A teacher's logits on the finished render of every training drawing, kept as float16 [N, K].

The file is tied to the dataset it was computed over by the sha256 of that dataset's key_ids, so a
student can never be taught with rows that belong to other drawings.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from dataset import SketchDataset

META_SUFFIX = ".json"


def key_ids_sha256(dataset: SketchDataset) -> str:
    return hashlib.sha256(np.ascontiguousarray(dataset.key_ids).tobytes()).hexdigest()


def _meta_path(path: Path) -> Path:
    return path.with_suffix(META_SUFFIX)


@dataclass(frozen=True, slots=True)
class TeacherLogits:
    name: str
    logits: NDArray[np.float16]

    def rows(self, indices: NDArray[np.int64]) -> NDArray[np.float16]:
        return np.ascontiguousarray(self.logits[indices])

    @staticmethod
    def create(path: Path, name: str, dataset: SketchDataset) -> NDArray[np.float16]:
        """A zeroed, writable [N, K] file for `dataset`; fill it, drop it (that flushes), `load`."""
        path.parent.mkdir(parents=True, exist_ok=True)
        shape = (len(dataset.labels), len(dataset.categories))
        logits = np.lib.format.open_memmap(path, mode="w+", dtype=np.float16, shape=shape)
        meta = {
            "teacher": name,
            "count": shape[0],
            "classes": shape[1],
            "categories": list(dataset.categories),
            "keyIdsSha256": key_ids_sha256(dataset),
        }
        _meta_path(path).write_text(json.dumps(meta, indent=2))
        return logits

    @staticmethod
    def load(path: Path, dataset: SketchDataset) -> TeacherLogits:
        meta = json.loads(_meta_path(path).read_text())
        if tuple(meta["categories"]) != dataset.categories:
            raise ValueError(f"{path} was computed for other categories than this dataset's")
        if meta["keyIdsSha256"] != key_ids_sha256(dataset):
            raise ValueError(f"{path} was computed over other drawings than this dataset's")
        logits = np.load(path, mmap_mode="r")
        if logits.dtype != np.float16 or logits.shape != (meta["count"], meta["classes"]):
            raise ValueError(f"{path} does not hold float16 [{meta['count']}, {meta['classes']}]")
        return TeacherLogits(str(meta["teacher"]), logits)
