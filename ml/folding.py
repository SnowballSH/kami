"""Alias folding: the game merges near-synonym categories (birthday cake -> cake) before it
answers, and the merged class's posterior is exactly the sum of its members' probabilities.

`categories/folds.json` mirrors the aliases of `server/natures/quickdrawNatures.json`.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

DEFAULT_FOLD_MAP = Path(__file__).parent / "categories" / "folds.json"


def read_aliases(path: Path) -> dict[str, str]:
    aliases: object = json.loads(path.read_text())
    if not isinstance(aliases, dict) or not all(
        isinstance(alias, str) and isinstance(target, str) for alias, target in aliases.items()
    ):
        raise ValueError(f"{path.name} must map alias names to category names")
    chained = [alias for alias, target in aliases.items() if target in aliases]
    if chained:
        raise ValueError(f"aliases never chain: {', '.join(chained)}")
    return dict(aliases)


@dataclass(frozen=True, slots=True)
class FoldMap:
    """`groups[k]` is the folded class of label k; folded classes are numbered in label order."""

    groups: NDArray[np.int64]
    names: tuple[str, ...]

    @staticmethod
    def identity(labels: Sequence[str]) -> FoldMap:
        return FoldMap.of(labels, {})

    @staticmethod
    def of(labels: Sequence[str], aliases: Mapping[str, str]) -> FoldMap:
        """Aliases whose two ends are not both among `labels` are left unfolded."""
        known = set(labels)
        canonical = [aliases[label] if aliases.get(label) in known else label for label in labels]
        names = tuple(dict.fromkeys(canonical))
        position = {name: index for index, name in enumerate(names)}
        return FoldMap(np.asarray([position[name] for name in canonical], dtype=np.int64), names)

    @property
    def folded_count(self) -> int:
        return len(self.names)

    def fold_labels(self, labels: NDArray[np.int64]) -> NDArray[np.int64]:
        return np.asarray(self.groups[labels], dtype=np.int64)

    def fold_probabilities(self, probabilities: NDArray[np.float64]) -> NDArray[np.float64]:
        folded = np.zeros((len(probabilities), self.folded_count), dtype=np.float64)
        for label, group in enumerate(self.groups):
            folded[:, group] += probabilities[:, label]
        return folded
