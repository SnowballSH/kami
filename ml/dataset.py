"""Pre-rendered Quick, Draw! images as a uint8 memmap [N, V, 64, 64], split by key_id hash.

One view per drawing (V = 1) is the first recipe: half the drawings are one random prefix. Four
views (V = 4) keep every drawing finished plus one prefix in each band of `views.py`.
"""

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
from render import (
    SIZE,
    THICKNESS,
    PointArray,
    from_xy_arrays,
    render,
    render_prefix,
    render_source_sha256,
)
from views import PREFIX_VIEW_BOUNDS, SINGLE_VIEW_COUNT, SUPPORTED_VIEW_COUNTS

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
    views: int = SINGLE_VIEW_COUNT

    def __post_init__(self) -> None:
        if self.views not in SUPPORTED_VIEW_COUNTS:
            raise ValueError(f"views must be one of {SUPPORTED_VIEW_COUNTS}")

    def fingerprint(self) -> dict[str, object]:
        """What a build depends on; a single-view spec keeps the fingerprint it always had."""
        fingerprint: dict[str, object] = {
            **asdict(self),
            "categories": list(self.categories),
            "renderSha256": render_source_sha256(),
        }
        if self.views == SINGLE_VIEW_COUNT:
            del fingerprint["views"]
        else:
            fingerprint["viewBounds"] = [list(bounds) for bounds in PREFIX_VIEW_BOUNDS]
        return fingerprint


@dataclass(frozen=True, slots=True)
class SketchDataset:
    categories: tuple[str, ...]
    images: NDArray[np.uint8]
    labels: NDArray[np.int64]
    fractions: NDArray[np.float32]
    splits: NDArray[np.uint8]
    key_ids: NDArray[np.uint64]

    @property
    def view_count(self) -> int:
        return int(self.images.shape[1])

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


def _single_view_fractions(spec: DatasetSpec, rng: np.random.Generator) -> list[float]:
    is_prefix = rng.random() < spec.prefix_share
    prefix_fraction = float(rng.uniform(spec.min_prefix_fraction, FULL_FRACTION))
    return [prefix_fraction if is_prefix else FULL_FRACTION]


def _stratified_fractions(rng: np.random.Generator) -> list[float]:
    return [FULL_FRACTION, *(float(rng.uniform(low, high)) for low, high in PREFIX_VIEW_BOUNDS)]


def _render_view(strokes: list[PointArray], fraction: float, thickness: int) -> NDArray[np.uint8]:
    if fraction >= FULL_FRACTION:
        return render(strokes, thickness=thickness)
    return render_prefix(strokes, fraction, thickness=thickness)


def _render_category(task: _CategoryTask) -> _CategoryRender:
    spec = task.spec
    rng = np.random.default_rng([spec.seed, task.label])
    recognised = (drawing for drawing in read_drawings(task.bin_path) if drawing.recognized)
    images = np.zeros((spec.samples_per_class, spec.views, SIZE, SIZE), dtype=np.uint8)
    fractions: list[list[float]] = []
    splits: list[int] = []
    key_ids: list[int] = []
    for row, drawing in enumerate(islice(recognised, spec.samples_per_class)):
        view_fractions = (
            _single_view_fractions(spec, rng)
            if spec.views == SINGLE_VIEW_COUNT
            else _stratified_fractions(rng)
        )
        jitter = int(rng.integers(-spec.thickness_jitter, spec.thickness_jitter + 1))
        split = split_of(drawing.key_id)
        thickness = THICKNESS + jitter if split is Split.TRAIN else THICKNESS
        strokes = from_xy_arrays(drawing.strokes)
        for view, fraction in enumerate(view_fractions):
            images[row, view] = _render_view(strokes, fraction, thickness)
        fractions.append(view_fractions)
        splits.append(split)
        key_ids.append(drawing.key_id)
    return _CategoryRender(
        images[: len(key_ids)],
        np.asarray(fractions, dtype=np.float32).reshape(len(key_ids), spec.views),
        np.asarray(splits, dtype=np.uint8),
        np.asarray(key_ids, dtype=np.uint64),
    )


def build_dataset(
    spec: DatasetSpec, bin_dir: Path, out_dir: Path, workers: int | None = None
) -> SketchDataset:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / META_FILE).unlink(missing_ok=True)
    tasks = [
        _CategoryTask(category_path(bin_dir, category), label, spec)
        for label, category in enumerate(spec.categories)
    ]
    capacity = len(tasks) * spec.samples_per_class
    images = np.memmap(
        out_dir / IMAGES_FILE, dtype=np.uint8, mode="w+", shape=(capacity, spec.views, SIZE, SIZE)
    )
    labels: list[NDArray[np.int64]] = []
    fractions: list[NDArray[np.float32]] = []
    splits: list[NDArray[np.uint8]] = []
    key_ids: list[NDArray[np.uint64]] = []
    written = 0
    with multiprocessing.Pool(workers) as pool:
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
    os.truncate(out_dir / IMAGES_FILE, written * spec.views * SIZE * SIZE)

    np.save(out_dir / LABELS_FILE, np.concatenate(labels))
    all_fractions = np.concatenate(fractions)
    single_view = spec.views == SINGLE_VIEW_COUNT
    np.save(out_dir / FRACTIONS_FILE, all_fractions[:, 0] if single_view else all_fractions)
    np.save(out_dir / SPLITS_FILE, np.concatenate(splits))
    np.save(out_dir / KEY_IDS_FILE, np.concatenate(key_ids))
    (out_dir / META_FILE).write_text(json.dumps({**spec.fingerprint(), "count": written}, indent=2))
    return load_dataset(out_dir)


def load_dataset(out_dir: Path) -> SketchDataset:
    meta = json.loads((out_dir / META_FILE).read_text())
    count = int(meta["count"])
    views = int(meta.get("views", SINGLE_VIEW_COUNT))
    return SketchDataset(
        categories=tuple(meta["categories"]),
        images=np.memmap(
            out_dir / IMAGES_FILE, dtype=np.uint8, mode="r", shape=(count, views, SIZE, SIZE)
        ),
        labels=np.load(out_dir / LABELS_FILE),
        fractions=np.load(out_dir / FRACTIONS_FILE).reshape(count, views),
        splits=np.load(out_dir / SPLITS_FILE),
        key_ids=np.load(out_dir / KEY_IDS_FILE),
    )


def matches_spec(meta: dict[str, object], spec: DatasetSpec) -> bool:
    fingerprint = spec.fingerprint()
    same_views = meta.get("views", SINGLE_VIEW_COUNT) == spec.views
    return same_views and {key: meta.get(key) for key in fingerprint} == fingerprint


def ensure_dataset(
    spec: DatasetSpec, bin_dir: Path, out_dir: Path, workers: int | None = None
) -> SketchDataset:
    """Reuse the dataset in `out_dir` when it was built from this exact spec and renderer."""
    meta_path = out_dir / META_FILE
    if meta_path.exists() and matches_spec(json.loads(meta_path.read_text()), spec):
        return load_dataset(out_dir)
    return build_dataset(spec, bin_dir, out_dir, workers)
