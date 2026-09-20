"""Validation and atomic publication of immutable model releases (no model execution)."""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

MODEL_FILE = "model.onnx"
LABELS_FILE = "labels.json"
PREPROCESS_FILE = "preprocess.json"
GOLDEN_FILE = "golden.json"
RELEASE_FILE = "release.json"
REQUIRED_FILES = (MODEL_FILE, LABELS_FILE, PREPROCESS_FILE, GOLDEN_FILE)


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def read_object(path: Path) -> dict[str, object]:
    value: object = json.loads(path.read_text())
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise ValueError(f"{path.name} must be an object")
    return dict(value)


@dataclass(frozen=True)
class CertaintyFloors:
    """The calibrated, alias-folded confidence from which a guess is right 95 % of the time on
    held-out drawings, per regime; None when no confidence is that trustworthy."""

    finished: float | None
    partial: float | None

    def of(self, partial: bool) -> float | None:
        return self.partial if partial else self.finished

    def to_json(self) -> dict[str, float | None]:
        return {"finished": self.finished, "partial": self.partial}


@dataclass(frozen=True)
class Metadata:
    labels: tuple[str, ...]
    temperature: float
    temperature_partial: float
    certain_above: CertaintyFloors | None


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        return None
    return float(value)


def _temperature(metadata: dict[str, object], key: str) -> float:
    temperature = _finite_number(metadata.get(key))
    if temperature is None or temperature <= 0:
        raise ValueError(f"{key} must be positive and finite")
    return temperature


def _floor(floors: dict[str, object], regime: str) -> float | None:
    if floors.get(regime) is None:
        return None
    floor = _finite_number(floors[regime])
    if floor is None or not 0 < floor <= 1:
        raise ValueError(f"certainAbove.{regime} must be null or in (0, 1]")
    return floor


def _certainty_floors(metadata: dict[str, object]) -> CertaintyFloors | None:
    floors = metadata.get("certainAbove")
    if floors is None:
        return None
    if not isinstance(floors, dict):
        raise ValueError("certainAbove must be an object")
    return CertaintyFloors(_floor(floors, "finished"), _floor(floors, "partial"))


def load_metadata(directory: Path, renderer: dict[str, int | str]) -> Metadata:
    """Models from before the regimes have one temperature for both and state no floors."""
    labels: object = json.loads((directory / LABELS_FILE).read_text())
    if not isinstance(labels, list) or not labels:
        raise ValueError("labels must be a nonempty array")
    names: list[str] = []
    for label in labels:
        if not isinstance(label, str) or not label.strip() or label in names:
            raise ValueError("labels must be unique nonempty strings")
        names.append(label)
    metadata = read_object(directory / PREPROCESS_FILE)
    for key, expected in renderer.items():
        if type(metadata.get(key)) is not type(expected) or metadata[key] != expected:
            raise ValueError(f"incompatible renderer: {key}")
    temperature = _temperature(metadata, "temperature")
    partial = (
        _temperature(metadata, "temperaturePartial")
        if "temperaturePartial" in metadata
        else temperature
    )
    return Metadata(tuple(names), temperature, partial, _certainty_floors(metadata))


@dataclass(frozen=True)
class TensorSpec:
    name: str
    dtype: str
    shape: Sequence[int | str | None]


def validate_tensors(
    inputs: Sequence[TensorSpec], outputs: Sequence[TensorSpec], classes: int
) -> None:
    expected = (("image", (1, 64, 64)), ("logits", (classes,)), ("embedding", (512,)))
    if len(inputs) != 1 or len(outputs) != 2:
        raise ValueError("expected one input and two outputs")
    for node, (name, dimensions) in zip((*inputs, *outputs), expected, strict=True):
        if (
            node.name != name
            or node.dtype != "tensor(float)"
            or len(node.shape) != len(dimensions) + 1
            or tuple(node.shape[1:]) != dimensions
            or (isinstance(node.shape[0], int) and node.shape[0] != 1)
        ):
            raise ValueError(f"incompatible model tensor: {name}")


def seal_bundle(directory: Path) -> None:
    hashes = {name: digest(directory / name) for name in REQUIRED_FILES}
    (directory / RELEASE_FILE).write_text(
        json.dumps({"version": 1, "sha256": hashes}, sort_keys=True)
    )


def validate_bundle(directory: Path) -> str:
    manifest = read_object(directory / RELEASE_FILE)
    if manifest.get("version") != 1:
        raise ValueError("unsupported model release version")
    hashes = manifest.get("sha256")
    if not isinstance(hashes, dict) or set(hashes) != set(REQUIRED_FILES):
        raise ValueError("incomplete model release manifest")
    for name in REQUIRED_FILES:
        path = directory / name
        if not path.is_file() or path.stat().st_size == 0 or digest(path) != hashes[name]:
            raise ValueError(f"missing or corrupt model artifact: {name}")
    cases: object = json.loads((directory / GOLDEN_FILE).read_text())
    if not isinstance(cases, list) or not cases:
        raise ValueError("golden cases must be a nonempty array")
    return digest(directory / RELEASE_FILE)


def publish_bundle(destination: Path, build: Callable[[Path], None]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and not destination.is_symlink():
        raise ValueError("existing model directory is not a release link; export under a new name")
    releases = destination.parent / f".{destination.name}-releases"
    releases.mkdir(exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="release-", dir=releases))
    link = staging.with_suffix(".link")
    published = False
    try:
        build(staging)
        validate_bundle(staging)
        link.symlink_to(staging.resolve(), target_is_directory=True)
        link.replace(destination)
        published = True
    finally:
        link.unlink(missing_ok=True)
        if not published:
            shutil.rmtree(staging)
