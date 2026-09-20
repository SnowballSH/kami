"""Batches from the image memmap to the device, read ahead on background threads."""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass

import numpy as np
import torch
from numpy.typing import NDArray
from torch import Tensor

from dataset import SketchDataset
from prefetch import ordered_map, prefetch
from render import INK
from teacher import TeacherLogits
from views import FINISHED_VIEW, ViewSampler


@dataclass(frozen=True, slots=True)
class Rows:
    """The images of one batch: drawing `indices[i]` as seen in `views[i]`.

    A paired batch lists every drawing twice: the first half finished, the second half as a prefix.
    """

    indices: NDArray[np.int64]
    views: NDArray[np.int64]
    paired: bool = False


@dataclass(frozen=True, slots=True)
class Batch:
    images: Tensor
    labels: Tensor
    indices: NDArray[np.int64]
    teacher_logits: Tensor | None = None
    paired: bool = False


def _chunks(order: NDArray[np.int64], size: int) -> list[NDArray[np.int64]]:
    return [np.sort(order[start : start + size]) for start in range(0, len(order), size)]


def sequential_rows(indices: NDArray[np.int64], view: int, batch_size: int) -> list[Rows]:
    return [Rows(chunk, np.full(len(chunk), view)) for chunk in _chunks(indices, batch_size)]


def shuffled_rows(
    indices: NDArray[np.int64],
    batch_size: int,
    shuffle_rng: np.random.Generator,
    sampler: ViewSampler,
    drawing_count: int,
) -> list[Rows]:
    """One epoch over `indices`, each drawing in the view the sampler gives it this epoch."""
    views = np.zeros(drawing_count, dtype=np.int64)
    views[indices] = sampler.views(indices)
    return [
        Rows(chunk, views[chunk]) for chunk in _chunks(shuffle_rng.permutation(indices), batch_size)
    ]


class PairedEpochs:
    """Paired batches spend two images per drawing, so an epoch of image passes is half the
    drawings: every two epochs share one permutation and together cover each drawing once."""

    def __init__(self, indices: NDArray[np.int64], shuffle_rng: np.random.Generator) -> None:
        self._indices = indices
        self._rng = shuffle_rng
        self._pending: NDArray[np.int64] | None = None

    @property
    def drawings_per_epoch(self) -> int:
        return len(self._indices) // 2

    def next_drawings(self) -> NDArray[np.int64]:
        if self._pending is not None:
            drawings, self._pending = self._pending, None
            return drawings
        order = self._rng.permutation(self._indices)
        half = self.drawings_per_epoch
        self._pending = order[half : 2 * half]
        return order[:half]


def paired_rows(
    drawings: NDArray[np.int64], batch_size: int, sampler: ViewSampler, drawing_count: int
) -> list[Rows]:
    prefixes = np.zeros(drawing_count, dtype=np.int64)
    prefixes[drawings] = sampler.prefix_views(drawings)
    return [
        Rows(
            np.concatenate([chunk, chunk]),
            np.concatenate([np.full(len(chunk), FINISHED_VIEW), prefixes[chunk]]),
            paired=True,
        )
        for chunk in _chunks(drawings, batch_size // 2)
    ]


@dataclass(frozen=True, slots=True)
class _HostBatch:
    images: Tensor
    labels: Tensor
    teacher_logits: Tensor | None
    rows: Rows


def _read_batch(dataset: SketchDataset, teacher: TeacherLogits | None, rows: Rows) -> _HostBatch:
    images = torch.from_numpy(np.ascontiguousarray(dataset.images[rows.indices, rows.views]))
    labels = torch.from_numpy(dataset.labels[rows.indices])
    taught = torch.from_numpy(teacher.rows(rows.indices)) if teacher is not None else None
    return _HostBatch(images, labels, taught, rows)


def _on_device(batch: _HostBatch, device: torch.device) -> Batch:
    taught = batch.teacher_logits
    return Batch(
        batch.images.to(device, non_blocking=True).unsqueeze(1).float().div_(INK),
        batch.labels.to(device, non_blocking=True),
        batch.rows.indices,
        taught.to(device, non_blocking=True).float() if taught is not None else None,
        batch.rows.paired,
    )


@contextmanager
def iterate_batches(
    dataset: SketchDataset,
    rows: Sequence[Rows],
    device: torch.device,
    teacher: TeacherLogits | None = None,
    readers: int = 1,
) -> Iterator[Iterator[Batch]]:
    """Float [N, 1, 64, 64] images with ink = 1.0, labels, and the teacher's logits when given."""

    def read(batch_rows: Rows) -> _HostBatch:
        return _read_batch(dataset, teacher, batch_rows)

    with prefetch(ordered_map(read, rows, readers)) as pending:
        yield (_on_device(batch, device) for batch in pending)
