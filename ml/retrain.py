"""Retrain Kami's Eye on this machine, one resumable stage at a time (ml/README.md).

    python retrain.py all --preset full --name kami-eye-2      # data, train, ..., package
    python retrain.py bench --hours 24                        # what fits in a day here

Every stage skips work that is already done, so re-running a command resumes it. A run lives in
artifacts/runs/<name>/ (recipe, checkpoint, log, assessment, package); its release is
artifacts/<name>, the directory the sidecar serves; downloads and the index live in data/.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass, replace
from datetime import date
from pathlib import Path

import torch

from artifacts import PREPROCESS_FILE, RELEASE_FILE, CertaintyFloors, digest, read_object
from calibrate import RegimeTemperatures
from exemplar_set import EXEMPLARS_DIR, load_exemplars_of_model
from exemplars import Selection, print_summary, write_exemplars
from export import CHECKPOINT_FILE, TrainingSummary, write_artifacts
from folding import DEFAULT_FOLD_MAP, FoldMap, read_aliases
from kit.assess import assess
from kit.bench import (
    Budget,
    drawings_for_hours,
    measure_render,
    measure_step,
    workers_needed,
)
from kit.corpus import META_FILE, Corpus
from kit.devices import DEVICE_CHOICES, PRECISION_CHOICES, Accelerator, Precision
from kit.journal import duration, journal, open_journal, write_json_atomically
from kit.recipe import ML_DIR, Recipe, Runtime, presets, read_categories
from kit.release import Package, model_card, publish, write_package
from kit.trainer import RunFiles, Trainer
from kit.verify import verify_release
from metrics import Accuracy
from model import Arch, SketchNet
from quickdraw_bin import BYTES_PER_MEGABYTE, category_path, download_categories

DOWNLOAD_BYTES_PER_DRAWING = 250
TOP_UP_MARGIN = 1.15
DEFAULT_EXEMPLAR_MIN_PROBABILITY = 0.7
PID_FILE = "retrain.pid"


@dataclass(frozen=True, slots=True)
class Paths:
    data: Path
    artifacts: Path
    name: str

    @property
    def bins(self) -> Path:
        return self.data / "bin"

    @property
    def index(self) -> Path:
        return self.data / "index"

    @property
    def run(self) -> RunFiles:
        return RunFiles(self.artifacts / "runs" / self.name)

    @property
    def release(self) -> Path:
        return self.artifacts / self.name


@dataclass(frozen=True, slots=True)
class Context:
    paths: Paths
    recipe: Recipe
    runtime: Runtime
    arguments: argparse.Namespace

    @property
    def files(self) -> RunFiles:
        return self.paths.run

    def accelerator(self) -> Accelerator:
        return Accelerator.of(self.runtime.device, self.runtime.precision, self.runtime.compile)


RECIPE_OVERRIDES: dict[str, Callable[[Recipe, object], Recipe]] = {
    "categories": lambda recipe, path: replace(recipe, categories=read_categories(Path(str(path)))),
    "drawings_per_class": lambda recipe, value: replace(recipe, drawings_per_class=int(str(value))),
    "epochs": lambda recipe, value: replace(recipe, epochs=int(str(value))),
    "batch_size": lambda recipe, value: replace(recipe, batch_size=int(str(value))),
    "learning_rate": lambda recipe, value: replace(recipe, learning_rate=float(str(value))),
    "arch": lambda recipe, value: replace(recipe, arch=Arch(str(value))),
    "eval_head": lambda recipe, value: replace(recipe, eval_head=int(str(value))),
    "seed": lambda recipe, value: replace(recipe, seed=int(str(value))),
    "finished_share": lambda recipe, value: replace(
        recipe, looks=replace(recipe.looks, finished_share=float(str(value)))
    ),
}


def resolve_recipe(arguments: argparse.Namespace, files: RunFiles) -> Recipe:
    """The run's saved recipe; a preset or override that contradicts it is an error."""
    overrides = {
        key: getattr(arguments, key)
        for key in RECIPE_OVERRIDES
        if getattr(arguments, key) is not None
    }
    saved = (
        Recipe.from_json(json.loads(files.recipe.read_text())) if files.recipe.exists() else None
    )
    if saved is not None and arguments.preset is None and not overrides:
        return saved
    recipe = presets()[arguments.preset or "full"].recipe
    for key, value in overrides.items():
        recipe = RECIPE_OVERRIDES[key](recipe, value)
    if saved is not None and saved != recipe:
        raise SystemExit(
            f"run '{arguments.name}' was started with another recipe ({files.recipe}); "
            "leave out --preset and the overrides to resume it, or choose a new --name"
        )
    return recipe


def save_recipe(context: Context) -> None:
    context.files.directory.mkdir(parents=True, exist_ok=True)
    if not context.files.recipe.exists():
        write_json_atomically(context.files.recipe, context.recipe.to_json())


def stage_data(context: Context) -> Corpus:
    log = journal()
    recipe, paths = context.recipe, context.paths
    spec = recipe.corpus_spec()
    megabytes = math.ceil(spec.drawings_per_class * DOWNLOAD_BYTES_PER_DRAWING / BYTES_PER_MEGABYTE)
    log.info(f"download: the first {megabytes} MB of {len(spec.categories)} categories")
    download_categories(spec.categories, paths.bins, megabytes)
    corpus = Corpus.build(spec, paths.bins, paths.index, context.arguments.index_workers)
    short = {
        name: count for name, count in corpus.counts().items() if count < spec.drawings_per_class
    }
    top_up = {
        name: count
        for name, count in short.items()
        if category_path(paths.bins, name).stat().st_size >= megabytes * BYTES_PER_MEGABYTE * 0.99
    }
    for name, count in top_up.items():
        more = math.ceil(megabytes * spec.drawings_per_class / max(count, 1) * TOP_UP_MARGIN)
        log.info(f"{name}: {count:,} recognised drawings in {megabytes} MB; fetching {more} MB")
        download_categories([name], paths.bins, more)
    if top_up:
        corpus = Corpus.build(
            spec, paths.bins, paths.index, context.arguments.index_workers, rebuild=True
        )
    counts = corpus.counts()
    short = {name: count for name, count in counts.items() if count < spec.drawings_per_class}
    if short:
        listed = ", ".join(f"{name} {count:,}" for name, count in sorted(short.items()))
        log.info(f"{len(short)} categories have fewer drawings than asked (all there is): {listed}")
    size = sum(path.stat().st_size for path in paths.bins.glob("*.bin")) / 1e9
    log.info(
        f"corpus: {len(corpus):,} drawings of {len(counts)} categories; {size:.1f} GB of .bin "
        f"in {paths.bins}, index in {corpus.directory}"
    )
    return corpus


def load_trained(context: Context) -> SketchNet:
    model = SketchNet(len(context.recipe.categories), context.recipe.arch)
    model.load_state_dict(torch.load(context.files.weights, map_location="cpu", weights_only=True))
    return model


def stage_train(context: Context) -> None:
    log = journal()
    if context.files.weights.exists():
        log.info(f"train: done ({context.files.weights})")
        return
    save_recipe(context)
    corpus = stage_data(context)
    log.info(f"recipe: {context.recipe.summary()}")
    trainer = Trainer(context.recipe, corpus, context.files, context.accelerator(), context.runtime)
    trainer.fit()
    trainer.write_weights()
    log.info(f"train: finished in {duration(trainer.clocks.seconds_training)} of training")


def stage_calibrate(context: Context) -> dict[str, object]:
    log = journal()
    if context.files.assessment.exists():
        log.info(f"calibrate: done ({context.files.assessment})")
        return read_object(context.files.assessment)
    corpus = Corpus.build(context.recipe.corpus_spec(), context.paths.bins, context.paths.index)
    accelerator = context.accelerator()
    model = load_trained(context)
    accelerator.prepare(model)
    fold_map = FoldMap.of(context.recipe.categories, read_aliases(DEFAULT_FOLD_MAP))
    assessment = assess(
        model, corpus, context.recipe.eval_head, accelerator, context.runtime.workers, fold_map
    )
    record = {"weightsSha256": digest(context.files.weights), **assessment.to_json()}
    write_json_atomically(context.files.assessment, record)
    test = assessment.test["finished"]
    log.info(
        f"calibrate: test finished top-1 {test.top1:.1%} top-3 {test.top3:.1%} "
        f"(kami-eye-xl: 83.1 % / 95.2 %); temperatures {asdict(assessment.temperatures)}"
    )
    return record


def _accuracy_table(table: object) -> dict[str, Accuracy]:
    assert isinstance(table, dict)
    return {name: Accuracy(**result) for name, result in table.items()}


def trained_on(recipe: Recipe) -> str:
    return (
        f"Quick, Draw! {len(recipe.categories)} categories x up to {recipe.drawings_per_class:,} "
        f"recognised drawings, rendered afresh every pass ({recipe.looks.finished_share:.0%} "
        f"finished, the rest 30-100 % prefixes), {recipe.epochs} epoch(s)"
    )


def stage_export(context: Context) -> Path:
    log = journal()
    weights_sha = digest(context.files.weights)
    release = context.paths.release
    if (release / PREPROCESS_FILE).exists():
        training = read_object(release / PREPROCESS_FILE).get("training", {})
        if isinstance(training, dict) and training.get("weightsSha256") == weights_sha:
            log.info(f"export: done ({release} -> {release.resolve()})")
            return release
    assessment = stage_calibrate(context)
    temperatures = assessment["temperatures"]
    floors = assessment["certainAbove"]
    assert isinstance(temperatures, dict) and isinstance(floors, dict)
    training = read_object(context.files.training)
    summary = TrainingSummary(
        trained_on=trained_on(context.recipe),
        temperatures=RegimeTemperatures(**temperatures),
        certain_above=CertaintyFloors(floors["finished"], floors["partial"]),
        validation=_accuracy_table(assessment["validation"]),
        test=_accuracy_table(assessment["test"]),
        selection={
            "validation": assessment["selection"],
            "test": assessment["testSelection"],
        },
        recipe={
            **{k: v for k, v in context.recipe.to_json().items() if k != "categories"},
            "fingerprint": context.recipe.fingerprint(),
            "kit": "ml/retrain.py",
        },
        training={
            **{k: v for k, v in training.items() if k != "history"},
            "weightsSha256": weights_sha,
            "history": training.get("history", []),
        },
    )
    model = load_trained(context)
    write_artifacts(model, context.recipe.categories, summary, context.paths.bins, release)
    log.info(f"export: {release} -> {release.resolve()}")
    return release


def stage_exemplars(context: Context) -> None:
    log = journal()
    release = context.paths.release
    if (release / EXEMPLARS_DIR).exists() and load_exemplars_of_model(release) is not None:
        log.info(f"exemplars: done ({release / EXEMPLARS_DIR})")
        return
    selection = Selection(min_probability=context.arguments.min_probability)
    report = write_exemplars(release.resolve(), context.paths.bins, selection, threads=None)
    print_summary(release.resolve(), selection, report)


def stage_validate(context: Context) -> None:
    for line in verify_release(context.paths.release).lines():
        journal().info(f"validate: {line}")


def package_of(context: Context) -> Package:
    version = context.arguments.version or f"{context.paths.name}-{date.today():%Y.%m.%d}"
    return Package(context.files.package / version, version)


def stage_package(context: Context) -> Package:
    log = journal()
    package = package_of(context)
    if package.complete():
        log.info(f"package: done ({package.directory})")
        return package
    release = context.paths.release.resolve(strict=True)
    card = model_card(
        package.version,
        read_object(release / PREPROCESS_FILE),
        stage_calibrate(context),
        read_object(context.files.training),
        digest(release / RELEASE_FILE),
    )
    write_package(package, release, release / CHECKPOINT_FILE, card, f"kami-eye-{package.version}")
    log.info(f"package: {', '.join(path.name for path in package.assets)} in {package.directory}")
    return package


def stage_publish(context: Context) -> None:
    package = package_of(context)
    if not package.complete():
        raise SystemExit(f"no complete package at {package.directory}: run the package stage")
    command = publish(package, context.arguments.repo, context.arguments.dry_run)
    journal().info(f"publish: {'would run' if context.arguments.dry_run else 'ran'} {command}")


def stage_all(context: Context) -> None:
    stage_train(context)
    stage_calibrate(context)
    stage_export(context)
    if not context.arguments.skip_exemplars:
        stage_exemplars(context)
    stage_validate(context)
    stage_package(context)


def stage_data_only(context: Context) -> None:
    save_recipe(context)
    stage_data(context)


def any_corpus(context: Context) -> Corpus | None:
    """The recipe's index when it is built, else any index there is: real drawings to render."""
    own = context.paths.index / context.recipe.corpus_spec().directory_name()
    built = (
        sorted(context.paths.index.glob(f"*/{META_FILE}")) if context.paths.index.exists() else []
    )
    candidates = [own / META_FILE, *built]
    found = next((meta for meta in candidates if meta.exists()), None)
    return Corpus(found.parent, context.paths.bins) if found is not None else None


def stage_bench(context: Context) -> None:
    log = journal()
    recipe, runtime, arguments = context.recipe, context.runtime, context.arguments
    precisions = (
        [precision.value for precision in Precision] if arguments.sweep else [runtime.precision]
    )
    speeds = []
    for precision in precisions:
        try:
            accelerator = Accelerator.of(runtime.device, precision, runtime.compile)
        except ValueError as error:
            log.info(f"bench: {precision}: {error}")
            continue
        speed = measure_step(accelerator, recipe.arch, recipe.batch_size, arguments.seconds)
        log.info(f"bench: training step, {speed.line()}")
        speeds.append(speed)
    best = max(speeds, key=lambda speed: speed.images_per_second)
    corpus = any_corpus(context)
    renders = measure_render(corpus, recipe.looks)
    log.info(
        f"bench: rendering {renders:,.0f} training looks/s on one core "
        f"({'this corpus' if corpus else 'synthetic drawings'}); the step needs "
        f"{workers_needed(best.images_per_second, renders)} DataLoader workers"
    )
    rate = best.images_per_second
    categories = len(recipe.categories)
    log.info(f"bench: at {rate:,.0f} img/s ({best.accelerator.precision.value}):")
    for drawings in sorted({recipe.drawings_per_class, 22_000, 50_000, 100_000}):
        log.info("  " + Budget(categories, drawings, recipe.epochs, rate).line())
    xl = Budget(345, 22_000, 10, rate)
    log.info(f"  kami-eye-xl's run (345 x 22,000 x 10 epochs) would take {xl.training_hours:.1f} h")
    if arguments.hours:
        drawings = drawings_for_hours(arguments.hours, categories, recipe.epochs, rate)
        log.info(
            f"  {arguments.hours:g} h allow {recipe.epochs} epoch(s) over up to {drawings:,} "
            f"drawings per class: --drawings-per-class {drawings}"
        )


def stage_status(context: Context) -> None:
    files = context.files
    done = {
        "recipe": files.recipe.exists(),
        "train": files.weights.exists(),
        "calibrate": files.assessment.exists(),
        "export": (context.paths.release / PREPROCESS_FILE).exists(),
        "exemplars": (context.paths.release / EXEMPLARS_DIR).exists(),
        "package": package_of(context).complete(),
    }
    print(f"run {context.paths.name} in {files.directory}")
    print("  " + "  ".join(f"{stage} {'done' if ok else '-'}" for stage, ok in done.items()))
    if files.progress.exists():
        progress = read_object(files.progress)
        print(
            f"  step {progress['step']:,}/{progress['total_steps']:,} ({progress['percent']:.1f} %)"
            f", {progress['images_per_second']:,.0f} img/s, ETA {progress['finishes_at']}"
            f" (updated {progress['updated_at']})"
        )
    if files.log.exists():
        print("  last lines of " + str(files.log) + ":")
        for line in files.log.read_text().splitlines()[-5:]:
            print("    " + line)


STAGES: dict[str, tuple[Callable[[Context], object], str]] = {
    "bench": (stage_bench, "measure training and rendering speed; print what fits --hours"),
    "data": (stage_data_only, "download the .bin heads and build the index"),
    "train": (stage_train, "train (resumes from the last checkpoint)"),
    "calibrate": (stage_calibrate, "validation and test tables, temperatures, floors"),
    "export": (stage_export, "write the release the sidecar serves: artifacts/<name>"),
    "exemplars": (stage_exemplars, "build the /complete exemplar set for the release"),
    "validate": (stage_validate, "check the release: hashes, golden parity, a live sidecar"),
    "package": (stage_package, "tarball, weights, model card and SHA256SUMS"),
    "publish": (stage_publish, "gh release create eye-<version> with the package"),
    "all": (stage_all, "train, calibrate, export, exemplars, validate, package"),
    "status": (stage_status, "where a run is"),
}


def common_options() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    run = common.add_argument_group("run")
    run.add_argument("--name", default="kami-eye-next", help="run and release name")
    run.add_argument("--preset", choices=sorted(presets()), help="default: full (new runs)")
    run.add_argument("--data-dir", type=Path, default=ML_DIR / "data")
    run.add_argument("--artifacts-dir", type=Path, default=ML_DIR / "artifacts")
    recipe = common.add_argument_group("recipe overrides (fixed once a run starts)")
    recipe.add_argument("--categories", type=Path, help="file, one category per line")
    recipe.add_argument("--drawings-per-class", type=int)
    recipe.add_argument("--epochs", type=int)
    recipe.add_argument("--batch-size", type=int)
    recipe.add_argument("--learning-rate", type=float)
    recipe.add_argument("--arch", choices=[arch.value for arch in Arch])
    recipe.add_argument("--eval-head", type=int)
    recipe.add_argument("--seed", type=int)
    recipe.add_argument("--finished-share", type=float)
    runtime = common.add_argument_group("runtime (free to change between resumes)")
    defaults = Runtime()
    runtime.add_argument("--device", choices=DEVICE_CHOICES, default=defaults.device)
    runtime.add_argument("--precision", choices=PRECISION_CHOICES, default=defaults.precision)
    runtime.add_argument("--compile", action="store_true", help="torch.compile (CUDA only helps)")
    runtime.add_argument("--workers", type=int, default=defaults.workers)
    runtime.add_argument("--checkpoint-minutes", type=float, default=defaults.checkpoint_minutes)
    runtime.add_argument("--probe-minutes", type=float, default=defaults.probe_minutes)
    runtime.add_argument("--index-workers", type=int, help="processes indexing .bin files")
    stage = common.add_argument_group("stage options")
    stage.add_argument("--seconds", type=float, default=60.0, help="bench: seconds per setting")
    stage.add_argument("--sweep", action="store_true", help="bench: every precision")
    stage.add_argument("--hours", type=float, help="bench: the budget to plan a run for")
    stage.add_argument("--min-probability", type=float, default=DEFAULT_EXEMPLAR_MIN_PROBABILITY)
    stage.add_argument("--skip-exemplars", action="store_true", help="all: without /complete")
    stage.add_argument("--version", help="package/publish: default <name>-<today>")
    stage.add_argument("--repo", help="publish: owner/name; default: the current repository")
    stage.add_argument("--dry-run", action="store_true", help="publish: print, do not run")
    return common


@contextmanager
def running(pid_file: Path) -> Iterator[None]:
    """The pid `retrain.sh stop` signals; gone again however the stage ends."""
    pid_file.parent.mkdir(parents=True, exist_ok=True)
    pid_file.write_text(str(os.getpid()))
    try:
        yield
    finally:
        pid_file.unlink(missing_ok=True)


def parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    stages = parser.add_subparsers(dest="stage", required=True, metavar="STAGE")
    common = common_options()
    for name, (_, help_text) in STAGES.items():
        stages.add_parser(name, parents=[common], help=help_text)
    return parser.parse_args(argv)


def context_of(arguments: argparse.Namespace) -> Context:
    if arguments.name == "runs":
        raise SystemExit("'runs' is where runs live; choose another --name")
    paths = Paths(arguments.data_dir, arguments.artifacts_dir, arguments.name)
    runtime = Runtime(
        device=arguments.device,
        precision=arguments.precision,
        compile=arguments.compile,
        workers=arguments.workers,
        checkpoint_minutes=arguments.checkpoint_minutes,
        probe_minutes=arguments.probe_minutes,
    )
    return Context(paths, resolve_recipe(arguments, paths.run), runtime, arguments)


def main(argv: list[str] | None = None) -> None:
    arguments = parse_arguments(argv)
    context = context_of(arguments)
    if arguments.stage == "status":
        stage_status(context)
        return
    open_journal(context.files.log)
    journal().info(f"== {arguments.stage} {arguments.name}")
    with running(context.files.directory / PID_FILE):
        STAGES[arguments.stage][0](context)


if __name__ == "__main__":
    main()
