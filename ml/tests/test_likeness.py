from __future__ import annotations

import numpy as np
import pytest

from likeness import DEFAULT_LIKENESS, outline, outline_costs
from pose import POSES, UPRIGHT, Pose

FLAG = [
    np.array([[0.0, 0.0], [0.0, 200.0]]),
    np.array([[0.0, 0.0], [90.0, 30.0], [0.0, 60.0]]),
]


def test_an_outline_is_centred_has_a_unit_diagonal_and_ignores_place_and_size() -> None:
    here = outline(FLAG, 48)
    there = outline([stroke * 3.5 + np.array([900.0, -40.0]) for stroke in FLAG], 48)
    assert here.shape == (48, 2) and here.dtype == np.float32
    assert np.allclose(here, there, atol=1e-5)
    extent = here.max(axis=0) - here.min(axis=0)
    assert float(np.hypot(*extent)) == pytest.approx(1.0, abs=0.02)
    assert np.allclose((here.max(axis=0) + here.min(axis=0)) / 2, 0.0, atol=0.01)


@pytest.mark.parametrize("pose", POSES)
def test_every_pose_of_a_lopsided_drawing_is_told_apart_and_recognised(pose: Pose) -> None:
    drawn = outline(pose.of(FLAG), 48)
    costs = outline_costs(drawn, outline(FLAG, 48)[None, :, :], DEFAULT_LIKENESS.coverage_weight)
    assert costs.shape == (len(POSES), 1)
    assert POSES[int(costs[:, 0].argmin())] == pose
    assert float(costs[:, 0].min()) < 0.01


def test_the_eight_poses_are_distinct_and_the_first_is_the_drawing_as_it_is() -> None:
    assert POSES[0] == UPRIGHT and UPRIGHT.of(FLAG) is FLAG
    assert len({pose.matrix.round(6).tobytes() for pose in POSES}) == 8
    for pose in POSES:
        assert np.allclose(pose.matrix @ pose.matrix.T, np.eye(2))


def test_a_pose_turns_a_drawing_about_the_centre_of_its_bounds() -> None:
    for pose in POSES:
        posed = np.concatenate(pose.of(FLAG))
        drawn = np.concatenate(FLAG)
        centre = (posed.max(axis=0) + posed.min(axis=0)) / 2
        assert np.allclose(centre, (drawn.max(axis=0) + drawn.min(axis=0)) / 2)


def test_turning_costs_more_than_mirroring_and_as_drawn_costs_nothing() -> None:
    assert DEFAULT_LIKENESS.pose_cost(UPRIGHT) == 0.0
    assert (
        0.0
        < DEFAULT_LIKENESS.pose_cost(Pose(mirrored=True))
        < DEFAULT_LIKENESS.pose_cost(Pose(quarter_turns=1))
    )
