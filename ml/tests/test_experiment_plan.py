from dataclasses import replace
from pathlib import Path

import pytest

from experiment_plan import (
    ArmResult,
    Control,
    ProbeResult,
    Recipe,
    Scale,
    Thresholds,
    Verdict,
    Views,
    accepts_alignment,
    base_views,
    best_candidate,
    clears_the_bar,
    fast_flags_pay,
    long_run_epochs,
    teacher_run_epochs,
    verdict,
    vetoed,
    wins_early_but_loses_finished,
)

TEACHER = Path("/data/teachers/peer.npy")


TODAY = Recipe()


def arm(recipe: Recipe = TODAY, score: float = 60.0, seed: int = 0, **changes: object) -> ArmResult:
    result = ArmResult(
        name=f"abl-{recipe.slug}-s{seed}",
        recipe=recipe,
        seed=seed,
        score=score,
        top1_finished=0.75,
        top3_early=0.50,
        ece_partial=0.03,
        recall_at_10=0.40,
        images_per_second=7000.0,
        latency_ratio=1.0,
    )
    return replace(result, **changes)  # type: ignore[arg-type]


CONTROL = Control((arm(score=60.0), arm(score=60.2, seed=1)))


def test_recipes_name_themselves_and_spell_their_flags() -> None:
    assert Recipe().label == "B" and Recipe().flags(None) == ["--view-policy", "fixed"]
    full = Recipe(Views.EARLY, distilled=True, deep_stem=True, aligned=True)
    assert full.label == "V+K+D+A" and full.slug == "vkda"
    assert full.flags(TEACHER) == [
        *("--view-policy", "resample", "--view-weights", ".40,.28,.22,.10"),
        *("--arch", "resnet18d"),
        *("--teacher-logits", str(TEACHER), "--kd-alpha", "0.7", "--kd-temperature", "2"),
        *("--label-smoothing", "0"),
        *("--embed-align", "0.5"),
    ]
    with pytest.raises(ValueError):
        full.flags(None)


def test_every_arm_shares_one_dataset_whatever_its_seed() -> None:
    scale = Scale.tonight()
    flags = scale.arm_flags(Recipe(Views.EARLY), 1, None)
    assert flags[:1] == ["--all"]
    joined = " ".join(flags)
    assert "--samples-per-class 3000 --epochs 4 --batch-size 1024 --views 4" in joined
    assert "--dataset-name abl-3k-v4 --dataset-seed 0" in joined
    assert "--seed 1 --name abl-v-s1" in joined
    assert not any(name.startswith("kami-eye") for name in (scale.arm_dataset, scale.long_dataset))
    long = " ".join(scale.long_flags(scale.long_name, 12, ["--view-policy", "fixed"]))
    assert "--samples-per-class 22000 --epochs 12" in long and "--name kami-eye-next" in long
    assert "--dataset-name eye-next-22k-v4" in long
    only = scale.dataset_only_flags(scale.long_samples, scale.long_dataset)
    assert "--dataset-only" in only and only[only.index("--render-workers") + 1] == "8"


def test_the_bar_doubles_when_the_control_seeds_disagree() -> None:
    assert Thresholds.from_controls([60.0, 60.4]) == Thresholds(0.5, 1.0)
    assert Thresholds.from_controls([60.0, 60.6]) == Thresholds(1.0, 2.0)
    assert Thresholds.from_controls([60.0]) == Thresholds(0.5, 1.0)
    assert CONTROL.score == pytest.approx(60.1)


def test_the_hard_constraint_and_the_guard_rails_veto_whatever_the_score() -> None:
    assert vetoed(arm(score=70.0), CONTROL) is None
    assert "latency" in str(vetoed(arm(score=70.0, latency_ratio=1.3), CONTROL))
    assert "ECE" in str(vetoed(arm(score=70.0, ece_partial=0.05), CONTROL))
    assert "recall" in str(vetoed(arm(score=70.0, recall_at_10=0.37), CONTROL))
    assert vetoed(arm(score=float("nan")), CONTROL) == "no score"
    assert vetoed(arm(score=70.0, latency_ratio=None, recall_at_10=None), CONTROL) is None
    noisy = Control((arm(), arm(seed=1, ece_partial=0.045, recall_at_10=0.36)))
    assert vetoed(arm(score=70.0, ece_partial=0.05, recall_at_10=0.35), noisy) is None


def test_the_best_candidate_must_beat_the_control_by_more_than_noise() -> None:
    noise = arm(Recipe(Views.EARLY), 60.5)
    good = arm(Recipe(Views.EARLY, distilled=True), 61.0)
    better_but_slow = arm(Recipe(Views.EARLY, deep_stem=True), 63.0, latency_ratio=1.4)
    assert best_candidate([noise], CONTROL) is None
    assert best_candidate([noise, good, better_but_slow], CONTROL) == good
    assert best_candidate([], CONTROL) is None


def test_later_arms_build_on_the_new_views_unless_they_clearly_hurt() -> None:
    assert base_views([arm(Recipe(Views.EARLY), 60.0)], CONTROL) is Views.EARLY
    assert base_views([arm(Recipe(Views.EARLY), 59.0)], CONTROL) is Views.LEGACY
    assert base_views([], CONTROL) is Views.LEGACY
    both = [arm(Recipe(Views.EARLY), 60.3), arm(Recipe(Views.RESAMPLE_LEGACY), 60.9)]
    assert base_views(both, CONTROL) is Views.RESAMPLE_LEGACY


def test_winning_early_but_losing_finished_is_noticed() -> None:
    early_win = arm(Recipe(Views.EARLY), top3_early=0.53, top1_finished=0.74)
    assert wins_early_but_loses_finished(early_win, CONTROL)
    assert not wins_early_but_loses_finished(replace(early_win, top1_finished=0.749), CONTROL)
    assert not wins_early_but_loses_finished(replace(early_win, top3_early=0.49), CONTROL)


def test_alignment_is_judged_by_recall_without_costing_the_score() -> None:
    base = arm(Recipe(Views.EARLY), 61.5)
    assert accepts_alignment(arm(base.recipe, 61.3, recall_at_10=0.46), base, CONTROL)
    assert not accepts_alignment(arm(base.recipe, 61.3, recall_at_10=0.405), base, CONTROL)
    assert not accepts_alignment(arm(base.recipe, 60.8, recall_at_10=0.46), base, CONTROL)
    assert not accepts_alignment(arm(base.recipe, 61.3, recall_at_10=None), base, CONTROL)


def test_verdicts_follow_the_designers_rule() -> None:
    recipe = Recipe(Views.EARLY)
    assert verdict(arm(recipe, 61.4), arm(recipe, 61.0, seed=1), CONTROL) is Verdict.ACCEPTED
    assert verdict(arm(recipe, 60.9), arm(recipe, 60.5, seed=1), CONTROL) is Verdict.REPLICATED
    assert verdict(arm(recipe, 61.4), arm(recipe, 59.9, seed=1), CONTROL) is Verdict.NOT_REPLICATED
    assert verdict(arm(recipe, 60.9), None, CONTROL) is Verdict.NOT_REPLICATED
    assert verdict(arm(recipe, 60.3), arm(recipe, 60.4, seed=1), CONTROL) is Verdict.NOISE
    assert clears_the_bar(Verdict.ACCEPTED) and clears_the_bar(Verdict.REPLICATED)
    assert not clears_the_bar(Verdict.NOT_REPLICATED) and not clears_the_bar(Verdict.NOISE)


def test_long_run_epochs_follow_the_measured_speed() -> None:
    assert long_run_epochs(7000, 6_830_000) == 12
    assert long_run_epochs(8400, 6_830_000) == 14
    assert long_run_epochs(1000, 6_830_000) == 8
    assert long_run_epochs(50_000, 6_830_000) == 16
    assert teacher_run_epochs(7000, 6_830_000) == 6


def test_the_speed_flags_must_be_faster_and_agree_on_the_loss() -> None:
    eager = ProbeResult(False, 7000.0, 3.20)
    assert fast_flags_pay(eager, ProbeResult(True, 8400.0, 3.22))
    assert fast_flags_pay(eager, ProbeResult(False, 7800.0, 3.22))
    assert not fast_flags_pay(eager, ProbeResult(True, 7400.0, 3.22))
    assert not fast_flags_pay(eager, ProbeResult(True, 8400.0, 3.50))
