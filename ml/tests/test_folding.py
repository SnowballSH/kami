import json
from pathlib import Path

import numpy as np
import pytest

from folding import DEFAULT_FOLD_MAP, FoldMap, read_aliases

LABELS = ("cake", "bus", "birthday cake", "cat", "school bus")
ALIASES = {"birthday cake": "cake", "school bus": "bus", "mug": "cup"}
NATURES = Path(__file__).parents[2] / "server" / "natures" / "quickdrawNatures.json"
ALL_CATEGORIES = Path(__file__).parent.parent / "categories" / "all.txt"


def test_folding_sums_the_members_of_a_group() -> None:
    fold_map = FoldMap.of(LABELS, ALIASES)
    assert fold_map.names == ("cake", "bus", "cat")
    probabilities = np.asarray([[0.50, 0.01, 0.45, 0.03, 0.01], [0.1, 0.2, 0.3, 0.15, 0.25]])
    folded = fold_map.fold_probabilities(probabilities)
    assert folded == pytest.approx(np.asarray([[0.95, 0.02, 0.03], [0.4, 0.45, 0.15]]))
    assert folded.sum(axis=1) == pytest.approx([1.0, 1.0])
    labels = np.asarray([2, 4, 3, 0], dtype=np.int64)
    assert fold_map.fold_labels(labels).tolist() == [0, 1, 2, 0]


def test_an_alias_without_both_ends_among_the_labels_is_left_alone() -> None:
    fold_map = FoldMap.of(("birthday cake", "mug", "cup"), {"birthday cake": "cake", "mug": "cup"})
    assert fold_map.names == ("birthday cake", "cup")
    assert fold_map.groups.tolist() == [0, 1, 1]


def test_identity_folds_nothing() -> None:
    fold_map = FoldMap.identity(LABELS)
    assert fold_map.names == LABELS
    probabilities = np.full((3, len(LABELS)), 0.2)
    assert np.array_equal(fold_map.fold_probabilities(probabilities), probabilities)


def test_chained_or_malformed_aliases_are_refused(tmp_path: Path) -> None:
    chained = tmp_path / "chained.json"
    chained.write_text(json.dumps({"a": "b", "b": "c"}))
    with pytest.raises(ValueError):
        read_aliases(chained)
    malformed = tmp_path / "malformed.json"
    malformed.write_text(json.dumps(["cake"]))
    with pytest.raises(ValueError):
        read_aliases(malformed)


def test_the_shipped_fold_map_names_real_categories() -> None:
    known = set(ALL_CATEGORIES.read_text().splitlines())
    aliases = read_aliases(DEFAULT_FOLD_MAP)
    assert aliases
    assert set(aliases) | set(aliases.values()) <= known


@pytest.mark.skipif(not NATURES.exists(), reason="server/natures is not beside this copy of ml/")
def test_the_shipped_fold_map_is_the_games_alias_table() -> None:
    natures = json.loads(NATURES.read_text())
    game_aliases = {
        category: entry["alias"] for category, entry in natures.items() if "alias" in entry
    }
    assert read_aliases(DEFAULT_FOLD_MAP) == game_aliases
