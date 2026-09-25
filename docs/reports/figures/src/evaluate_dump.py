"""Kami's Eye over the validation and test splits, every prediction kept in eval.npz for
plot_results.py. One row per look at a held-out drawing (finished, then its prefix), validation
rows first, each calibrated with the temperature the sidecar would use for it (finished or
partial). Needs the model's corpus index (the `data` stage of ml/retrain.py) and its `model.pt`.

    cd ml && PYTHONPATH=. .venv/bin/python ../docs/reports/figures/src/evaluate_dump.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch

from artifacts import load_metadata
from checkpoint import load_trained
from kit.assess import read_held_out
from kit.corpus import Corpus, CorpusSpec
from kit.devices import Accelerator
from kit.recipe import KAMI_EYE_XL_HEAD
from splits import Split

MODEL = Path("artifacts/kami-eye")
DATA = Path("data")
DUMP_FILE = "eval.npz"
HELD_OUT = (Split.VAL, Split.TEST)
TOP = 5
WORKERS = 4


def dump(
    model_dir: Path,
    corpus: Corpus,
    out: Path,
    accelerator: Accelerator,
    head: int,
    workers: int = WORKERS,
) -> None:
    model, labels = load_trained(model_dir, accelerator.device)
    if labels != corpus.categories:
        raise SystemExit(f"{model_dir} names other categories than {corpus.directory}")
    metadata = load_metadata(model_dir, {})

    reads = [
        read_held_out(model, corpus, corpus.indices(split, head), accelerator, workers)
        for split in HELD_OUT
    ]
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
    accelerator = Accelerator.of("auto")
    _, labels = load_trained(MODEL, accelerator.device)
    corpus = Corpus.build(CorpusSpec(labels, KAMI_EYE_XL_HEAD), DATA / "bin", DATA / "index")
    dump(MODEL, corpus, MODEL / DUMP_FILE, accelerator, KAMI_EYE_XL_HEAD)
    kept = np.load(MODEL / DUMP_FILE)
    hits = kept["top_classes"][:, :3] == kept["label"][:, None]
    print(f"rows {len(hits)}  top-1 {hits[:, 0].mean():.4f}  top-3 {hits.any(axis=1).mean():.4f}")
