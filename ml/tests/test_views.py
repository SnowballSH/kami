import numpy as np
import pytest

from views import (
    FINISHED_VIEW,
    LEGACY_VIEW_WEIGHTS,
    ViewPlan,
    ViewPolicy,
    ViewSampler,
    parse_view_weights,
)

DRAWINGS = 20_000
INDICES = np.arange(DRAWINGS, dtype=np.int64)
EARLY_WEIGHTS = (0.40, 0.28, 0.22, 0.10)


def test_legacy_weights_are_the_mixture_of_the_first_recipe() -> None:
    """Half finished; the other half uniform over 30-100 %, cut at 50 and 70 %."""
    assert sum(LEGACY_VIEW_WEIGHTS) == pytest.approx(1.0)
    assert pytest.approx(0.5 * 0.2 / 0.7) == LEGACY_VIEW_WEIGHTS[1]
    assert pytest.approx(0.5 * 0.3 / 0.7) == LEGACY_VIEW_WEIGHTS[3]


def test_weights_parse_and_are_validated() -> None:
    assert parse_view_weights(".40,.28,.22,.10") == EARLY_WEIGHTS
    with pytest.raises(ValueError):
        ViewPlan((0.5, 0.5))
    with pytest.raises(ValueError):
        ViewPlan((0.0, 0.0, 0.0, 0.0))
    with pytest.raises(ValueError):
        ViewPlan((1.0, -1.0, 1.0, 1.0))


def test_a_single_view_is_always_the_first() -> None:
    sampler = ViewSampler(ViewPlan(), DRAWINGS, seed=0)
    assert not sampler.views(INDICES).any()
    with pytest.raises(ValueError):
        sampler.prefix_views(INDICES)


def test_a_fixed_plan_repeats_and_a_resampled_one_does_not() -> None:
    fixed = ViewSampler(ViewPlan(EARLY_WEIGHTS, ViewPolicy.FIXED), DRAWINGS, seed=0)
    assert np.array_equal(fixed.views(INDICES), fixed.views(INDICES))
    assert np.array_equal(fixed.views(INDICES[::2]), fixed.views(INDICES)[::2])

    fresh = ViewSampler(ViewPlan(EARLY_WEIGHTS, ViewPolicy.RESAMPLE), DRAWINGS, seed=0)
    assert not np.array_equal(fresh.views(INDICES), fresh.views(INDICES))


def test_views_follow_the_weights_and_the_seed() -> None:
    plan = ViewPlan(EARLY_WEIGHTS, ViewPolicy.RESAMPLE)
    shares = np.bincount(ViewSampler(plan, DRAWINGS, seed=0).views(INDICES)) / DRAWINGS
    assert shares == pytest.approx(EARLY_WEIGHTS, abs=0.015)
    again = ViewSampler(plan, DRAWINGS, seed=0).views(INDICES)
    assert np.array_equal(again, ViewSampler(plan, DRAWINGS, seed=0).views(INDICES))
    assert not np.array_equal(again, ViewSampler(plan, DRAWINGS, seed=1).views(INDICES))


def test_prefix_views_are_never_the_finished_one_and_keep_their_relative_weights() -> None:
    sampler = ViewSampler(ViewPlan(EARLY_WEIGHTS, ViewPolicy.RESAMPLE), DRAWINGS, seed=0)
    prefixes = sampler.prefix_views(INDICES)
    assert prefixes.min() > FINISHED_VIEW
    shares = np.bincount(prefixes, minlength=4)[1:] / DRAWINGS
    assert shares == pytest.approx(
        np.asarray(EARLY_WEIGHTS[1:]) / sum(EARLY_WEIGHTS[1:]), abs=0.015
    )
