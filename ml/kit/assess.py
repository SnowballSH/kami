"""A trained model read over held-out drawings, and everything the release states about it: the
bucketed accuracy tables, the regime temperatures and the 95 %-precision floors (CONTRACT.md ->
Regimes), and the selection metric of selection.py.

Held-out drawings are the validation or test drawings among each category's first `eval_head`
recognised ones, each read finished and as one prefix (kit/looks.py).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

import numpy as np
import torch
from numpy.typing import NDArray

from artifacts import CertaintyFloors
from calibrate import RegimeTemperatures, fit_regime_temperatures, negative_log_likelihood
from export import conservative_floors
from folding import FoldMap
from kit.corpus import Corpus
from kit.devices import Accelerator
from kit.journal import journal
from kit.looks import FINISHED
from kit.stream import HeldOutImages, HeldOutRows, batch_loader
from metrics import Accuracy, bucketed_accuracy, format_report
from model import SketchNet
from retrieval import own_drawing_recall
from selection import MID_BAND, SelectionReport, selection_report
from splits import Split

READ_BATCH_SIZE = 1024


@dataclass(frozen=True, slots=True)
class HeldOutReading:
    logits: NDArray[np.float32]
    labels: NDArray[np.int64]
    fractions: NDArray[np.float32]
    retrieval_recall_at_10: float | None = None

    @property
    def partial(self) -> NDArray[np.bool_]:
        return np.asarray(self.fractions < FINISHED, dtype=np.bool_)

    def buckets(self) -> dict[str, Accuracy]:
        return bucketed_accuracy(self.logits, self.labels, self.fractions)


@torch.inference_mode()
def read_rows(
    model: SketchNet,
    corpus: Corpus,
    rows: HeldOutRows,
    accelerator: Accelerator,
    workers: int,
    *,
    with_embeddings: bool = False,
    batch_size: int = READ_BATCH_SIZE,
) -> tuple[NDArray[np.float32], NDArray[np.float16] | None]:
    was_training = model.training
    model.eval()
    logits: list[NDArray[np.float32]] = []
    embeddings: list[NDArray[np.float16]] = []
    loader = batch_loader(
        HeldOutImages(corpus, rows), rows.chunks(batch_size), workers, accelerator.is_cuda
    )
    with accelerator.autocast():
        for batch in loader:
            batch_logits, batch_embeddings = model(accelerator.images(batch.images))
            logits.append(batch_logits.float().cpu().numpy())
            if with_embeddings:
                embeddings.append(batch_embeddings.half().cpu().numpy())
    model.train(was_training)
    return (
        np.concatenate(logits).astype(np.float32),
        np.concatenate(embeddings) if with_embeddings else None,
    )


def read_held_out(
    model: SketchNet,
    corpus: Corpus,
    drawings: NDArray[np.int64],
    accelerator: Accelerator,
    workers: int,
    *,
    with_retrieval: bool = False,
) -> HeldOutReading:
    rows = HeldOutRows.of(corpus, drawings)
    labels = corpus.labels[rows.drawings].astype(np.int64)
    logits, embeddings = read_rows(
        model, corpus, rows, accelerator, workers, with_embeddings=with_retrieval
    )
    recall = None
    if embeddings is not None:
        count = len(drawings)
        prefix_fractions = rows.fractions[count:]
        mid = (prefix_fractions >= MID_BAND[0]) & (prefix_fractions < MID_BAND[1])
        recall = own_drawing_recall(
            embeddings[count:], embeddings[:count], labels[:count], queries=mid
        )
    return HeldOutReading(logits, labels, rows.fractions, recall)


def probe_drawings(corpus: Corpus, eval_head: int, per_class: int) -> NDArray[np.int64]:
    """A fixed, class-balanced sample of the validation drawings for progress lines."""
    validation = corpus.indices(Split.VAL, eval_head)
    labels = corpus.labels[validation]
    chosen = [validation[labels == label][:per_class] for label in range(len(corpus.categories))]
    return np.sort(np.concatenate(chosen))


@dataclass(frozen=True, slots=True)
class Assessment:
    temperatures: RegimeTemperatures
    certain_above: CertaintyFloors
    validation: dict[str, Accuracy]
    test: dict[str, Accuracy]
    selection: SelectionReport
    test_selection: SelectionReport
    validation_nll: tuple[float, float]

    def to_json(self) -> dict[str, object]:
        return {
            "temperatures": asdict(self.temperatures),
            "certainAbove": self.certain_above.to_json(),
            "validation": {name: asdict(result) for name, result in self.validation.items()},
            "test": {name: asdict(result) for name, result in self.test.items()},
            "selection": self.selection.to_json(),
            "testSelection": self.test_selection.to_json(),
            "validationNll": {"raw": self.validation_nll[0], "calibrated": self.validation_nll[1]},
        }


def assess(
    model: SketchNet,
    corpus: Corpus,
    eval_head: int,
    accelerator: Accelerator,
    workers: int,
    fold_map: FoldMap,
) -> Assessment:
    """Temperatures and floors are fitted on validation; the test split is only reported."""
    log = journal()
    validation = read_held_out(
        model,
        corpus,
        corpus.indices(Split.VAL, eval_head),
        accelerator,
        workers,
        with_retrieval=True,
    )
    temperatures = fit_regime_temperatures(validation.logits, validation.labels, validation.partial)
    raw = negative_log_likelihood(validation.logits, validation.labels, 1.0)
    calibrated = negative_log_likelihood(validation.logits, validation.labels, temperatures.pooled)
    selection = selection_report(
        validation.logits,
        validation.labels,
        validation.fractions,
        temperatures,
        fold_map,
        validation.retrieval_recall_at_10,
    )
    log.info(format_report("validation", validation.buckets()))
    test = read_held_out(
        model,
        corpus,
        corpus.indices(Split.TEST, eval_head),
        accelerator,
        workers,
        with_retrieval=True,
    )
    test_selection = selection_report(
        test.logits,
        test.labels,
        test.fractions,
        temperatures,
        fold_map,
        test.retrieval_recall_at_10,
    )
    log.info(format_report("test", test.buckets()))
    return Assessment(
        temperatures=temperatures,
        certain_above=conservative_floors(
            selection.certain_above_finished, selection.certain_above_partial
        ),
        validation=validation.buckets(),
        test=test.buckets(),
        selection=selection,
        test_selection=test_selection,
        validation_nll=(raw, calibrated),
    )
