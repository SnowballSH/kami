"""Batches from the image memmap to the device, read ahead on a background thread."""

from __future__ import annotations

import queue
import threading
from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np
import torch
from numpy.typing import NDArray
from torch import Tensor

from dataset import SketchDataset
from render import INK

PREFETCH_BATCHES = 6


@dataclass(frozen=True, slots=True)
class Batch:
    images: Tensor
    labels: Tensor
    indices: NDArray[np.int64]


def _read_batch(dataset: SketchDataset, indices: NDArray[np.int64]) -> tuple[Tensor, Tensor]:
    images = torch.from_numpy(np.ascontiguousarray(dataset.images[indices]))
    labels = torch.from_numpy(dataset.labels[indices])
    return images, labels


def iterate_batches(
    dataset: SketchDataset,
    indices: NDArray[np.int64],
    batch_size: int,
    device: torch.device,
    shuffle_rng: np.random.Generator | None = None,
) -> Iterator[Batch]:
    """Float [N, 1, 64, 64] images with ink = 1.0, and labels; shuffled when given a generator."""
    order = shuffle_rng.permutation(indices) if shuffle_rng is not None else indices
    chunks = [
        np.sort(order[start : start + batch_size]) for start in range(0, len(order), batch_size)
    ]
    pending: queue.Queue[tuple[Tensor, Tensor, NDArray[np.int64]] | None] = queue.Queue(
        PREFETCH_BATCHES
    )

    def produce() -> None:
        for chunk in chunks:
            pending.put((*_read_batch(dataset, chunk), chunk))
        pending.put(None)

    threading.Thread(target=produce, daemon=True).start()
    while (item := pending.get()) is not None:
        images, labels, chunk = item
        yield Batch(
            images.to(device, non_blocking=True).unsqueeze(1).float().div_(INK),
            labels.to(device, non_blocking=True),
            chunk,
        )
