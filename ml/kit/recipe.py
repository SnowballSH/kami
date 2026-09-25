"""A recipe is everything that decides what a run learns; it is written into the run directory when
the run starts, and a resumed run refuses to continue under a different one.

How a run executes (device, precision, workers, checkpoint cadence) is `Runtime`, not the recipe:
a run may be resumed on another machine with other settings and still learn the same model.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import TypeVar

from kit.corpus import CorpusSpec
from kit.looks import LookPolicy
from model import Arch

ML_DIR = Path(__file__).resolve().parent.parent
CATEGORIES_DIR = ML_DIR / "categories"
ALL_CATEGORIES_FILE = CATEGORIES_DIR / "all.txt"
KAMI_EYE_XL_HEAD = 22_000

N = TypeVar("N", int, float)


def read_categories(path: Path) -> tuple[str, ...]:
    known = set(ALL_CATEGORIES_FILE.read_text().splitlines())
    categories = tuple(line.strip() for line in path.read_text().splitlines() if line.strip())
    unknown = [category for category in categories if category not in known]
    if unknown:
        raise ValueError(f"not Quick, Draw! categories: {', '.join(unknown)}")
    if len(set(categories)) != len(categories):
        raise ValueError(f"{path} lists a category twice")
    return categories


def _number(value: dict[str, object], key: str, kind: type[N]) -> N:
    item = value[key]
    if isinstance(item, bool) or not isinstance(item, int | float):
        raise ValueError(f"{key} must be a number")
    return kind(item)


@dataclass(frozen=True, slots=True)
class Recipe:
    """`eval_head`: validation and test drawings are those among each category's first
    `eval_head` recognised drawings — at 22,000 exactly the drawings kami-eye-xl was scored on."""

    categories: tuple[str, ...]
    drawings_per_class: int
    epochs: int
    batch_size: int = 512
    learning_rate: float = 1.5e-3
    weight_decay: float = 0.02
    warmup_share: float = 0.03
    label_smoothing: float = 0.1
    arch: Arch = Arch.RESNET18
    looks: LookPolicy = field(default_factory=LookPolicy)
    eval_head: int = KAMI_EYE_XL_HEAD
    seed: int = 0

    def __post_init__(self) -> None:
        if not self.categories:
            raise ValueError("a recipe needs categories")
        if min(self.drawings_per_class, self.epochs, self.batch_size, self.eval_head) < 1:
            raise ValueError("drawings, epochs, batch size and eval head must be positive")
        if not 0.0 <= self.warmup_share < 1.0:
            raise ValueError("warmup_share must be in [0, 1)")

    def corpus_spec(self) -> CorpusSpec:
        return CorpusSpec(self.categories, max(self.drawings_per_class, self.eval_head))

    def to_json(self) -> dict[str, object]:
        return {**asdict(self), "categories": list(self.categories), "arch": self.arch.value}

    @staticmethod
    def from_json(value: dict[str, object]) -> Recipe:
        unknown = set(value) - {item.name for item in fields(Recipe)}
        if unknown:
            raise ValueError(f"unknown recipe fields: {', '.join(sorted(unknown))}")
        categories, looks = value["categories"], value["looks"]
        if not isinstance(categories, list) or not isinstance(looks, dict):
            raise ValueError("categories must be a list and looks an object")
        return Recipe(
            categories=tuple(str(category) for category in categories),
            drawings_per_class=_number(value, "drawings_per_class", int),
            epochs=_number(value, "epochs", int),
            batch_size=_number(value, "batch_size", int),
            learning_rate=_number(value, "learning_rate", float),
            weight_decay=_number(value, "weight_decay", float),
            warmup_share=_number(value, "warmup_share", float),
            label_smoothing=_number(value, "label_smoothing", float),
            arch=Arch(str(value["arch"])),
            looks=LookPolicy(**{key: _number(looks, key, float) for key in looks}),
            eval_head=_number(value, "eval_head", int),
            seed=_number(value, "seed", int),
        )

    def fingerprint(self) -> str:
        return hashlib.sha256(json.dumps(self.to_json(), sort_keys=True).encode()).hexdigest()

    def summary(self) -> str:
        return (
            f"{self.arch.value}, {len(self.categories)} categories x up to "
            f"{self.drawings_per_class:,} drawings, {self.epochs} epoch(s), batch "
            f"{self.batch_size}, AdamW {self.learning_rate:g} (wd {self.weight_decay:g}), label "
            f"smoothing {self.label_smoothing:g}, {self.looks.finished_share:.0%} finished looks"
        )


@dataclass(frozen=True, slots=True)
class Preset:
    description: str
    recipe: Recipe


def _preset_categories(name: str) -> tuple[str, ...]:
    return read_categories(CATEGORIES_DIR / name)


def presets() -> dict[str, Preset]:
    return {
        "smoke": Preset(
            "8 easy categories, a few minutes: proves the pipeline end to end",
            Recipe(
                _preset_categories("smoke.txt"),
                drawings_per_class=3_000,
                epochs=2,
                batch_size=256,
                eval_head=3_000,
            ),
        ),
        "full": Preset(
            "all 345 categories: the recipe chosen to beat kami-eye-xl (ml/README.md)",
            Recipe(_preset_categories("all.txt"), drawings_per_class=120_000, epochs=1),
        ),
    }


@dataclass(frozen=True, slots=True)
class Runtime:
    device: str = "auto"
    precision: str = "auto"
    compile: bool = False
    workers: int = 4
    checkpoint_minutes: float = 15.0
    probe_minutes: float = 60.0
    probe_drawings_per_class: int = 20
    log_seconds: float = 60.0
