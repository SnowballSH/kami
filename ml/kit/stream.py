"""Batches rendered on the fly in DataLoader worker processes, straight from the corpus.

A training batch is named by its global step: the step fixes the drawings (the epoch's
permutation, from the seed) and every random choice made for them (a generator seeded by the seed
and the step). So the images do not depend on how many workers render them, and a run resumed at
step s continues with exactly the batches it would have trained on.
"""

from __future__ import annotations

import signal
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import NamedTuple

import numpy as np
import torch
from numpy.typing import NDArray
from torch.utils.data import DataLoader, Dataset, Sampler

from kit.corpus import Corpus
from kit.looks import FINISHED, LookPolicy, held_out_look, held_out_prefix_fraction, training_look
from render import SIZE

TRAIN_STREAM = 0x54524149
PREFETCH_BATCHES_PER_WORKER = 4


class HostBatch(NamedTuple):
    images: torch.Tensor
    labels: torch.Tensor
    fractions: torch.Tensor


@dataclass(frozen=True, slots=True)
class EpochPlan:
    """`epochs` passes over `drawings` in batches of `batch_size`; the last partial batch of each
    epoch is dropped so every step has the same shape (fewer kernels to build and cache)."""

    drawings: NDArray[np.int64]
    batch_size: int
    epochs: int
    seed: int
    _permutations: dict[int, NDArray[np.int64]] = field(default_factory=dict, compare=False)

    def __post_init__(self) -> None:
        if self.steps_per_epoch == 0:
            raise ValueError(f"{len(self.drawings)} drawings make no batch of {self.batch_size}")

    @property
    def steps_per_epoch(self) -> int:
        return len(self.drawings) // self.batch_size

    @property
    def total_steps(self) -> int:
        return self.steps_per_epoch * self.epochs

    def epoch_of(self, step: int) -> int:
        return step // self.steps_per_epoch

    def _permutation(self, epoch: int) -> NDArray[np.int64]:
        if epoch not in self._permutations:
            self._permutations.clear()
            rng = np.random.default_rng([self.seed, TRAIN_STREAM, epoch])
            self._permutations[epoch] = rng.permutation(self.drawings)
        return self._permutations[epoch]

    def batch(self, step: int) -> NDArray[np.int64]:
        start = (step % self.steps_per_epoch) * self.batch_size
        return self._permutation(self.epoch_of(step))[start : start + self.batch_size]


class Step(NamedTuple):
    step: int
    drawings: NDArray[np.int64]


class StepSampler(Sampler[Step]):
    def __init__(self, plan: EpochPlan, first_step: int, last_step: int | None = None) -> None:
        self._plan = plan
        self._first = first_step
        self._last = plan.total_steps if last_step is None else last_step

    def __len__(self) -> int:
        return max(0, self._last - self._first)

    def __iter__(self) -> Iterator[Step]:
        return (Step(step, self._plan.batch(step)) for step in range(self._first, self._last))


class TrainingImages(Dataset[HostBatch]):
    def __init__(self, corpus: Corpus, policy: LookPolicy, seed: int) -> None:
        self._corpus = corpus
        self._policy = policy
        self._seed = seed

    def __getitem__(self, item: Step) -> HostBatch:
        rng = np.random.default_rng([self._seed, TRAIN_STREAM, item.step])
        images = np.empty((len(item.drawings), SIZE, SIZE), dtype=np.uint8)
        fractions = np.empty(len(item.drawings), dtype=np.float32)
        for row, index in enumerate(item.drawings):
            images[row], fractions[row] = training_look(
                self._corpus.strokes(int(index)), self._policy, rng
            )
        labels = torch.from_numpy(self._corpus.labels[item.drawings].astype(np.int64))
        return HostBatch(torch.from_numpy(images), labels, torch.from_numpy(fractions))


@dataclass(frozen=True, slots=True)
class HeldOutRows:
    """Held-out drawings, each read twice: row r < n is drawing r finished, row n + r its prefix."""

    drawings: NDArray[np.int64]
    fractions: NDArray[np.float32]

    @staticmethod
    def of(corpus: Corpus, drawings: NDArray[np.int64]) -> HeldOutRows:
        prefixes = [held_out_prefix_fraction(int(key_id)) for key_id in corpus.key_ids[drawings]]
        fractions = np.concatenate([np.full(len(drawings), FINISHED), np.asarray(prefixes)]).astype(
            np.float32
        )
        return HeldOutRows(np.concatenate([drawings, drawings]), fractions)

    def __len__(self) -> int:
        return len(self.drawings)

    def chunks(self, batch_size: int) -> list[slice]:
        return [slice(start, start + batch_size) for start in range(0, len(self), batch_size)]


class HeldOutImages(Dataset[HostBatch]):
    def __init__(self, corpus: Corpus, rows: HeldOutRows) -> None:
        self._corpus = corpus
        self._rows = rows

    def __getitem__(self, chunk: slice) -> HostBatch:
        drawings = self._rows.drawings[chunk]
        fractions = self._rows.fractions[chunk]
        images = np.stack(
            [
                held_out_look(self._corpus.strokes(int(index)), float(fraction))
                for index, fraction in zip(drawings, fractions, strict=True)
            ]
        )
        labels = torch.from_numpy(self._corpus.labels[drawings].astype(np.int64))
        return HostBatch(torch.from_numpy(images), labels, torch.from_numpy(fractions))


def _ignore_terminal_signals(_: int) -> None:
    """Ctrl-C reaches the whole process group; only the trainer decides how to stop."""
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGHUP, signal.SIG_IGN)


def batch_loader(
    dataset: Dataset[HostBatch],
    sampler: Sampler[Step] | list[slice],
    workers: int,
    pin_memory: bool,
    persistent: bool = False,
) -> DataLoader[HostBatch]:
    """Each item is already a whole batch; workers render, the main process only moves it."""
    return DataLoader(
        dataset,
        batch_size=None,
        sampler=sampler,
        num_workers=workers,
        pin_memory=pin_memory,
        persistent_workers=persistent and workers > 0,
        prefetch_factor=PREFETCH_BATCHES_PER_WORKER if workers > 0 else None,
        multiprocessing_context="spawn" if workers > 0 else None,
        worker_init_fn=_ignore_terminal_signals if workers > 0 else None,
    )
