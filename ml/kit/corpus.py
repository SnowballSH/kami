"""The drawings a run learns from, kept as the downloaded Quick, Draw! `.bin` files themselves
plus a small index: per drawing its category, byte offset, key_id, split and rank among its
category's recognised drawings. Nothing is pre-rendered; a drawing is decoded where it is needed.

The index is a few flat `.npy` files, memory-mapped, so a DataLoader worker opens it in
milliseconds and a pickled `Corpus` is only its paths.
"""

from __future__ import annotations

import hashlib
import json
import mmap
import multiprocessing
from collections.abc import Callable
from dataclasses import dataclass
from functools import cached_property
from itertools import islice
from pathlib import Path
from typing import Self

import numpy as np
from numpy.typing import NDArray

from quickdraw_bin import Drawing, category_path, decode_drawing, located_drawings
from render import PointArray, from_xy_arrays
from splits import Split, splits_of

META_FILE = "meta.json"
ARRAYS = ("labels", "offsets", "key_ids", "splits", "ranks")
INDEX_VERSION = 1


@dataclass(frozen=True, slots=True)
class CorpusSpec:
    """Per category, the first `drawings_per_class` drawings Quick, Draw! recognised, in file
    order."""

    categories: tuple[str, ...]
    drawings_per_class: int

    def fingerprint(self) -> dict[str, object]:
        return {
            "version": INDEX_VERSION,
            "categories": list(self.categories),
            "drawingsPerClass": self.drawings_per_class,
        }

    def directory_name(self) -> str:
        digest = hashlib.sha256(json.dumps(self.fingerprint()).encode()).hexdigest()[:12]
        return f"{len(self.categories)}x{self.drawings_per_class}-{digest}"


@dataclass(frozen=True, slots=True)
class _CategoryIndex:
    offsets: NDArray[np.int64]
    key_ids: NDArray[np.uint64]


def _index_category(task: tuple[Path, int]) -> _CategoryIndex:
    path, wanted = task
    recognised = (
        (offset, drawing.key_id)
        for offset, drawing in located_drawings(path.read_bytes())
        if drawing.recognized
    )
    found = list(islice(recognised, wanted))
    offsets = np.fromiter((offset for offset, _ in found), dtype=np.int64, count=len(found))
    key_ids = np.fromiter((key_id for _, key_id in found), dtype=np.uint64, count=len(found))
    return _CategoryIndex(offsets, key_ids)


class Corpus:
    """Drawing `i` is `categories[labels[i]]`, record `offsets[i]` of that category's `.bin`."""

    def __init__(self, directory: Path, bin_dir: Path) -> None:
        self.directory = directory
        self.bin_dir = bin_dir
        meta = json.loads((directory / META_FILE).read_text())
        self.categories: tuple[str, ...] = tuple(meta["categories"])
        self.drawings_per_class: int = int(meta["drawingsPerClass"])
        self._buffers: dict[int, mmap.mmap] = {}

    def __reduce__(self) -> tuple[Callable[[Path, Path], Corpus], tuple[Path, Path]]:
        return Corpus, (self.directory, self.bin_dir)

    def _array(self, name: str) -> NDArray[np.generic]:
        array: NDArray[np.generic] = np.load(self.directory / f"{name}.npy", mmap_mode="r")
        return array

    @cached_property
    def labels(self) -> NDArray[np.int16]:
        return np.asarray(self._array("labels"), dtype=np.int16)

    @cached_property
    def offsets(self) -> NDArray[np.int64]:
        return np.asarray(self._array("offsets"), dtype=np.int64)

    @cached_property
    def key_ids(self) -> NDArray[np.uint64]:
        return np.asarray(self._array("key_ids"), dtype=np.uint64)

    @cached_property
    def splits(self) -> NDArray[np.uint8]:
        return np.asarray(self._array("splits"), dtype=np.uint8)

    @cached_property
    def ranks(self) -> NDArray[np.int32]:
        return np.asarray(self._array("ranks"), dtype=np.int32)

    def __len__(self) -> int:
        return len(self.labels)

    def counts(self) -> dict[str, int]:
        per_label = np.bincount(self.labels, minlength=len(self.categories))
        return dict(zip(self.categories, (int(count) for count in per_label), strict=True))

    def indices(self, split: Split, head: int | None = None) -> NDArray[np.int64]:
        """The drawings of `split`, optionally only among each category's first `head`."""
        chosen = self.splits == split
        if head is not None:
            chosen &= self.ranks < head
        return np.flatnonzero(chosen).astype(np.int64)

    def _buffer(self, label: int) -> mmap.mmap:
        if label not in self._buffers:
            path = category_path(self.bin_dir, self.categories[label])
            with path.open("rb") as source:
                self._buffers[label] = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
        return self._buffers[label]

    def drawing(self, index: int) -> Drawing:
        label = int(self.labels[index])
        return decode_drawing(memoryview(self._buffer(label)), int(self.offsets[index]))

    def strokes(self, index: int) -> list[PointArray]:
        return from_xy_arrays(self.drawing(index).strokes)

    @classmethod
    def build(
        cls,
        spec: CorpusSpec,
        bin_dir: Path,
        index_root: Path,
        workers: int | None = None,
        *,
        rebuild: bool = False,
    ) -> Self:
        """The index of `spec` under `index_root`, built unless an identical one is there."""
        directory = index_root / spec.directory_name()
        meta_path = directory / META_FILE
        if not rebuild and meta_path.exists():
            meta = json.loads(meta_path.read_text())
            if {key: meta.get(key) for key in spec.fingerprint()} == spec.fingerprint():
                return cls(directory, bin_dir)
        directory.mkdir(parents=True, exist_ok=True)
        meta_path.unlink(missing_ok=True)
        tasks = [
            (category_path(bin_dir, category), spec.drawings_per_class)
            for category in spec.categories
        ]
        with multiprocessing.get_context("spawn").Pool(workers) as pool:
            per_category = pool.map(_index_category, tasks)
        key_ids = np.concatenate([found.key_ids for found in per_category])
        arrays: dict[str, NDArray[np.generic]] = {
            "labels": np.concatenate(
                [
                    np.full(len(found.offsets), label, dtype=np.int16)
                    for label, found in enumerate(per_category)
                ]
            ),
            "offsets": np.concatenate([found.offsets for found in per_category]),
            "key_ids": key_ids,
            "splits": splits_of(key_ids),
            "ranks": np.concatenate(
                [np.arange(len(found.offsets), dtype=np.int32) for found in per_category]
            ),
        }
        for name in ARRAYS:
            np.save(directory / f"{name}.npy", arrays[name])
        counts = {
            category: len(found.offsets)
            for category, found in zip(spec.categories, per_category, strict=True)
        }
        meta_path.write_text(
            json.dumps({**spec.fingerprint(), "count": len(key_ids), "counts": counts}, indent=2)
        )
        return cls(directory, bin_dir)
