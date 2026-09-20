"""Write a trained model's logits on the FINISHED render of every training drawing of a dataset:
the soft targets `train.py --teacher-logits` distils from. Runs on the GX10.

    python distill_teacher.py --model artifacts/kami-eye-xl \\
        --dataset data/datasets/eye-next-22k-v4 --out data/teachers/kami-eye-xl.eye-next-22k-v4.npy
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np

from checkpoint import load_trained
from dataset import Split, load_dataset
from loop import pick_device, predict
from teacher import TeacherLogits
from views import FINISHED_VIEW

DRAWINGS_PER_PASS = 262_144


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", type=Path, required=True, help="artefact directory with model.pt"
    )
    parser.add_argument("--dataset", type=Path, required=True, help="rendered dataset directory")
    parser.add_argument("--out", type=Path, required=True, help=".npy to write, float16 [N, K]")
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--readers", type=int, default=4)
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "mps", "cpu"])
    arguments = parser.parse_args()

    device = pick_device(arguments.device)
    dataset = load_dataset(arguments.dataset)
    model, labels = load_trained(arguments.model, device)
    if labels != dataset.categories:
        raise SystemExit(f"{arguments.model} names other categories than {arguments.dataset}")

    started = time.perf_counter()
    train_indices = dataset.indices(Split.TRAIN)
    logits = TeacherLogits.create(arguments.out, arguments.model.name, dataset)
    for start in range(0, len(train_indices), DRAWINGS_PER_PASS):
        chunk = train_indices[start : start + DRAWINGS_PER_PASS]
        predictions = predict(
            model,
            dataset,
            chunk,
            arguments.batch_size,
            device,
            FINISHED_VIEW,
            readers=arguments.readers,
            half_precision=True,
        )
        logits[chunk] = predictions.logits.astype(np.float16)
        print(f"  {start + len(chunk):,}/{len(train_indices):,} drawings", flush=True)
    del logits
    TeacherLogits.load(arguments.out, dataset)
    elapsed = time.perf_counter() - started
    print(f"{len(train_indices):,} teacher rows in {elapsed:.0f} s -> {arguments.out}")


if __name__ == "__main__":
    main()
