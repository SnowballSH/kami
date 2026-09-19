from __future__ import annotations

import numpy as np
import pytest
from numpy.typing import NDArray

from morph import MorphSettings, morph, resample

Points = NDArray[np.float64]
CENTRE = np.array([400.0, 300.0])
RADIUS = 100.0
DIAGONAL = float(np.hypot(2 * RADIUS, 2 * RADIUS))


def arc(start: float, end: float, count: int = 60, wobble: float = 0.0) -> Points:
    """An unsteady hand: the radius wanders slowly, as a shaky line does, not point by point."""
    angles = np.linspace(start, end, count)
    radii = RADIUS + wobble * (np.sin(5 * angles) + 0.6 * np.sin(9 * angles + 1.0))
    return CENTRE + np.column_stack([radii * np.cos(angles), radii * np.sin(angles)])


def unit_circle() -> list[Points]:
    angles = np.linspace(0.0, 2 * np.pi, 80)
    return [127.5 + 127.5 * np.column_stack([np.cos(angles), np.sin(angles)])]


def radial_error(stroke: Points) -> float:
    return float(np.abs(np.linalg.norm(stroke - CENTRE, axis=1) - RADIUS).mean())


def test_resample_keeps_the_ends_and_the_spacing() -> None:
    line = np.array([[0.0, 0.0], [10.0, 0.0]])
    dense = resample(line, 1.0)
    assert np.allclose(dense[0], line[0]) and np.allclose(dense[-1], line[-1])
    assert np.allclose(np.diff(dense[:, 0]), 1.0)
    assert len(resample(line[:1], 1.0)) == 1


def test_a_wobbly_circle_is_tidied_but_stays_the_players() -> None:
    player = [arc(0.0, 2 * np.pi, count=180, wobble=6.0)]
    result = morph(player, unit_circle())
    assert result is not None
    assert [len(stroke) for stroke in result.tidied] == [180]
    assert radial_error(result.tidied[0]) < 0.75 * radial_error(player[0])
    moved = np.linalg.norm(result.tidied[0] - player[0], axis=1)
    assert moved.max() <= DEFAULT.max_shift * DIAGONAL * 1.05 + 1e-9
    assert result.added == []


def test_half_a_circle_gets_a_whole_circle_of_the_right_size_around_it() -> None:
    from morph import fit_exemplar

    fitted = np.concatenate(fit_exemplar(unit_circle(), [arc(np.pi, 2 * np.pi)]))
    centre = (fitted.min(axis=0) + fitted.max(axis=0)) / 2
    radius = float((fitted.max(axis=0) - fitted.min(axis=0)).mean() / 2)
    assert abs(radius - RADIUS) < 0.15 * RADIUS
    assert float(np.linalg.norm(centre - CENTRE)) < 0.2 * RADIUS


def test_only_the_missing_half_is_added() -> None:
    player = [arc(np.pi, 2 * np.pi)]
    settings = MorphSettings(fit_scales=(1.0,), fit_offsets=(0.0,))
    exemplar = [
        127.5
        + 127.5 * np.column_stack([np.cos(a := np.linspace(0, 2 * np.pi, 80)), 0.5 * np.sin(a)])
    ]
    result = morph(player, exemplar, settings)
    assert result is not None and len(result.added) >= 1
    added = np.concatenate(result.added)
    player_cloud = player[0]
    gaps = np.linalg.norm(added[:, None, :] - player_cloud[None, :, :], axis=2).min(axis=1)
    assert gaps.min() > settings.cover_radius * float(np.hypot(2 * RADIUS, RADIUS)) * 0.9


def test_ink_the_exemplar_does_not_have_is_left_alone() -> None:
    flag = np.array([[700.0, 300.0], [760.0, 300.0], [760.0, 340.0]])
    player = [arc(0.0, 2 * np.pi, count=90, wobble=4.0), flag]
    settings = MorphSettings(fit_scales=(1.0,), fit_offsets=(0.0,))
    exemplar = [np.column_stack([u[:, 0] * (200 / 360), u[:, 1]]) for u in unit_circle()]
    result = morph(player, exemplar, settings)
    assert result is not None
    assert len(result.tidied) == 2 and result.tidied[1].shape == flag.shape


def test_strength_zero_changes_nothing() -> None:
    player = [arc(0.0, 2 * np.pi, wobble=5.0)]
    result = morph(player, unit_circle(), MorphSettings(strength=0.0))
    assert result is not None and np.allclose(result.tidied[0], player[0])


@pytest.mark.parametrize(
    "player",
    [[], [np.empty((0, 2))], [np.array([[5.0, 5.0]])], [np.array([[5.0, 5.0], [5.0, 5.0]])]],
)
def test_nothing_to_work_with_gives_no_answer(player: list[Points]) -> None:
    assert morph(player, unit_circle()) is None


def test_an_empty_exemplar_gives_no_answer() -> None:
    assert morph([arc(0.0, 1.0)], []) is None


DEFAULT = MorphSettings()
