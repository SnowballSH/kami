"""Kami's Eye answering only with the k-NN's 42 categories, on the test drawings of those
categories, by how much of the drawing it was shown. Needs the model's corpus index (the `data`
stage of ml/retrain.py) and the model's `model.pt`.

    cd ml && PYTHONPATH=. .venv/bin/python ../docs/reports/figures/src/like_for_like.py
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np

from checkpoint import load_trained
from kit.assess import read_held_out
from kit.corpus import Corpus, CorpusSpec
from kit.devices import Accelerator
from kit.recipe import KAMI_EYE_XL_HEAD
from metrics import Accuracy, bucketed_accuracy, format_report
from splits import Split

KNN_CATEGORIES = (
    "mushroom",
    "bed",
    "rabbit",
    "ladder",
    "stairs",
    "tree",
    "fence",
    "hot air balloon",
    "cloud",
    "parachute",
    "bird",
    "anvil",
    "mountain",
    "feather",
    "leaf",
    "snowflake",
    "banana",
    "nail",
    "cake",
    "birthday cake",
    "wine bottle",
    "teapot",
    "cup",
    "key",
    "door",
    "bridge",
    "house",
    "flower",
    "star",
    "moon",
    "sun",
    "cat",
    "umbrella",
    "river",
    "candle",
    "skull",
    "campfire",
    "line",
    "circle",
    "square",
    "triangle",
    "zigzag",
)
MODEL = Path("artifacts/kami-eye")
DATA = Path("data")
WORKERS = 4


def like_for_like(
    model_dir: Path,
    corpus: Corpus,
    categories: Sequence[str],
    accelerator: Accelerator,
    head: int,
    workers: int = WORKERS,
) -> dict[str, Accuracy]:
    """Test accuracy per prefix bucket with every category outside `categories` ruled out."""
    model, labels = load_trained(model_dir, accelerator.device)
    if labels != corpus.categories:
        raise SystemExit(f"{model_dir} names other categories than {corpus.directory}")
    keep = np.array([labels.index(name) for name in categories if name in labels], dtype=np.int64)
    print(f"categories found: {len(keep)} of {len(categories)}")

    read = read_held_out(model, corpus, corpus.indices(Split.TEST, head), accelerator, workers)
    rows = np.isin(read.labels, keep)
    restricted = np.full_like(read.logits[rows], -np.inf)
    restricted[:, keep] = read.logits[rows][:, keep]
    return bucketed_accuracy(restricted, read.labels[rows], read.fractions[rows])


if __name__ == "__main__":
    accelerator = Accelerator.of("auto")
    _, labels = load_trained(MODEL, accelerator.device)
    corpus = Corpus.build(CorpusSpec(labels, KAMI_EYE_XL_HEAD), DATA / "bin", DATA / "index")
    report = like_for_like(MODEL, corpus, KNN_CATEGORIES, accelerator, KAMI_EYE_XL_HEAD)
    print(format_report("test, 42 classes", report))
