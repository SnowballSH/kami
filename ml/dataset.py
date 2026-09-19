"""Pre-rendered Quick, Draw! images as a uint8 memmap: half are prefixes, split by key_id hash."""

from __future__ import annotations

import json
import multiprocessing
import os
from dataclasses import asdict, dataclass
from enum import IntEnum
from itertools import islice
from pathlib import Path

import numpy as np
from numpy.typing import NDArray
from tqdm import tqdm

from quickdraw_bin import category_path, read_drawings
from render import SIZE, THICKNESS, from_xy_arrays, render, render_prefix, render_source_sha256

IMAGES_FILE = "images.u8"
LABELS_FILE = "labels.npy"
FRACTIONS_FILE = "fractions.npy"
SPLITS_FILE = "splits.npy"
KEY_IDS_FILE = "key_ids.npy"
META_FILE = "meta.json"

FULL_FRACTION = 1.0
TRAIN_PERCENT = 90
VAL_PERCENT = 5

_MASK_64 = (1 << 64) - 1
_SPLITMIX_INCREMENT = 0x9E3779B97F4A7C15
_SPLITMIX_MULTIPLIER_A = 0xBF58476D1CE4E5B9
_SPLITMIX_MULTIPLIER_B = 0x94D049BB133111EB


class Split(IntEnum):
    TRAIN = 0
    VAL = 1
    TEST = 2


def split_of(key_id: int) -> Split:
    """A drawing's split from the splitmix64 hash of its key_id: 90 % train, 5 % val, 5 % test."""
    mixed = (key_id + _SPLITMIX_INCREMENT) & _MASK_64
    mixed = ((mixed ^ (mixed >> 30)) * _SPLITMIX_MULTIPLIER_A) & _MASK_64
    mixed = ((mixed ^ (mixed >> 27)) * _SPLITMIX_MULTIPLIER_B) & _MASK_64
    bucket = (mixed ^ (mixed >> 31)) % 100
    if bucket < TRAIN_PERCENT:
        return Split.TRAIN
    return Split.VAL if bucket < TRAIN_PERCENT + VAL_PERCENT else Split.TEST


@dataclass(frozen=True, slots=True)
class DatasetSpec:
    categories: tuple[str, ...]
    samples_per_class: int
    prefix_share: float = 0.5
    min_prefix_fraction: float = 0.3
    thickness_jitter: int = 0
    seed: int = 0

    def fingerprint(self) -> dict[str, object]:
        return {
            **asdict(self),
            "categories": list(self.categories),
            "renderSha256": render_source_sha256(),
        }


@dataclass(frozen=True, slots=True)
class SketchDataset:
    categories: tuple[str, ...]
    images: NDArray[np.uint8]
    labels: NDArray[np.int64]
    fractions: NDArray[np.float32]
    splits: NDArray[np.uint8]
    key_ids: NDArray[np.uint64]

    def indices(self, split: Split) -> NDArray[np.int64]:
        return np.flatnonzero(self.splits == split).astype(np.int64)


@dataclass(frozen=True, slots=True)
class _CategoryTask:
    bin_path: Path
    label: int
    spec: DatasetSpec


@dataclass(frozen=True, slots=True)
class _CategoryRender:
    images: NDArray[np.uint8]
    fractions: NDArray[np.float32]
    splits: NDArray[np.uint8]
    key_ids: NDArray[np.uint64]


def _render_category(task: _CategoryTask) -> _CategoryRender:
    spec = task.spec
    rng = np.random.default_rng([spec.seed, task.label])
    recognised = (drawing for drawing in read_drawings(task.bin_path) if drawing.recognized)
    images: list[NDArray[np.uint8]] = []
    fractions: list[float] = []
    splits: list[int] = []
    key_ids: list[int] = []
    for drawing in islice(recognised, spec.samples_per_class):
        is_prefix = rng.random() < spec.prefix_share
        prefix_fraction = float(rng.uniform(spec.min_prefix_fraction, FULL_FRACTION))
        jitter = int(rng.integers(-spec.thickness_jitter, spec.thickness_jitter + 1))
        split = split_of(drawing.key_id)
        thickness = THICKNESS + jitter if split is Split.TRAIN else THICKNESS
        strokes = from_xy_arrays(drawing.strokes)
        images.append(
            render_prefix(strokes, prefix_fraction, thickness=thickness)
            if is_prefix
            else render(strokes, thickness=thickness)
        )
        fractions.append(prefix_fraction if is_prefix else FULL_FRACTION)
        splits.append(split)
        key_ids.append(drawing.key_id)
    return _CategoryRender(
        np.stack(images) if images else np.zeros((0, SIZE, SIZE), dtype=np.uint8),
        np.asarray(fractions, dtype=np.float32),
        np.asarray(splits, dtype=np.uint8),
        np.asarray(key_ids, dtype=np.uint64),
    )


def build_dataset(spec: DatasetSpec, bin_dir: Path, out_dir: Path) -> SketchDataset:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / META_FILE).unlink(missing_ok=True)
    tasks = [
        _CategoryTask(category_path(bin_dir, category), label, spec)
        for label, category in enumerate(spec.categories)
    ]
    capacity = len(tasks) * spec.samples_per_class
    images = np.memmap(
        out_dir / IMAGES_FILE, dtype=np.uint8, mode="w+", shape=(capacity, SIZE, SIZE)
    )
    labels: list[NDArray[np.int64]] = []
    fractions: list[NDArray[np.float32]] = []
    splits: list[NDArray[np.uint8]] = []
    key_ids: list[NDArray[np.uint64]] = []
    written = 0
    with multiprocessing.Pool() as pool:
        results = tqdm(
            pool.imap(_render_category, tasks), total=len(tasks), desc="render", unit="class"
        )
        for task, result in zip(tasks, results, strict=True):
            count = len(result.images)
            if count < spec.samples_per_class:
                tqdm.write(
                    f"{spec.categories[task.label]}: only {count} recognised drawings on disk"
                )
            images[written : written + count] = result.images
            labels.append(np.full(count, task.label, dtype=np.int64))
            fractions.append(result.fractions)
            splits.append(result.splits)
            key_ids.append(result.key_ids)
            written += count
    images.flush()
    del images
    os.truncate(out_dir / IMAGES_FILE, written * SIZE * SIZE)

    np.save(out_dir / LABELS_FILE, np.concatenate(labels))
    np.save(out_dir / FRACTIONS_FILE, np.concatenate(fractions))
    np.save(out_dir / SPLITS_FILE, np.concatenate(splits))
    np.save(out_dir / KEY_IDS_FILE, np.concatenate(key_ids))
    (out_dir / META_FILE).write_text(json.dumps({**spec.fingerprint(), "count": written}, indent=2))
    return load_dataset(out_dir)


def load_dataset(out_dir: Path) -> SketchDataset:
    meta = json.loads((out_dir / META_FILE).read_text())
    count = int(meta["count"])
    return SketchDataset(
        categories=tuple(meta["categories"]),
        images=np.memmap(
            out_dir / IMAGES_FILE, dtype=np.uint8, mode="r", shape=(count, SIZE, SIZE)
        ),
        labels=np.load(out_dir / LABELS_FILE),
        fractions=np.load(out_dir / FRACTIONS_FILE),
        splits=np.load(out_dir / SPLITS_FILE),
        key_ids=np.load(out_dir / KEY_IDS_FILE),
    )


def ensure_dataset(spec: DatasetSpec, bin_dir: Path, out_dir: Path) -> SketchDataset:
    """Reuse the dataset in `out_dir` when it was built from this exact spec and renderer."""
    meta_path = out_dir / META_FILE
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        if {key: meta.get(key) for key in spec.fingerprint()} == spec.fingerprint():
            return load_dataset(out_dir)
    return build_dataset(spec, bin_dir, out_dir)
