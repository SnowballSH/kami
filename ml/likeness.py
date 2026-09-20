"""Which exemplar of a category is most like the player's drawing, and facing which way.

The model's embedding knows what kind of cat a sketch is, not which way it faces or how it is
proportioned, and an exemplar that faces the other way tidies a drawing into a mess. So likeness is
judged on the ink itself: every exemplar of the category, in each of the eight poses, is compared
with the drawing as a small cloud of points, and the closest few are fitted properly and compared
again. The embedding breaks ties. The rules are in CONTRACT.md, "Completion".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from exemplar_set import ExemplarSet
from morph import (
    DEFAULT_SETTINGS,
    MorphSettings,
    Points,
    fit_exemplar,
    has_extent,
    resample,
    unlikeness,
)
from pose import POSES, Pose

Outline = NDArray[np.float32]
OUTLINE_SPACING = 1.0 / 200.0


@dataclass(frozen=True, slots=True)
class LikenessSettings:
    """Costs are shares of the drawing's bounding-box diagonal."""

    outline_points: int = 48
    shortlist: int = 6
    coverage_weight: float = 0.5
    similarity_bonus: float = 0.03
    mirror_cost: float = 0.002
    turn_cost: float = 0.008

    def pose_cost(self, pose: Pose) -> float:
        turned = pose.quarter_turns % 4 != 0
        return self.mirror_cost * pose.mirrored + self.turn_cost * turned


DEFAULT_LIKENESS = LikenessSettings()


@dataclass(frozen=True, slots=True)
class Likeness:
    index: int
    similarity: float
    pose: Pose
    fitted: list[Points]
    unlikeness: float


def outline(strokes: list[Points], count: int) -> Outline:
    """`count` points spread evenly along the ink, centred on its bounds, its diagonal 1."""
    points = np.concatenate(strokes)
    low, high = points.min(axis=0), points.max(axis=0)
    diagonal = max(float(np.hypot(*(high - low))), 1e-9)
    dense = np.concatenate([resample(stroke, OUTLINE_SPACING * diagonal) for stroke in strokes])
    picks = np.linspace(0, len(dense) - 1, count).round().astype(np.intp)
    return ((dense[picks] - (low + high) / 2) / diagonal).astype(np.float32)


def outline_costs(
    player: Outline, exemplars: NDArray[np.float32], coverage_weight: float
) -> NDArray[np.float32]:
    """[pose, exemplar] -> how far the player's outline is from the exemplar's in that pose."""
    turns = np.stack([pose.matrix for pose in POSES]).astype(np.float32)
    posed = np.einsum("pde,cje->pcjd", turns, exemplars)
    squared = (
        (player**2).sum(axis=1)[None, None, :, None]
        + (exemplars**2).sum(axis=2)[None, :, None, :]
        - 2.0 * np.einsum("id,pcjd->pcij", player, posed)
    )
    apart = np.sqrt(np.maximum(squared, 0.0))
    on_exemplar = apart.min(axis=3).mean(axis=2)
    covered = apart.min(axis=2).mean(axis=2)
    costs: NDArray[np.float32] = on_exemplar + coverage_weight * covered
    return costs


class ExemplarMatcher:
    def __init__(
        self,
        exemplars: ExemplarSet,
        settings: LikenessSettings = DEFAULT_LIKENESS,
        morph_settings: MorphSettings = DEFAULT_SETTINGS,
    ) -> None:
        self._exemplars = exemplars
        self._settings = settings
        self._morph_settings = morph_settings
        self._outlines: dict[int, NDArray[np.float32]] = {}

    def most_alike(
        self, label: int, embedding: NDArray[np.float32], player: list[Points]
    ) -> Likeness | None:
        rows = self._exemplars.of_label(label)
        if len(rows) == 0:
            return None
        window = slice(rows.start, rows.stop)
        similarities = self._exemplars.embeddings[window].astype(np.float32) @ embedding
        settings = self._settings
        costs = outline_costs(
            outline(player, settings.outline_points),
            self._outlines_of(label, rows),
            settings.coverage_weight,
        )
        costs += np.array([settings.pose_cost(pose) for pose in POSES], dtype=np.float32)[:, None]
        costs -= settings.similarity_bonus * similarities[None, :]
        keep = min(settings.shortlist, costs.size)
        shortlisted = np.argpartition(costs, keep - 1, axis=None)[:keep]
        fitted = (
            self._fitted(rows.start + int(row), float(similarities[row]), POSES[pose], player)
            for pose, row in zip(*np.unravel_index(shortlisted, costs.shape), strict=True)
        )
        return min(
            (likeness for likeness in fitted if likeness is not None),
            key=lambda likeness: likeness.unlikeness,
            default=None,
        )

    def _strokes(self, index: int) -> list[Points]:
        return [
            stroke.astype(np.float64) for stroke in self._exemplars.strokes(index) if len(stroke)
        ]

    def _fitted(
        self, index: int, similarity: float, pose: Pose, player: list[Points]
    ) -> Likeness | None:
        strokes = self._strokes(index)
        if not has_extent(strokes):
            return None
        fitted = fit_exemplar(pose.of(strokes), player, self._morph_settings)
        settings = self._settings
        cost = (
            unlikeness(fitted, player, settings.coverage_weight, self._morph_settings)
            + settings.pose_cost(pose)
            - settings.similarity_bonus * similarity
        )
        return Likeness(index, similarity, pose, fitted, cost)

    def _outlines_of(self, label: int, rows: range) -> NDArray[np.float32]:
        known = self._outlines.get(label)
        if known is None:
            known = np.stack(
                [outline(self._strokes(index), self._settings.outline_points) for index in rows]
            )
            self._outlines[label] = known
        return known
