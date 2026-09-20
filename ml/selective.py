"""How far a confidence can be trusted: expected calibration error and selective prediction."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

ECE_BINS = 15
CERTAIN_PRECISION = 0.95
MIN_CERTAIN_COVERAGE = 0.005


def expected_calibration_error(
    confidence: NDArray[np.float64], correct: NDArray[np.bool_], bins: int = ECE_BINS
) -> float:
    if len(confidence) == 0:
        return float("nan")
    bin_of = np.minimum((confidence * bins).astype(np.int64), bins - 1)
    counts = np.bincount(bin_of, minlength=bins)
    filled = counts > 0
    mean_confidence = np.bincount(bin_of, weights=confidence, minlength=bins)[filled]
    mean_accuracy = np.bincount(bin_of, weights=correct.astype(np.float64), minlength=bins)[filled]
    gaps = np.abs(mean_confidence - mean_accuracy) / counts[filled]
    return float((gaps * counts[filled]).sum() / len(confidence))


@dataclass(frozen=True, slots=True)
class SelectiveOperatingPoint:
    """Naming only drawings whose confidence is >= `floor` covers `coverage` of them at the asked
    precision; `floor` is None (and coverage 0) when no worthwhile share reaches that precision."""

    coverage: float
    floor: float | None


def coverage_at_precision(
    confidence: NDArray[np.float64],
    correct: NDArray[np.bool_],
    precision: float = CERTAIN_PRECISION,
    min_coverage: float = MIN_CERTAIN_COVERAGE,
) -> SelectiveOperatingPoint:
    """The largest share of drawings, most confident first, right `precision` of the time."""
    if len(confidence) == 0:
        return SelectiveOperatingPoint(0.0, None)
    order = np.argsort(-confidence, kind="stable")
    ranked_confidence = confidence[order]
    hits = np.cumsum(correct[order])
    named = np.arange(1, len(order) + 1)
    ends_a_tie = np.append(ranked_confidence[1:] != ranked_confidence[:-1], True)
    reaches = np.flatnonzero((hits / named >= precision) & ends_a_tie)
    if len(reaches) == 0 or named[reaches[-1]] / len(order) < min_coverage:
        return SelectiveOperatingPoint(0.0, None)
    last = int(reaches[-1])
    return SelectiveOperatingPoint(float(named[last] / len(order)), float(ranked_confidence[last]))
