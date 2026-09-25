"""The number experiments are chosen by, fixed before any run (docs/reports/kami-eye-next.md, 4).

On held-out drawings, on alias-folded labels and calibrated folded probabilities:

    S = 0.35 top1(finished) + 0.25 top1(50-70 % of the ink) + 0.20 top3(30-50 %)
        + 0.20 cov95(finished)

in points (0-100); every other field of the report is a share in [0, 1].
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
from numpy.typing import NDArray

from calibrate import RegimeTemperatures
from folding import FoldMap
from metrics import FULL_FRACTION
from selective import coverage_at_precision, expected_calibration_error

WEIGHT_TOP1_FINISHED = 0.35
WEIGHT_TOP1_MID = 0.25
WEIGHT_TOP3_EARLY = 0.20
WEIGHT_COVERAGE = 0.20
MID_BAND = (0.5, 0.7)
EARLY_BAND = (0.3, 0.5)
TOP_K = 3
CHUNK_ROWS = 65_536


@dataclass(frozen=True, slots=True)
class FoldedReading:
    """Per row: the three best folded classes, the calibrated probability of the best, the truth."""

    top: NDArray[np.int64]
    confidence: NDArray[np.float64]
    labels: NDArray[np.int64]

    @property
    def top1_hits(self) -> NDArray[np.bool_]:
        return np.asarray(self.top[:, 0] == self.labels, dtype=np.bool_)

    @property
    def top3_hits(self) -> NDArray[np.bool_]:
        return np.asarray((self.top == self.labels[:, None]).any(axis=1), dtype=np.bool_)


def _softmax(logits: NDArray[np.float32], temperatures: NDArray[np.float64]) -> NDArray[np.float64]:
    scaled = logits.astype(np.float64) / temperatures[:, None]
    exponentials = np.exp(scaled - scaled.max(axis=1, keepdims=True))
    return np.asarray(exponentials / exponentials.sum(axis=1, keepdims=True), dtype=np.float64)


def read_folded(
    logits: NDArray[np.float32],
    labels: NDArray[np.int64],
    temperatures: NDArray[np.float64],
    fold_map: FoldMap,
) -> FoldedReading:
    top: list[NDArray[np.int64]] = []
    confidence: list[NDArray[np.float64]] = []
    for start in range(0, len(labels), CHUNK_ROWS):
        rows = slice(start, start + CHUNK_ROWS)
        folded = fold_map.fold_probabilities(_softmax(logits[rows], temperatures[rows]))
        best = np.argsort(-folded, axis=1)[:, :TOP_K]
        top.append(best)
        confidence.append(folded[np.arange(len(folded)), best[:, 0]])
    return FoldedReading(
        np.concatenate(top) if top else np.zeros((0, TOP_K), dtype=np.int64),
        np.concatenate(confidence) if confidence else np.zeros(0, dtype=np.float64),
        fold_map.fold_labels(labels),
    )


@dataclass(frozen=True, slots=True)
class SelectionReport:
    score: float
    top1_finished: float
    top1_mid: float
    top3_early: float
    cov95_finished: float
    certain_above_finished: float | None
    cov95_partial: float
    certain_above_partial: float | None
    ece_finished: float
    ece_partial: float
    retrieval_recall_at_10: float | None
    count_finished: int
    count_mid: int
    count_early: int
    count_partial: int
    folded_classes: int

    def to_json(self) -> dict[str, object]:
        return asdict(self)


def _share(hits: NDArray[np.bool_]) -> float:
    return float(hits.mean()) if len(hits) else float("nan")


def selection_report(
    logits: NDArray[np.float32],
    labels: NDArray[np.int64],
    fractions: NDArray[np.float32],
    temperatures: RegimeTemperatures,
    fold_map: FoldMap,
    retrieval_recall_at_10: float | None = None,
) -> SelectionReport:
    partial = fractions < FULL_FRACTION
    reading = read_folded(logits, labels, temperatures.of(partial), fold_map)
    finished = ~partial
    mid = (fractions >= MID_BAND[0]) & (fractions < MID_BAND[1])
    early = (fractions >= EARLY_BAND[0]) & (fractions < EARLY_BAND[1])
    top1, top3 = reading.top1_hits, reading.top3_hits
    certain_finished = coverage_at_precision(reading.confidence[finished], top1[finished])
    certain_partial = coverage_at_precision(reading.confidence[partial], top1[partial])
    top1_finished, top1_mid, top3_early = (
        _share(top1[finished]),
        _share(top1[mid]),
        _share(top3[early]),
    )
    score = 100 * (
        WEIGHT_TOP1_FINISHED * top1_finished
        + WEIGHT_TOP1_MID * top1_mid
        + WEIGHT_TOP3_EARLY * top3_early
        + WEIGHT_COVERAGE * certain_finished.coverage
    )
    return SelectionReport(
        score=score,
        top1_finished=top1_finished,
        top1_mid=top1_mid,
        top3_early=top3_early,
        cov95_finished=certain_finished.coverage,
        certain_above_finished=certain_finished.floor,
        cov95_partial=certain_partial.coverage,
        certain_above_partial=certain_partial.floor,
        ece_finished=expected_calibration_error(reading.confidence[finished], top1[finished]),
        ece_partial=expected_calibration_error(reading.confidence[partial], top1[partial]),
        retrieval_recall_at_10=retrieval_recall_at_10,
        count_finished=int(finished.sum()),
        count_mid=int(mid.sum()),
        count_early=int(early.sum()),
        count_partial=int(partial.sum()),
        folded_classes=fold_map.folded_count,
    )
