"""Train Kami's Eye end to end: download, render, fit, calibrate, export. See ml/README.md."""

from __future__ import annotations

import argparse
import math
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from numpy.typing import NDArray
from tqdm import tqdm

from calibrate import fit_temperature, negative_log_likelihood
from dataset import DatasetSpec, SketchDataset, Split, ensure_dataset
from export import TrainingSummary, write_artifacts
from loop import FitConfig, fit, pick_device, predict
from metrics import Accuracy, bucketed_accuracy, format_report
from model import SketchNet
from quickdraw_bin import download_categories

ML_DIR = Path(__file__).parent
ALL_CATEGORIES_FILE = ML_DIR / "categories" / "all.txt"
DOWNLOAD_BYTES_PER_DRAWING = 250
BYTES_PER_MEGABYTE = 1_000_000
CHECKPOINT_FILE = "model.pt"


@dataclass(frozen=True, slots=True)
class TrainArguments:
    categories_file: Path
    samples_per_class: int
    megabytes_per_class: float
    epochs: int
    batch_size: int
    learning_rate: float
    device: str
    name: str
    prefix_share: float
    thickness_jitter: int
    seed: int
    download_only: bool
    data_dir: Path
    artifacts_dir: Path


def parse_arguments() -> TrainArguments:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--categories", type=Path, help="text file, one Quick, Draw! category per line"
    )
    source.add_argument(
        "--all", action="store_true", help="all 345 categories (categories/all.txt)"
    )
    parser.add_argument("--samples-per-class", type=int, default=20_000)
    parser.add_argument(
        "--megabytes-per-class", type=float, help="download size; default fits the samples"
    )
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--learning-rate", type=float, default=2e-3)
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "mps", "cpu"])
    parser.add_argument("--name", default="kami-eye", help="artefacts land in artifacts/<name>/")
    parser.add_argument("--prefix-share", type=float, default=0.5)
    parser.add_argument("--thickness-jitter", type=int, default=0, help="+- px on training renders")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--download-only", action="store_true", help="fetch the data, then stop")
    parser.add_argument("--data-dir", type=Path, default=ML_DIR / "data")
    parser.add_argument("--artifacts-dir", type=Path, default=ML_DIR / "artifacts")
    parsed = parser.parse_args()
    default_megabytes = math.ceil(
        parsed.samples_per_class * DOWNLOAD_BYTES_PER_DRAWING / BYTES_PER_MEGABYTE
    )
    return TrainArguments(
        categories_file=ALL_CATEGORIES_FILE if parsed.all else parsed.categories,
        samples_per_class=parsed.samples_per_class,
        megabytes_per_class=parsed.megabytes_per_class or float(default_megabytes),
        epochs=parsed.epochs,
        batch_size=parsed.batch_size,
        learning_rate=parsed.learning_rate,
        device=parsed.device,
        name=parsed.name,
        prefix_share=parsed.prefix_share,
        thickness_jitter=parsed.thickness_jitter,
        seed=parsed.seed,
        download_only=parsed.download_only,
        data_dir=parsed.data_dir,
        artifacts_dir=parsed.artifacts_dir,
    )


def read_categories(path: Path) -> tuple[str, ...]:
    known = set(ALL_CATEGORIES_FILE.read_text().splitlines())
    categories = tuple(line.strip() for line in path.read_text().splitlines() if line.strip())
    unknown = [category for category in categories if category not in known]
    if unknown:
        raise SystemExit(f"not Quick, Draw! categories: {', '.join(unknown)}")
    if len(set(categories)) != len(categories):
        raise SystemExit(f"{path} lists a category twice")
    return categories


def download(arguments: TrainArguments, categories: tuple[str, ...]) -> Path:
    bin_dir = arguments.data_dir / "bin"
    with tqdm(total=len(categories), desc="download", unit="class") as progress:
        download_categories(
            categories, bin_dir, arguments.megabytes_per_class, lambda _: progress.update()
        )
    return bin_dir


def prepare_dataset(
    arguments: TrainArguments, categories: tuple[str, ...], bin_dir: Path
) -> SketchDataset:
    spec = DatasetSpec(
        categories=categories,
        samples_per_class=arguments.samples_per_class,
        prefix_share=arguments.prefix_share,
        thickness_jitter=arguments.thickness_jitter,
        seed=arguments.seed,
    )
    return ensure_dataset(spec, bin_dir, arguments.data_dir / "datasets" / arguments.name)


def evaluate(
    model: SketchNet, dataset: SketchDataset, split: Split, batch_size: int, device: torch.device
) -> tuple[dict[str, Accuracy], NDArray[np.float32], NDArray[np.int64]]:
    indices = dataset.indices(split)
    logits = predict(model, dataset, indices, batch_size, device)
    labels = dataset.labels[indices]
    return bucketed_accuracy(logits, labels, dataset.fractions[indices]), logits, labels


def main() -> None:
    arguments = parse_arguments()
    categories = read_categories(arguments.categories_file)
    device = pick_device(arguments.device)
    torch.manual_seed(arguments.seed)
    print(f"{len(categories)} categories x {arguments.samples_per_class} samples on {device}")

    started = time.perf_counter()
    bin_dir = download(arguments, categories)
    if arguments.download_only:
        print(f"downloaded to {bin_dir}")
        return
    dataset = prepare_dataset(arguments, categories, bin_dir)
    counts = {split.name.lower(): len(dataset.indices(split)) for split in Split}
    print(f"dataset ready in {time.perf_counter() - started:.0f} s: {counts}")

    model = SketchNet(len(categories)).to(device)
    fit_config = FitConfig(
        arguments.epochs, arguments.batch_size, arguments.learning_rate, arguments.seed
    )
    images_per_second = fit(model, dataset, fit_config, device)
    print(f"training throughput: {images_per_second:,.0f} images/s on {device}")

    validation, val_logits, val_labels = evaluate(
        model, dataset, Split.VAL, arguments.batch_size, device
    )
    print(format_report("validation", validation))
    temperature = fit_temperature(val_logits, val_labels)
    before = negative_log_likelihood(val_logits, val_labels, 1.0)
    after = negative_log_likelihood(val_logits, val_labels, temperature)
    print(f"temperature {temperature:.3f}  (val NLL {before:.4f} -> {after:.4f})")
    test, _, _ = evaluate(model, dataset, Split.TEST, arguments.batch_size, device)
    print(format_report("test", test))

    artifacts_dir = arguments.artifacts_dir / arguments.name
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), artifacts_dir / CHECKPOINT_FILE)
    trained_on = (
        f"Quick, Draw! {len(categories)} categories x {arguments.samples_per_class} recognised "
        f"drawings, {arguments.prefix_share:.0%} prefixes, {arguments.epochs} epochs"
    )
    summary = TrainingSummary(trained_on, temperature, validation, test)
    write_artifacts(model, categories, summary, bin_dir, artifacts_dir)
    print(f"artefacts written to {artifacts_dir}")


if __name__ == "__main__":
    main()
