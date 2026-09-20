"""Score a trained model on the stratified views of a rendered dataset: the selection metric of
selection.py plus the bucketed accuracy table, as JSON. Temperatures are always fitted on the
validation split, whichever split is reported. Runs on the GX10.

    python evaluate.py --model artifacts/kami-eye-xl --dataset data/datasets/abl-3k-v4 \\
        --split val --out artifacts/evaluations/kami-eye-xl.abl-3k-v4.val.json
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from calibrate import fit_regime_temperatures
from checkpoint import load_trained
from dataset import Split, load_dataset
from evaluation import SplitEvaluation, evaluate_split
from export import json_safe
from folding import DEFAULT_FOLD_MAP, FoldMap, read_aliases
from loop import pick_device
from metrics import bucketed_accuracy, format_report
from selection import selection_report

SPLITS = {"val": Split.VAL, "test": Split.TEST}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model", type=Path, required=True, help="artefact directory with model.pt"
    )
    parser.add_argument("--dataset", type=Path, required=True, help="rendered dataset directory")
    parser.add_argument("--split", choices=list(SPLITS), default="val")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--fold-map", type=Path, default=DEFAULT_FOLD_MAP)
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--readers", type=int, default=4)
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "mps", "cpu"])
    arguments = parser.parse_args()

    device = pick_device(arguments.device)
    dataset = load_dataset(arguments.dataset)
    model, labels = load_trained(arguments.model, device)
    if labels != dataset.categories:
        raise SystemExit(f"{arguments.model} names other categories than {arguments.dataset}")

    def read(split: Split) -> SplitEvaluation:
        return evaluate_split(
            model, dataset, split, arguments.batch_size, device, arguments.readers
        )

    held_out = read(Split.VAL)
    temperatures = fit_regime_temperatures(held_out.logits, held_out.labels, held_out.partial)
    split = SPLITS[arguments.split]
    reported = held_out if split is Split.VAL else read(split)
    fold_map = FoldMap.of(labels, read_aliases(arguments.fold_map))
    selection = selection_report(
        reported.logits,
        reported.labels,
        reported.fractions,
        temperatures,
        fold_map,
        reported.retrieval_recall_at_10,
    )
    buckets = bucketed_accuracy(reported.logits, reported.labels, reported.fractions)
    print(format_report(arguments.split, buckets))
    print(f"S {selection.score:.2f} on {arguments.split}")
    record = {
        "model": arguments.model.name,
        "dataset": arguments.dataset.name,
        "split": arguments.split,
        "temperatures": asdict(temperatures),
        "selection": selection.to_json(),
        "buckets": {name: asdict(result) for name, result in buckets.items()},
    }
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(json.dumps(json_safe(record), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
