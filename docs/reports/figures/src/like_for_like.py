"""On the GX10: Kami's Eye answering only with the k-NN's 42 categories, on the test drawings of
those categories, by how much of the drawing it was shown.

    cd ~/kami-ml && PYTHONPATH=. .venv/bin/python like_for_like.py    # once copied there
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np
import torch

from checkpoint import load_trained
from dataset import Split, load_dataset
from evaluation import evaluate_split
from metrics import Accuracy, bucketed_accuracy, format_report

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
DATASET = Path("data/datasets/kami-eye")
BATCH_SIZE = 2048


def like_for_like(
    model_dir: Path,
    dataset_dir: Path,
    categories: Sequence[str],
    device: torch.device,
    batch_size: int,
) -> dict[str, Accuracy]:
    """Test accuracy per prefix bucket with every category outside `categories` ruled out."""
    dataset = load_dataset(dataset_dir)
    model, labels = load_trained(model_dir, device)
    if labels != dataset.categories:
        raise SystemExit(f"{model_dir} names other categories than {dataset_dir}")
    keep = np.array([labels.index(name) for name in categories if name in labels], dtype=np.int64)
    print(f"categories found: {len(keep)} of {len(categories)}")

    read = evaluate_split(model, dataset, Split.TEST, batch_size, device)
    rows = np.isin(read.labels, keep)
    restricted = np.full_like(read.logits[rows], -np.inf)
    restricted[:, keep] = read.logits[rows][:, keep]
    return bucketed_accuracy(restricted, read.labels[rows], read.fractions[rows])


if __name__ == "__main__":
    report = like_for_like(MODEL, DATASET, KNN_CATEGORIES, torch.device("cuda"), BATCH_SIZE)
    print(format_report("test, 42 classes", report))
