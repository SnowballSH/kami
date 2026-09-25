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
    queries: NDArray[np.bool_] | None = None,
) -> float:
    """Row i of both arrays is the same drawing; returns the share of prefixes that find it.

    `queries` limits which prefixes ask (the gallery stays every finished drawing of the class)."""
    asking = np.ones(len(labels), dtype=np.bool_) if queries is None else queries
    if not asking.any():
        return float("nan")
    hits = 0
    for label in np.unique(labels[asking]):
        gallery = np.flatnonzero(labels == label)
        asked = gallery[asking[gallery]]
        prefixes = _unit_rows(prefix_embeddings[asked])
        similarity = prefixes @ _unit_rows(finished_embeddings[gallery]).T
        own = similarity[np.arange(len(asked)), np.searchsorted(gallery, asked)]
        closer = (similarity > own[:, None]).sum(axis=1)
        hits += int((closer < k).sum())
    return hits / int(asking.sum())
