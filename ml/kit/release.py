"""A finished run as something to hand over: a tarball of the release directory (exemplars
included), the PyTorch weights, a model card with the test tables, and SHA256SUMS over all three;
and the `gh release create` that publishes them."""

from __future__ import annotations

import json
import shlex
import subprocess
import tarfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from artifacts import digest
from kit.journal import duration

MODEL_CARD_FILE = "MODEL_CARD.md"
SUMS_FILE = "SHA256SUMS"
KAMI_EYE_XL_TEST = {
    "finished": (0.831, 0.952),
    "prefix 90%-100%": (0.827, 0.951),
    "prefix 70%-90%": (0.762, 0.921),
    "prefix 50%-70%": (0.600, 0.816),
    "prefix 30%-50%": (0.367, 0.600),
}
BUCKET_ORDER = (
    "finished",
    "prefix 90%-100%",
    "prefix 70%-90%",
    "prefix 50%-70%",
    "prefix 30%-50%",
    "overall",
)


@dataclass(frozen=True, slots=True)
class Package:
    directory: Path
    version: str

    @property
    def tag(self) -> str:
        return f"eye-{self.version}"

    @property
    def bundle(self) -> Path:
        return self.directory / f"kami-eye-{self.version}.tar.gz"

    @property
    def weights(self) -> Path:
        return self.directory / f"kami-eye-{self.version}.model.pt"

    @property
    def card(self) -> Path:
        return self.directory / MODEL_CARD_FILE

    @property
    def sums(self) -> Path:
        return self.directory / SUMS_FILE

    @property
    def assets(self) -> tuple[Path, ...]:
        return (self.bundle, self.weights, self.card, self.sums)

    def complete(self) -> bool:
        return all(path.exists() for path in self.assets)


def _percent(value: object) -> str:
    return f"{100 * value:.1f} %" if isinstance(value, int | float) else "n/a"


def _bucket_rows(table: Mapping[str, Mapping[str, object]], compare: bool) -> list[str]:
    header = "| Drawings | n | Top-1 | Top-3 |" + (
        " kami-eye-xl top-1 / top-3 |" if compare else ""
    )
    rule = "|---|---|---|---|" + ("---|" if compare else "")
    rows = [header, rule]
    for bucket in BUCKET_ORDER:
        if bucket not in table:
            continue
        result = table[bucket]
        row = f"| {bucket} | {result['count']:,} | {_percent(result['top1'])} | "
        row += f"{_percent(result['top3'])} |"
        if compare:
            reference = KAMI_EYE_XL_TEST.get(bucket)
            row += f" {_percent(reference[0])} / {_percent(reference[1])} |" if reference else " |"
        rows.append(row)
    return rows


def model_card(
    version: str,
    preprocess: Mapping[str, object],
    assessment: Mapping[str, object],
    training: Mapping[str, object],
    release_sha256: str,
) -> str:
    recipe = preprocess.get("recipe", {})
    selection = assessment["selection"]
    temperatures = assessment["temperatures"]
    floors = assessment["certainAbove"]
    assert isinstance(recipe, Mapping) and isinstance(selection, Mapping)
    assert isinstance(temperatures, Mapping) and isinstance(floors, Mapping)
    test = assessment["test"]
    validation = assessment["validation"]
    assert isinstance(test, Mapping) and isinstance(validation, Mapping)
    seconds = training.get("secondsTraining", 0.0)
    lines = [
        f"# Kami's Eye {version}",
        "",
        f"{preprocess['trainedOn']}. Architecture `{preprocess.get('arch')}`, 64x64 one-channel "
        "raster, trained with `ml/retrain.py` (ml/README.md). Serves under `ml/sidecar.py` "
        "unchanged (ml/CONTRACT.md).",
        "",
        "## Test split",
        "",
        "Validation and test drawings are those among each category's first "
        f"{recipe.get('eval_head', 'n/a')} recognised drawings (at 22,000: exactly kami-eye-xl's "
        "test drawings), each read finished and as one prefix of 30-100 % of its points.",
        "",
        *_bucket_rows(test, compare=True),
        "",
        "## Validation split",
        "",
        *_bucket_rows(validation, compare=False),
        "",
        "## Calibration and selection (validation, alias-folded)",
        "",
        f"- Temperatures: finished {temperatures['finished']:.3f}, partial "
        f"{temperatures['partial']:.3f} (pooled {temperatures['pooled']:.3f})",
        f"- certainAbove: finished {floors['finished']}, partial {floors['partial']}",
        f"- Selection metric S {selection['score']:.2f}; coverage at 95 % precision "
        f"{_percent(selection['cov95_finished'])} finished; ECE finished "
        f"{_percent(selection['ece_finished'])}, partial {_percent(selection['ece_partial'])}; "
        f"own-drawing recall@10 {_percent(selection['retrieval_recall_at_10'])}",
        "",
        "## Training",
        "",
        f"- {training.get('images', 0):,} image passes over {training.get('trainingDrawings', 0):,}"
        f" drawings in {duration(float(str(seconds)))} on {training.get('device', 'n/a')}",
        f"- Recipe: `{json.dumps({k: v for k, v in recipe.items() if k != 'categories'})}`",
        "",
        f"release.json SHA-256 (the sidecar's `artifactId`): `{release_sha256}`",
        "",
    ]
    return "\n".join(lines)


def write_package(package: Package, release_dir: Path, weights: Path, card: str, name: str) -> None:
    package.directory.mkdir(parents=True, exist_ok=True)
    staging = package.bundle.with_suffix(".tmp")
    with tarfile.open(staging, "w:gz") as bundle:
        for path in sorted(release_dir.rglob("*")):
            if path.is_file() and path.name != "model.pt":
                bundle.add(path, arcname=str(Path(name) / path.relative_to(release_dir)))
    staging.replace(package.bundle)
    package.weights.write_bytes(weights.read_bytes())
    package.card.write_text(card)
    listed = (package.bundle, package.weights, package.card)
    package.sums.write_text("".join(f"{digest(path)}  {path.name}\n" for path in listed))


def publish_command(package: Package, repository: str | None) -> list[str]:
    command = [
        "gh",
        "release",
        "create",
        package.tag,
        *(str(path) for path in package.assets),
        "--title",
        f"Kami's Eye {package.version}",
        "--notes-file",
        str(package.card),
    ]
    return [*command, "--repo", repository] if repository else command


def publish(package: Package, repository: str | None, dry_run: bool) -> str:
    command = publish_command(package, repository)
    if not dry_run:
        subprocess.run(command, check=True)
    return shlex.join(command)
