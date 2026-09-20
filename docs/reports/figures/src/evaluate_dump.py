"""On the GX10: Kami's Eye over the validation and test splits, every prediction kept in eval.npz
for plot_results.py. One row per view of a held-out drawing, validation rows first, each
calibrated with the temperature the sidecar would use for it (finished or partial).

    cd ~/kami-ml && PYTHONPATH=. .venv/bin/python evaluate_dump.py    # once copied there
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

from artifacts import load_metadata
from checkpoint import load_trained
from dataset import Split, load_dataset
from evaluation import evaluate_split

MODEL = Path("artifacts/kami-eye")
DATASET = Path("data/datasets/kami-eye")
DUMP_FILE = "eval.npz"
HELD_OUT = (Split.VAL, Split.TEST)
TOP = 5
BATCH_SIZE = 4096


def dump(
    model_dir: Path, dataset_dir: Path, out: Path, device: torch.device, batch_size: int
) -> None:
    dataset = load_dataset(dataset_dir)
    model, labels = load_trained(model_dir, device)
    if labels != dataset.categories:
        raise SystemExit(f"{model_dir} names other categories than {dataset_dir}")
    metadata = load_metadata(model_dir, {})

    reads = [evaluate_split(model, dataset, split, batch_size, device) for split in HELD_OUT]
    logits = torch.from_numpy(np.concatenate([read.logits for read in reads]))
    temperatures = np.where(
        np.concatenate([read.partial for read in reads]),
        metadata.temperature_partial,
        metadata.temperature,
    ).astype(np.float32)
    calibrated = torch.softmax(logits / torch.from_numpy(temperatures)[:, None], dim=1)
    top_probs, top_classes = calibrated.topk(min(TOP, len(labels)), dim=1)
    np.savez_compressed(
        out,
        split=np.concatenate(
            [
                np.full(len(read.labels), split, dtype=np.uint8)
                for split, read in zip(HELD_OUT, reads, strict=True)
            ]
        ),
        label=np.concatenate([read.labels for read in reads]),
        fraction=np.concatenate([read.fractions for read in reads]),
        top_classes=top_classes.numpy().astype(np.int16),
        top_probs=top_probs.numpy().astype(np.float32),
        categories=np.array(labels),
    )


if __name__ == "__main__":
    dump(MODEL, DATASET, MODEL / DUMP_FILE, torch.device("cuda"), BATCH_SIZE)
    kept = np.load(MODEL / DUMP_FILE)
    hits = kept["top_classes"][:, :3] == kept["label"][:, None]
    print(f"rows {len(hits)}  top-1 {hits[:, 0].mean():.4f}  top-3 {hits.any(axis=1).mean():.4f}")
