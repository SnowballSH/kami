"""Which look at a drawing a training step gets: the finished render or one stratified prefix."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np
from numpy.typing import NDArray

FINISHED_VIEW = 0
EARLY_VIEW = 1
MID_VIEW = 2
SINGLE_VIEW_COUNT = 1
STRATIFIED_VIEW_COUNT = 4
PREFIX_VIEW_BOUNDS: tuple[tuple[float, float], ...] = ((0.3, 0.5), (0.5, 0.7), (0.7, 1.0))
LEGACY_VIEW_WEIGHTS: tuple[float, ...] = (0.5, 1 / 7, 1 / 7, 3 / 14)
SUPPORTED_VIEW_COUNTS = (SINGLE_VIEW_COUNT, STRATIFIED_VIEW_COUNT)

_VIEW_STREAM = 0x56494557


class ViewPolicy(StrEnum):
    FIXED = "fixed"
    RESAMPLE = "resample"


@dataclass(frozen=True, slots=True)
class ViewPlan:
    """Sampling weights per view (finished first) and whether each epoch draws them afresh."""

    weights: tuple[float, ...] = (1.0,)
    policy: ViewPolicy = ViewPolicy.FIXED

    def __post_init__(self) -> None:
        if len(self.weights) not in SUPPORTED_VIEW_COUNTS:
            raise ValueError(f"view weights must number one of {SUPPORTED_VIEW_COUNTS}")
        if any(weight < 0 for weight in self.weights) or sum(self.weights) <= 0:
            raise ValueError("view weights must be non-negative and not all zero")

    @property
    def view_count(self) -> int:
        return len(self.weights)

    def probabilities(self) -> NDArray[np.float64]:
        weights = np.asarray(self.weights, dtype=np.float64)
        return np.asarray(weights / weights.sum(), dtype=np.float64)

    def prefix_probabilities(self) -> NDArray[np.float64]:
        """The prefix views' shares among themselves, for the prefix half of a paired batch."""
        weights = np.asarray(self.weights[FINISHED_VIEW + 1 :], dtype=np.float64)
        if weights.sum() <= 0:
            raise ValueError("paired batches need a prefix view with positive weight")
        return np.asarray(weights / weights.sum(), dtype=np.float64)


def parse_view_weights(text: str) -> tuple[float, ...]:
    return tuple(float(weight) for weight in text.split(","))


class ViewSampler:
    """One view per drawing per epoch; a fixed plan keeps the first draw for the whole run."""

    def __init__(self, plan: ViewPlan, drawing_count: int, seed: int) -> None:
        self._plan = plan
        self._rng = np.random.default_rng([seed, _VIEW_STREAM])
        fixed = plan.policy is ViewPolicy.FIXED
        self._fixed_views = self._draw(drawing_count, prefix_only=False) if fixed else None
        self._fixed_prefixes = (
            self._draw(drawing_count, prefix_only=True) if fixed and plan.view_count > 1 else None
        )

    def _draw(self, count: int, *, prefix_only: bool) -> NDArray[np.int64]:
        if prefix_only:
            shares = self._plan.prefix_probabilities()
            return (self._rng.choice(len(shares), size=count, p=shares) + 1).astype(np.int64)
        shares = self._plan.probabilities()
        return self._rng.choice(len(shares), size=count, p=shares).astype(np.int64)

    def views(self, indices: NDArray[np.int64]) -> NDArray[np.int64]:
        if self._fixed_views is not None:
            return self._fixed_views[indices]
        return self._draw(len(indices), prefix_only=False)

    def prefix_views(self, indices: NDArray[np.int64]) -> NDArray[np.int64]:
        if self._plan.view_count == SINGLE_VIEW_COUNT:
            raise ValueError("a single-view dataset has no prefix views to pair with")
        if self._fixed_prefixes is not None:
            return self._fixed_prefixes[indices]
        return self._draw(len(indices), prefix_only=True)
