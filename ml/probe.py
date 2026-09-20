"""A short throughput and loss-parity probe of the fit loop's speed options, on the GX10.

Two short epochs over a random slice of a rendered dataset, through the real `fit`: the second
epoch's images per second (the first pays for compilation and cuDNN's search) and its mean loss,
which must agree between the eager fp16 loop and a faster one given the same seed.

    python probe.py --dataset data/datasets/abl-3k-v4 --out artifacts/probes/eager.json
    python probe.py --dataset data/datasets/abl-3k-v4 --out artifacts/probes/fast.json \\
        --compile --amp-dtype bfloat16 --fused-optimizer
"""

from __future__ import annotations

import argparse
import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import torch

from dataset import SketchDataset, Split, load_dataset
from loop import AmpDtype, FitConfig, fit, pick_device
from model import Arch, SketchNet
from views import LEGACY_VIEW_WEIGHTS, SINGLE_VIEW_COUNT, ViewPlan

PROBE_EPOCHS = 2
VALIDATION_DRAWINGS = 4096
UNUSED = Split.TEST


def probe_slice(dataset: SketchDataset, train_drawings: int, seed: int) -> SketchDataset:
    """The same images with all but a random few training and validation drawings set aside."""
    rng = np.random.default_rng(seed)
    splits = np.full_like(dataset.splits, UNUSED)
    for split, wanted in ((Split.TRAIN, train_drawings), (Split.VAL, VALIDATION_DRAWINGS)):
        candidates = dataset.indices(split)
        splits[rng.choice(candidates, size=min(wanted, len(candidates)), replace=False)] = split
    return replace(dataset, splits=splits)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=100, help="per epoch")
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--arch", type=Arch, default=Arch.RESNET18, choices=list(Arch))
    parser.add_argument("--compile", action="store_true")
    parser.add_argument(
        "--amp-dtype", type=AmpDtype, default=AmpDtype.FLOAT16, choices=list(AmpDtype)
    )
    parser.add_argument("--fused-optimizer", action="store_true")
    parser.add_argument("--readers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "mps", "cpu"])
    arguments = parser.parse_args()

    device = pick_device(arguments.device)
    torch.manual_seed(arguments.seed)
    dataset = probe_slice(
        load_dataset(arguments.dataset), arguments.steps * arguments.batch_size, arguments.seed
    )
    weights = (1.0,) if dataset.view_count == SINGLE_VIEW_COUNT else LEGACY_VIEW_WEIGHTS
    config = FitConfig(
        epochs=PROBE_EPOCHS,
        batch_size=arguments.batch_size,
        max_learning_rate=2e-3,
        seed=arguments.seed,
        view_plan=ViewPlan(weights),
        compile=arguments.compile,
        amp_dtype=arguments.amp_dtype,
        fused_optimizer=arguments.fused_optimizer,
        readers=arguments.readers,
    )
    model = SketchNet(len(dataset.categories), arguments.arch).to(device)
    result = fit(model, dataset, config, device)
    settled = result.history[-1]
    record = {
        "compileAsked": arguments.compile,
        "compiled": result.compiled,
        "ampDtype": arguments.amp_dtype.value,
        "fusedOptimizer": arguments.fused_optimizer,
        "imagesPerSecond": settled.images_per_second,
        "loss": settled.loss,
        "valTop1": settled.val_top1,
    }
    print(json.dumps(record))
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
