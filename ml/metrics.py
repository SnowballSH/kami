"""Top-1 / top-3 accuracy, overall and bucketed by how much of the drawing the model was shown."""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

import numpy as np
from numpy.typing import NDArray

FULL_FRACTION = 1.0
TOP_K = 3
FULL_BUCKET = "finished"
OVERALL_BUCKET = "overall"
PREFIX_BUCKET_EDGES: tuple[float, ...] = (0.3, 0.5, 0.7, 0.9, 1.0)


@dataclass(frozen=True, slots=True)
class Accuracy:
    count: int
    top1: float
    top3: float


def accuracy(logits: NDArray[np.float32], labels: NDArray[np.int64]) -> Accuracy:
    if len(labels) == 0:
        return Accuracy(0, float("nan"), float("nan"))
    best = np.argsort(-logits, axis=1)[:, :TOP_K]
    hits = best == labels[:, None]
    return Accuracy(len(labels), float(hits[:, 0].mean()), float(hits.any(axis=1).mean()))


def bucket_name(low: float, high: float) -> str:
    return f"prefix {low:.0%}-{high:.0%}"


def bucketed_accuracy(
    logits: NDArray[np.float32], labels: NDArray[np.int64], fractions: NDArray[np.float32]
) -> dict[str, Accuracy]:
    report = {OVERALL_BUCKET: accuracy(logits, labels)}
    for low, high in pairwise(PREFIX_BUCKET_EDGES):
        chosen = (fractions >= low) & (fractions < high)
        report[bucket_name(low, high)] = accuracy(logits[chosen], labels[chosen])
    finished = fractions >= FULL_FRACTION
    report[FULL_BUCKET] = accuracy(logits[finished], labels[finished])
    return report


def format_report(title: str, report: dict[str, Accuracy]) -> str:
    lines = [f"{title:<18}{'n':>9}{'top-1':>9}{'top-3':>9}"]
    lines += [
        f"{name:<18}{result.count:>9}{result.top1:>9.1%}{result.top3:>9.1%}"
        for name, result in report.items()
    ]
    return "\n".join(lines)
