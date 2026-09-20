"""The completion guard-rail: does a half-drawn sketch land near its own finished drawing?

Completion retrieves inside one category, so the gallery of a query is the finished held-out
drawings of its class, and a hit is its own finished render among the `k` nearest by cosine.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

RECALL_AT = 10


def _unit_rows(vectors: NDArray[np.floating]) -> NDArray[np.float32]:
    rows = vectors.astype(np.float32)
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    return np.asarray(rows / np.where(norms > 0, norms, 1), dtype=np.float32)


def own_drawing_recall(
    prefix_embeddings: NDArray[np.floating],
    finished_embeddings: NDArray[np.floating],
    labels: NDArray[np.int64],
    k: int = RECALL_AT,
) -> float:
    """Row i of both arrays is the same drawing; returns the share of prefixes that find it."""
    if len(labels) == 0:
        return float("nan")
    hits = 0
    for label in np.unique(labels):
        rows = np.flatnonzero(labels == label)
        similarity = _unit_rows(prefix_embeddings[rows]) @ _unit_rows(finished_embeddings[rows]).T
        closer = (similarity > np.diag(similarity)[:, None]).sum(axis=1)
        hits += int((closer < k).sum())
    return hits / len(labels)
