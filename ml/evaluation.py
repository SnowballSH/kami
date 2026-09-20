"""A model read over every view of a split's drawings: what the reports and the selection metric
are computed from. Rows are ordered view by view (all finished renders first on a 4-view dataset).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
from numpy.typing import NDArray

from dataset import FULL_FRACTION, SketchDataset, Split
from loop import predict
from model import SketchNet
from retrieval import own_drawing_recall
from views import FINISHED_VIEW, MID_VIEW, STRATIFIED_VIEW_COUNT


@dataclass(frozen=True, slots=True)
class SplitEvaluation:
    logits: NDArray[np.float32]
    labels: NDArray[np.int64]
    fractions: NDArray[np.float32]
    retrieval_recall_at_10: float | None

    @property
    def partial(self) -> NDArray[np.bool_]:
        return np.asarray(self.fractions < FULL_FRACTION, dtype=np.bool_)


def evaluate_split(
    model: SketchNet,
    dataset: SketchDataset,
    split: Split,
    batch_size: int,
    device: torch.device,
    readers: int = 1,
) -> SplitEvaluation:
    indices = dataset.indices(split)
    labels = dataset.labels[indices]
    stratified = dataset.view_count == STRATIFIED_VIEW_COUNT
    retrieval_views = (FINISHED_VIEW, MID_VIEW) if stratified else ()
    logits: list[NDArray[np.float32]] = []
    embeddings: dict[int, NDArray[np.float16]] = {}
    for view in range(dataset.view_count):
        predictions = predict(
            model,
            dataset,
            indices,
            batch_size,
            device,
            view,
            with_embeddings=view in retrieval_views,
            readers=readers,
        )
        logits.append(predictions.logits)
        if predictions.embeddings is not None:
            embeddings[view] = predictions.embeddings
    recall = (
        own_drawing_recall(embeddings[MID_VIEW], embeddings[FINISHED_VIEW], labels)
        if stratified
        else None
    )
    return SplitEvaluation(
        np.concatenate(logits),
        np.tile(labels, dataset.view_count),
        np.ascontiguousarray(dataset.fractions[indices].T).reshape(-1),
        recall,
    )
