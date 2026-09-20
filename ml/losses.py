"""The training objective: cross-entropy, optionally distilled from a teacher's reading of the
finished drawing, optionally pulling a prefix's embedding toward its own finished drawing's.

Why these two terms are the right ones for a prefix is argued in docs/reports/kami-eye-next.md.
"""

from __future__ import annotations

from dataclasses import dataclass

import torch.nn.functional as F
from torch import Tensor


@dataclass(frozen=True, slots=True)
class Distillation:
    alpha: float
    temperature: float

    def __post_init__(self) -> None:
        if not 0.0 <= self.alpha <= 1.0:
            raise ValueError("the distillation share must be in [0, 1]")
        if self.temperature <= 0:
            raise ValueError("the distillation temperature must be positive")


def distillation_loss(student_logits: Tensor, teacher_logits: Tensor, temperature: float) -> Tensor:
    """tau^2 KL(teacher / tau || student / tau), so its gradient scale does not depend on tau."""
    student = F.log_softmax(student_logits / temperature, dim=1)
    teacher = F.softmax(teacher_logits / temperature, dim=1)
    return F.kl_div(student, teacher, reduction="batchmean") * temperature**2


def alignment_loss(prefix_embedding: Tensor, finished_embedding: Tensor) -> Tensor:
    """1 - cos(prefix, stop-gradient(finished)) per pair: only the prefix is moved."""
    similarity = F.cosine_similarity(prefix_embedding, finished_embedding.detach(), dim=1)
    return (1.0 - similarity).mean()


@dataclass(frozen=True, slots=True)
class Objective:
    label_smoothing: float
    distillation: Distillation | None = None
    embed_align: float = 0.0

    def __call__(
        self,
        logits: Tensor,
        embedding: Tensor,
        labels: Tensor,
        teacher_logits: Tensor | None,
        paired: bool,
    ) -> Tensor:
        logits = logits.float()
        loss = F.cross_entropy(logits, labels, label_smoothing=self.label_smoothing)
        if self.distillation is not None:
            if teacher_logits is None:
                raise ValueError("distillation needs the teacher's logits in every batch")
            taught = distillation_loss(logits, teacher_logits, self.distillation.temperature)
            loss = (1.0 - self.distillation.alpha) * loss + self.distillation.alpha * taught
        if self.embed_align > 0:
            if not paired:
                raise ValueError("embedding alignment needs paired batches")
            finished, prefix = embedding.float().chunk(2)
            loss = loss + self.embed_align * alignment_loss(prefix, finished)
        return loss
