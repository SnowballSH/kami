import numpy as np
import pytest

from selective import coverage_at_precision, expected_calibration_error


def test_ece_is_zero_when_confidence_is_accuracy_and_the_gap_otherwise() -> None:
    rng = np.random.default_rng(0)
    confidence = rng.uniform(0.05, 1.0, 200_000)
    honest = rng.random(200_000) < confidence
    assert expected_calibration_error(confidence, honest) < 0.01
    overconfident = rng.random(200_000) < confidence - 0.05
    assert expected_calibration_error(confidence, overconfident) == pytest.approx(0.05, abs=0.01)
    assert np.isnan(expected_calibration_error(np.zeros(0), np.zeros(0, dtype=np.bool_)))


def test_coverage_is_the_largest_prefix_of_the_ranking_at_the_precision() -> None:
    confidence = np.linspace(1.0, 0.01, 100)
    correct = np.ones(100, dtype=np.bool_)
    correct[[50, 60, 70, 80, 85, 90, 95]] = False
    precise_enough = [named for named in range(1, 101) if correct[:named].mean() >= 0.95]
    assert max(precise_enough) == 85

    point = coverage_at_precision(confidence, correct, precision=0.95)
    assert point.coverage == pytest.approx(0.85)
    assert point.floor is not None and point.floor == pytest.approx(confidence[84])
    assert correct[confidence >= point.floor].mean() >= 0.95


def test_a_tie_in_confidence_is_named_whole_or_not_at_all() -> None:
    confidence = np.asarray([0.9] * 10 + [0.5] * 10)
    correct = np.asarray([True] * 10 + [True] * 9 + [False])
    assert coverage_at_precision(confidence, correct, precision=0.96).coverage == pytest.approx(0.5)
    assert coverage_at_precision(confidence, correct, precision=0.95).coverage == pytest.approx(1.0)


def test_no_floor_when_nothing_worthwhile_is_that_precise() -> None:
    confidence = np.linspace(1.0, 0.0, 1000)
    wrong_at_the_top = np.ones(1000, dtype=np.bool_)
    wrong_at_the_top[::2] = False
    point = coverage_at_precision(confidence, wrong_at_the_top)
    assert point.floor is None and point.coverage == 0.0
    assert coverage_at_precision(np.zeros(0), np.zeros(0, dtype=np.bool_)).floor is None
