"""Train Kami's Eye end to end: download, render, fit, calibrate, export. See ml/README.md."""

from __future__ import annotations

import argparse
import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import torch
from tqdm import tqdm

from calibrate import fit_regime_temperatures, negative_log_likelihood
from dataset import DatasetSpec, SketchDataset, Split, ensure_dataset
from evaluation import evaluate_split
from export import TrainingSummary, conservative_floors, write_artifacts
from folding import DEFAULT_FOLD_MAP, FoldMap, read_aliases
from loop import LABEL_SMOOTHING, AmpDtype, FitConfig, FitResult, fit, pick_device
from losses import Distillation
from metrics import bucketed_accuracy, format_report
from model import Arch, SketchNet
from quickdraw_bin import download_categories
from selection import SelectionReport, selection_report
from teacher import TeacherLogits
from views import (
    LEGACY_VIEW_WEIGHTS,
    SINGLE_VIEW_COUNT,
    SUPPORTED_VIEW_COUNTS,
    ViewPlan,
    ViewPolicy,
    parse_view_weights,
)

ML_DIR = Path(__file__).parent
ALL_CATEGORIES_FILE = ML_DIR / "categories" / "all.txt"
DOWNLOAD_BYTES_PER_DRAWING = 250
BYTES_PER_MEGABYTE = 1_000_000
DEFAULT_KD_ALPHA = 0.7
DEFAULT_KD_TEMPERATURE = 2.0


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
    arch: Arch
    views: int
    view_plan: ViewPlan
    label_smoothing: float
    teacher_logits: Path | None
    distillation: Distillation | None
    embed_align: float
    compile: bool
    amp_dtype: AmpDtype
    fused_optimizer: bool
    fold_map: Path
    dataset_name: str
    dataset_seed: int
    dataset_only: bool
    render_workers: int | None
    readers: int

    def fit_config(self) -> FitConfig:
        return FitConfig(
            epochs=self.epochs,
            batch_size=self.batch_size,
            max_learning_rate=self.learning_rate,
            seed=self.seed,
            label_smoothing=self.label_smoothing,
            view_plan=self.view_plan,
            distillation=self.distillation,
            embed_align=self.embed_align,
            compile=self.compile,
            amp_dtype=self.amp_dtype,
            fused_optimizer=self.fused_optimizer,
            readers=self.readers,
        )

    def recipe(self) -> dict[str, object]:
        """The flags that decide what is learnt, as they are written next to the model."""
        return {
            "arch": self.arch.value,
            "samplesPerClass": self.samples_per_class,
            "epochs": self.epochs,
            "batchSize": self.batch_size,
            "learningRate": self.learning_rate,
            "seed": self.seed,
            "views": self.views,
            "viewWeights": list(self.view_plan.weights),
            "viewPolicy": self.view_plan.policy.value,
            "labelSmoothing": self.label_smoothing,
            "teacherLogits": str(self.teacher_logits) if self.teacher_logits else None,
            "distillation": asdict(self.distillation) if self.distillation else None,
            "embedAlign": self.embed_align,
            "compile": self.compile,
            "ampDtype": self.amp_dtype.value,
            "fusedOptimizer": self.fused_optimizer,
            "dataset": self.dataset_name,
            "datasetSeed": self.dataset_seed,
        }


def _add_recipe_flags(parser: argparse.ArgumentParser) -> None:
    """All of these default to the first recipe; docs/reports/kami-eye-next.md argues for each."""
    parser.add_argument("--arch", type=Arch, default=Arch.RESNET18, choices=list(Arch))
    parser.add_argument(
        "--views",
        type=int,
        default=SINGLE_VIEW_COUNT,
        choices=SUPPORTED_VIEW_COUNTS,
        help="4: every drawing rendered finished and as a 30-50, 50-70 and 70-100 %% prefix",
    )
    parser.add_argument(
        "--view-weights",
        type=parse_view_weights,
        help="sampling weights per view, finished first; default: the first recipe's mixture",
    )
    parser.add_argument(
        "--view-policy",
        type=ViewPolicy,
        default=ViewPolicy.FIXED,
        choices=list(ViewPolicy),
        help="fixed: a drawing keeps one view for the whole run; resample: drawn every epoch",
    )
    parser.add_argument("--label-smoothing", type=float, default=LABEL_SMOOTHING)
    parser.add_argument(
        "--teacher-logits", type=Path, help="a distill_teacher.py file over this same dataset"
    )
    parser.add_argument("--kd-alpha", type=float, default=DEFAULT_KD_ALPHA)
    parser.add_argument("--kd-temperature", type=float, default=DEFAULT_KD_TEMPERATURE)
    parser.add_argument(
        "--embed-align",
        type=float,
        default=0.0,
        help="weight of 1 - cos(prefix, finished) on paired batches; needs --views 4",
    )
    parser.add_argument("--compile", action="store_true", help="torch.compile, eager if it fails")
    parser.add_argument(
        "--amp-dtype", type=AmpDtype, default=AmpDtype.FLOAT16, choices=list(AmpDtype)
    )
    parser.add_argument("--fused-optimizer", action="store_true")
    parser.add_argument(
        "--fold-map", type=Path, default=DEFAULT_FOLD_MAP, help="aliases folded when scoring"
    )
    parser.add_argument("--dataset-name", help="rendered dataset to share; default: --name")
    parser.add_argument("--dataset-seed", type=int, help="default: --seed")
    parser.add_argument("--dataset-only", action="store_true", help="render the dataset, then stop")
    parser.add_argument("--render-workers", type=int, help="default: one per core")
    parser.add_argument("--readers", type=int, default=1, help="threads reading the memmap")


def _view_plan(parsed: argparse.Namespace) -> ViewPlan:
    if parsed.view_weights is not None:
        weights = parsed.view_weights
    else:
        weights = (1.0,) if parsed.views == SINGLE_VIEW_COUNT else LEGACY_VIEW_WEIGHTS
    if len(weights) != parsed.views:
        raise SystemExit(f"--view-weights needs {parsed.views} numbers, finished first")
    return ViewPlan(tuple(weights), parsed.view_policy)


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
    _add_recipe_flags(parser)
    parsed = parser.parse_args()
    default_megabytes = math.ceil(
        parsed.samples_per_class * DOWNLOAD_BYTES_PER_DRAWING / BYTES_PER_MEGABYTE
    )
    if parsed.embed_align > 0 and (parsed.views == SINGLE_VIEW_COUNT or parsed.batch_size % 2):
        raise SystemExit("--embed-align needs --views 4 and an even --batch-size")
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
        arch=parsed.arch,
        views=parsed.views,
        view_plan=_view_plan(parsed),
        label_smoothing=parsed.label_smoothing,
        teacher_logits=parsed.teacher_logits,
        distillation=(
            Distillation(parsed.kd_alpha, parsed.kd_temperature)
            if parsed.teacher_logits is not None
            else None
        ),
        embed_align=parsed.embed_align,
        compile=parsed.compile,
        amp_dtype=parsed.amp_dtype,
        fused_optimizer=parsed.fused_optimizer,
        fold_map=parsed.fold_map,
        dataset_name=parsed.dataset_name or parsed.name,
        dataset_seed=parsed.seed if parsed.dataset_seed is None else parsed.dataset_seed,
        dataset_only=parsed.dataset_only,
        render_workers=parsed.render_workers,
        readers=parsed.readers,
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
        seed=arguments.dataset_seed,
        views=arguments.views,
    )
    out_dir = arguments.data_dir / "datasets" / arguments.dataset_name
    return ensure_dataset(spec, bin_dir, out_dir, arguments.render_workers)


def trained_on(arguments: TrainArguments, categories: tuple[str, ...]) -> str:
    looks = (
        f"{arguments.prefix_share:.0%} prefixes"
        if arguments.views == SINGLE_VIEW_COUNT
        else f"{arguments.views} views per drawing ({arguments.view_plan.policy.value})"
    )
    return (
        f"Quick, Draw! {len(categories)} categories x {arguments.samples_per_class} recognised "
        f"drawings, {looks}, {arguments.epochs} epochs"
    )


def training_record(result: FitResult, seconds_total: float) -> dict[str, object]:
    return {
        "imagesPerSecond": result.images_per_second,
        "secondsTraining": result.seconds_training,
        "secondsTotal": seconds_total,
        "compiled": result.compiled,
        "history": [asdict(record) for record in result.history],
    }


def report_selection(title: str, report: SelectionReport) -> str:
    floor = report.certain_above_finished
    recall = report.retrieval_recall_at_10
    return (
        f"{title}: S {report.score:.2f}  (folded: finished top-1 {report.top1_finished:.1%}, "
        f"50-70 % top-1 {report.top1_mid:.1%}, 30-50 % top-3 {report.top3_early:.1%}, "
        f"cov95 {report.cov95_finished:.1%} at >= {floor if floor is not None else 'never'})  "
        f"ECE finished {report.ece_finished:.1%} partial {report.ece_partial:.1%}  "
        f"own-drawing recall@10 {f'{recall:.1%}' if recall is not None else 'n/a'}"
    )


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
    if arguments.dataset_only:
        return

    teacher = (
        TeacherLogits.load(arguments.teacher_logits, dataset)
        if arguments.teacher_logits is not None
        else None
    )
    model = SketchNet(len(categories), arguments.arch).to(device)
    result = fit(model, dataset, arguments.fit_config(), device, teacher)
    print(f"training throughput: {result.images_per_second:,.0f} images/s on {device}")

    held_out = evaluate_split(
        model, dataset, Split.VAL, arguments.batch_size, device, arguments.readers
    )
    validation = bucketed_accuracy(held_out.logits, held_out.labels, held_out.fractions)
    print(format_report("validation", validation))
    temperatures = fit_regime_temperatures(held_out.logits, held_out.labels, held_out.partial)
    before = negative_log_likelihood(held_out.logits, held_out.labels, 1.0)
    after = negative_log_likelihood(held_out.logits, held_out.labels, temperatures.pooled)
    print(
        f"temperature {temperatures.pooled:.3f}  (val NLL {before:.4f} -> {after:.4f}); "
        f"finished {temperatures.finished:.3f}, partial {temperatures.partial:.3f}"
    )
    fold_map = FoldMap.of(categories, read_aliases(arguments.fold_map))
    selection = selection_report(
        held_out.logits,
        held_out.labels,
        held_out.fractions,
        temperatures,
        fold_map,
        held_out.retrieval_recall_at_10,
    )
    print(report_selection("validation", selection))
    unseen = evaluate_split(
        model, dataset, Split.TEST, arguments.batch_size, device, arguments.readers
    )
    test = bucketed_accuracy(unseen.logits, unseen.labels, unseen.fractions)
    print(format_report("test", test))

    summary = TrainingSummary(
        trained_on=trained_on(arguments, categories),
        temperatures=temperatures,
        certain_above=conservative_floors(
            selection.certain_above_finished, selection.certain_above_partial
        ),
        validation=validation,
        test=test,
        selection=selection.to_json(),
        recipe=arguments.recipe(),
        training=training_record(result, time.perf_counter() - started),
    )
    artifacts_dir = arguments.artifacts_dir / arguments.name
    write_artifacts(model, categories, summary, bin_dir, artifacts_dir)
    print(f"artefacts written to {artifacts_dir}")


if __name__ == "__main__":
    main()
