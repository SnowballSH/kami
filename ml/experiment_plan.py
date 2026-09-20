"""What the overnight queue trains and how it decides: recipes as flags, the arms' results, and the
decision rules of docs/reports/kami-eye-next.md (5). Pure: nothing here starts a process.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path

EARLY_VIEW_WEIGHTS = ".40,.28,.22,.10"
KD_ALPHA = "0.7"
KD_TEMPERATURE = "2"
EMBED_ALIGN = "0.5"
DEEP_STEM_ARCH = "resnet18d"
TEACHER_ARCH = "resnet34"

SUGGESTIVE_GAIN = 0.5
ACCEPTED_GAIN = 1.0
CONTROL_SPREAD_LIMIT = 0.5
FINISHED_LOSS_BEYOND_NOISE = 0.003
ECE_VETO = 0.01
RECALL_VETO = 0.02
ALIGNMENT_RECALL_GAIN = 0.01
MAX_LATENCY_RATIO = 1.25
FAST_MIN_SPEEDUP = 1.10
FAST_MAX_LOSS_GAP = 0.1

LONG_RUN_SECONDS = 12_600
LONG_RUN_USABLE_SHARE = 0.93
MIN_LONG_EPOCHS = 8
MAX_LONG_EPOCHS = 16
TEACHER_SPEED_SHARE = 0.5
MIN_TEACHER_EPOCHS = 4


class Views(StrEnum):
    LEGACY = "fixed-legacy"
    EARLY = "resample-early"
    RESAMPLE_LEGACY = "resample-legacy"


_VIEW_LETTER = {Views.LEGACY: "B", Views.EARLY: "V", Views.RESAMPLE_LEGACY: "R"}
_VIEW_FLAGS: Mapping[Views, tuple[str, ...]] = {
    Views.LEGACY: ("--view-policy", "fixed"),
    Views.EARLY: ("--view-policy", "resample", "--view-weights", EARLY_VIEW_WEIGHTS),
    Views.RESAMPLE_LEGACY: ("--view-policy", "resample"),
}


@dataclass(frozen=True, slots=True)
class Recipe:
    """The accepted components of a run; the default is today's recipe on the 4-view dataset."""

    views: Views = Views.LEGACY
    distilled: bool = False
    deep_stem: bool = False
    aligned: bool = False

    @property
    def label(self) -> str:
        parts = [_VIEW_LETTER[self.views]]
        parts += ["K"] if self.distilled else []
        parts += ["D"] if self.deep_stem else []
        parts += ["A"] if self.aligned else []
        return "+".join(parts)

    @property
    def slug(self) -> str:
        return self.label.replace("+", "").lower()

    def flags(self, teacher_logits: Path | None) -> list[str]:
        flags = list(_VIEW_FLAGS[self.views])
        if self.deep_stem:
            flags += ["--arch", DEEP_STEM_ARCH]
        if self.distilled:
            if teacher_logits is None:
                raise ValueError(f"{self.label} distils, so it needs a teacher's logits")
            flags += ["--teacher-logits", str(teacher_logits)]
            flags += ["--kd-alpha", KD_ALPHA, "--kd-temperature", KD_TEMPERATURE]
            flags += ["--label-smoothing", "0"]
        if self.aligned:
            flags += ["--embed-align", EMBED_ALIGN]
        return flags


@dataclass(frozen=True, slots=True)
class Scale:
    """Sizes and names of one night's queue; `smoke` proves every path in a minute of GPU."""

    prefix: str
    categories: tuple[str, ...]
    arm_samples: int
    arm_epochs: int
    arm_dataset: str
    long_samples: int
    long_dataset: str
    long_name: str
    fallback_name: str
    batch_size: int
    readers: int
    render_workers: int
    probe_steps: int
    reference_model: str | None
    long_teacher_model: str | None
    fixed_long_epochs: int | None

    @staticmethod
    def tonight() -> Scale:
        return Scale(
            prefix="abl-",
            categories=("--all",),
            arm_samples=3_000,
            arm_epochs=4,
            arm_dataset="abl-3k-v4",
            long_samples=22_000,
            long_dataset="eye-next-22k-v4",
            long_name="kami-eye-next",
            fallback_name="eye-teacher-r34",
            batch_size=1024,
            readers=4,
            render_workers=8,
            probe_steps=100,
            reference_model="kami-eye-xl",
            long_teacher_model="kami-eye-xl",
            fixed_long_epochs=None,
        )

    @staticmethod
    def smoke() -> Scale:
        return Scale(
            prefix="smoke-",
            categories=("--categories", "categories/smoke.txt"),
            arm_samples=300,
            arm_epochs=1,
            arm_dataset="smoke-abl-v4",
            long_samples=600,
            long_dataset="smoke-long-v4",
            long_name="smoke-next",
            fallback_name="smoke-teacher-r34",
            batch_size=128,
            readers=2,
            render_workers=2,
            probe_steps=6,
            reference_model=None,
            long_teacher_model=None,
            fixed_long_epochs=1,
        )

    def arm_name(self, recipe: Recipe, seed: int) -> str:
        return f"{self.prefix}{recipe.slug}-s{seed}"

    def _train_flags(self, samples: int, epochs: int, dataset: str) -> list[str]:
        return [
            *self.categories,
            *("--samples-per-class", str(samples)),
            *("--epochs", str(epochs)),
            *("--batch-size", str(self.batch_size)),
            *("--views", "4"),
            *("--dataset-name", dataset),
            *("--dataset-seed", "0"),
            *("--readers", str(self.readers)),
        ]

    def arm_flags(self, recipe: Recipe, seed: int, teacher_logits: Path | None) -> list[str]:
        return [
            *self._train_flags(self.arm_samples, self.arm_epochs, self.arm_dataset),
            *("--seed", str(seed)),
            *("--name", self.arm_name(recipe, seed)),
            *recipe.flags(teacher_logits),
        ]

    def long_flags(self, name: str, epochs: int, extra: Sequence[str]) -> list[str]:
        return [
            *self._train_flags(self.long_samples, epochs, self.long_dataset),
            *("--seed", "0"),
            *("--name", name),
            *extra,
        ]

    def dataset_only_flags(self, samples: int, dataset: str) -> list[str]:
        return [
            *self._train_flags(samples, 1, dataset),
            *("--name", dataset),
            "--dataset-only",
            *("--render-workers", str(self.render_workers)),
        ]


@dataclass(frozen=True, slots=True)
class ArmResult:
    name: str
    recipe: Recipe
    seed: int
    score: float
    top1_finished: float
    top3_early: float
    ece_partial: float
    recall_at_10: float | None
    images_per_second: float
    latency_ratio: float | None

    @property
    def within_latency(self) -> bool:
        return self.latency_ratio is None or self.latency_ratio <= MAX_LATENCY_RATIO


@dataclass(frozen=True, slots=True)
class Thresholds:
    suggestive: float
    accepted: float

    @staticmethod
    def from_controls(scores: Sequence[float]) -> Thresholds:
        """Seed noise decides the bar: controls more than 0.5 apart double it."""
        spread = max(scores) - min(scores) if len(scores) > 1 else 0.0
        factor = 2.0 if spread > CONTROL_SPREAD_LIMIT else 1.0
        return Thresholds(SUGGESTIVE_GAIN * factor, ACCEPTED_GAIN * factor)


@dataclass(frozen=True, slots=True)
class Control:
    """The control arms (today's recipe, one per seed) everything is measured against."""

    arms: tuple[ArmResult, ...]

    @property
    def score(self) -> float:
        return sum(arm.score for arm in self.arms) / len(self.arms)

    @property
    def first(self) -> ArmResult:
        return self.arms[0]

    @property
    def thresholds(self) -> Thresholds:
        return Thresholds.from_controls([arm.score for arm in self.arms])

    @property
    def worst_ece_partial(self) -> float:
        """Guard-rails compare with the worse control seed, so seed noise alone never vetoes."""
        return max(arm.ece_partial for arm in self.arms)

    @property
    def worst_recall_at_10(self) -> float | None:
        recalls = [arm.recall_at_10 for arm in self.arms if arm.recall_at_10 is not None]
        return min(recalls) if recalls else None


def vetoed(arm: ArmResult, control: Control) -> str | None:
    """Why an arm cannot win whatever its score: the hard constraint and the two guard-rails."""
    if not math.isfinite(arm.score):
        return "no score"
    if not arm.within_latency:
        return f"latency {arm.latency_ratio:.2f}x the live model's (bound {MAX_LATENCY_RATIO}x)"
    if arm.ece_partial - control.worst_ece_partial > ECE_VETO:
        return (
            f"partial ECE {arm.ece_partial:.1%}, the control's is {control.worst_ece_partial:.1%}"
        )
    recall, control_recall = arm.recall_at_10, control.worst_recall_at_10
    if recall is not None and control_recall is not None and control_recall - recall > RECALL_VETO:
        return f"own-drawing recall@10 {recall:.1%} against the control's {control_recall:.1%}"
    return None


def wins_early_but_loses_finished(arm: ArmResult, control: Control) -> bool:
    early_gain = arm.top3_early - control.first.top3_early
    finished_loss = control.first.top1_finished - arm.top1_finished
    return early_gain > 0 and finished_loss > FINISHED_LOSS_BEYOND_NOISE


def base_views(view_arms: Sequence[ArmResult], control: Control) -> Views:
    """The views the later arms are built on: the best view arm unless it is clearly harmful."""
    eligible = [arm for arm in view_arms if vetoed(arm, control) is None]
    if not eligible:
        return Views.LEGACY
    best = max(eligible, key=lambda arm: arm.score)
    harmful = best.score < control.score - control.thresholds.suggestive
    return Views.LEGACY if harmful else best.recipe.views


def best_candidate(candidates: Sequence[ArmResult], control: Control) -> ArmResult | None:
    """The highest-scoring arm that is not vetoed and beats the control by more than noise."""
    eligible = [
        arm
        for arm in candidates
        if vetoed(arm, control) is None
        and arm.score - control.score >= control.thresholds.suggestive
    ]
    return max(eligible, key=lambda arm: arm.score) if eligible else None


def accepts_alignment(aligned: ArmResult, base: ArmResult, control: Control) -> bool:
    """Alignment serves completion: it must raise own-drawing recall and not cost the score."""
    if vetoed(aligned, control) is not None:
        return False
    if aligned.recall_at_10 is None or base.recall_at_10 is None:
        return False
    recall_gain = aligned.recall_at_10 - base.recall_at_10
    score_kept = aligned.score >= base.score - control.thresholds.suggestive
    return recall_gain >= ALIGNMENT_RECALL_GAIN and score_kept


class Verdict(StrEnum):
    ACCEPTED = "accepted"
    REPLICATED = "suggestive, and the second seed agrees in sign"
    NOT_REPLICATED = "suggestive, but the second seed does not agree"
    NOISE = "within noise of the control"


def verdict(winner: ArmResult, replication: ArmResult | None, control: Control) -> Verdict:
    runs = [winner, *([replication] if replication is not None else [])]
    gain = sum(run.score for run in runs) / len(runs) - control.score
    thresholds = control.thresholds
    if gain >= thresholds.accepted:
        return Verdict.ACCEPTED
    if gain < thresholds.suggestive:
        return Verdict.NOISE
    agrees = replication is not None and replication.score > control.score
    return Verdict.REPLICATED if agrees else Verdict.NOT_REPLICATED


def clears_the_bar(decision: Verdict) -> bool:
    return decision in (Verdict.ACCEPTED, Verdict.REPLICATED)


def long_run_epochs(images_per_second: float, train_drawings: int) -> int:
    """E = floor(0.93 x 12,600 s x R / train drawings), kept within a sane range."""
    budget = LONG_RUN_USABLE_SHARE * LONG_RUN_SECONDS * images_per_second
    return max(MIN_LONG_EPOCHS, min(MAX_LONG_EPOCHS, int(budget // max(train_drawings, 1))))


def teacher_run_epochs(control_images_per_second: float, train_drawings: int) -> int:
    budget = LONG_RUN_USABLE_SHARE * LONG_RUN_SECONDS * control_images_per_second
    epochs = int(budget * TEACHER_SPEED_SHARE // max(train_drawings, 1))
    return max(MIN_TEACHER_EPOCHS, min(MAX_LONG_EPOCHS, epochs))


def teacher_flags() -> list[str]:
    return [*_VIEW_FLAGS[Views.LEGACY], "--arch", TEACHER_ARCH]


@dataclass(frozen=True, slots=True)
class ProbeResult:
    compiled: bool
    images_per_second: float
    loss: float


def fast_flags_pay(eager: ProbeResult, fast: ProbeResult) -> bool:
    """The speed flags are taken as measured: where torch.compile falls back to eager (as in the
    probe, so in the long run) bf16 and the fused optimiser still have to earn their place."""
    speedup = fast.images_per_second / eager.images_per_second
    parity = abs(fast.loss - eager.loss) <= FAST_MAX_LOSS_GAP
    return speedup >= FAST_MIN_SPEEDUP and parity


FAST_FLAGS = ("--compile", "--amp-dtype", "bfloat16", "--fused-optimizer")


def with_alignment(recipe: Recipe) -> Recipe:
    return replace(recipe, aligned=True)
