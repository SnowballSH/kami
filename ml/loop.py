"""The optimisation loop: AdamW + OneCycle, AMP on CUDA, the objective of losses.py, affine
augmentation. Every option defaults to the first recipe (single view, label smoothing, eager fp16).
"""

from __future__ import annotations

import copy
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import cast

import numpy as np
import torch
from numpy.typing import NDArray
from torch import nn
from tqdm import tqdm

from augment import random_affine
from batches import (
    Batch,
    PairedEpochs,
    Rows,
    iterate_batches,
    paired_rows,
    sequential_rows,
    shuffled_rows,
)
from dataset import FULL_FRACTION, SketchDataset, Split
from losses import Distillation, Objective
from metrics import accuracy
from model import SketchNet
from render import SIZE
from teacher import TeacherLogits
from views import FINISHED_VIEW, ViewPlan, ViewSampler

LABEL_SMOOTHING = 0.1
WEIGHT_DECAY = 0.02
WARM_UP_SHARE = 0.15
PROGRESS_VALIDATION_DRAWINGS = 60_000


class AmpDtype(StrEnum):
    FLOAT16 = "float16"
    BFLOAT16 = "bfloat16"

    @property
    def torch_dtype(self) -> torch.dtype:
        return torch.float16 if self is AmpDtype.FLOAT16 else torch.bfloat16


@dataclass(frozen=True, slots=True)
class FitConfig:
    epochs: int
    batch_size: int
    max_learning_rate: float
    seed: int
    label_smoothing: float = LABEL_SMOOTHING
    view_plan: ViewPlan = field(default_factory=ViewPlan)
    distillation: Distillation | None = None
    embed_align: float = 0.0
    compile: bool = False
    amp_dtype: AmpDtype = AmpDtype.FLOAT16
    fused_optimizer: bool = False
    readers: int = 1

    @property
    def paired(self) -> bool:
        return self.embed_align > 0


@dataclass(frozen=True, slots=True)
class EpochRecord:
    epoch: int
    loss: float
    val_top1: float
    val_top3: float
    val_finished_top1: float
    images_per_second: float


@dataclass(frozen=True, slots=True)
class FitResult:
    images_per_second: float
    seconds_training: float
    compiled: bool
    history: tuple[EpochRecord, ...]


@dataclass(frozen=True, slots=True)
class Predictions:
    logits: NDArray[np.float32]
    embeddings: NDArray[np.float16] | None


def pick_device(name: str) -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")


@torch.inference_mode()
def predict(
    model: SketchNet,
    dataset: SketchDataset,
    indices: NDArray[np.int64],
    batch_size: int,
    device: torch.device,
    view: int = FINISHED_VIEW,
    *,
    with_embeddings: bool = False,
    readers: int = 1,
    half_precision: bool = False,
) -> Predictions:
    """Logits (and embeddings) of one view of `indices`, in the order given (must be ascending).

    `half_precision` reads under CUDA autocast: about twice as fast, for bulk passes such as a
    teacher's, where the last decimal of a logit does not matter."""
    model.eval()
    logits: list[NDArray[np.float32]] = []
    embeddings: list[NDArray[np.float16]] = []
    rows = sequential_rows(indices, view, batch_size)
    autocast = torch.autocast(
        device_type=device.type, enabled=half_precision and device.type == "cuda"
    )
    with iterate_batches(dataset, rows, device, readers=readers) as batches, autocast:
        for batch in batches:
            batch_logits, batch_embeddings = model(batch.images)
            logits.append(batch_logits.float().cpu().numpy())
            if with_embeddings:
                embeddings.append(batch_embeddings.half().cpu().numpy())
    return Predictions(
        np.concatenate(logits).astype(np.float32),
        np.concatenate(embeddings) if with_embeddings else None,
    )


def _compiled_or_eager(
    model: SketchNet, config: FitConfig, device: torch.device, use_amp: bool
) -> nn.Module:
    """torch.compile fails lazily, at the first call: rehearse one training step on zeros, put the
    weights and BatchNorm statistics back, and stay eager when the rehearsal fails."""
    before = copy.deepcopy(model.state_dict())
    try:
        compiled = cast(nn.Module, torch.compile(model))
        sample = torch.zeros(config.batch_size, 1, SIZE, SIZE, device=device)
        model.train()
        with torch.autocast(
            device_type=device.type, dtype=config.amp_dtype.torch_dtype, enabled=use_amp
        ):
            logits, embedding = compiled(sample)
            rehearsal = logits.float().sum() + embedding.float().sum()
        rehearsal.backward()
        return compiled
    except Exception as error:
        print(f"torch.compile is not usable here ({type(error).__name__}: {error}); eager instead")
        torch._dynamo.reset()
        return model
    finally:
        model.load_state_dict(before)
        model.zero_grad(set_to_none=True)


def _epoch_rows(
    config: FitConfig,
    dataset: SketchDataset,
    train_indices: NDArray[np.int64],
    shuffle_rng: np.random.Generator,
    sampler: ViewSampler,
    pairs: PairedEpochs | None,
) -> list[Rows]:
    drawing_count = len(dataset.labels)
    if pairs is not None:
        return paired_rows(pairs.next_drawings(), config.batch_size, sampler, drawing_count)
    return shuffled_rows(train_indices, config.batch_size, shuffle_rng, sampler, drawing_count)


def _progress_drawings(dataset: SketchDataset) -> NDArray[np.int64]:
    """Validation drawings for the per-epoch line: all of them, or an even spread of a big split."""
    val_indices = dataset.indices(Split.VAL)
    if len(val_indices) <= PROGRESS_VALIDATION_DRAWINGS:
        return val_indices
    spread = np.linspace(0, len(val_indices) - 1, PROGRESS_VALIDATION_DRAWINGS).astype(np.int64)
    return val_indices[spread]


def _validate(
    model: SketchNet, dataset: SketchDataset, config: FitConfig, device: torch.device
) -> tuple[float, float, float]:
    """The per-epoch progress line: top-1 and top-3 over every view of (a spread of) the validation
    drawings, and top-1 on the finished ones. Read in half precision on CUDA; the reports a run
    ends with are computed apart, in full, by evaluation.py."""
    val_indices = _progress_drawings(dataset)
    logits = np.concatenate(
        [
            predict(
                model,
                dataset,
                val_indices,
                config.batch_size,
                device,
                view,
                readers=config.readers,
                half_precision=True,
            ).logits
            for view in range(dataset.view_count)
        ]
    )
    labels = np.tile(dataset.labels[val_indices], dataset.view_count)
    finished = dataset.fractions[val_indices].T.reshape(-1) >= FULL_FRACTION
    overall = accuracy(logits, labels)
    return overall.top1, overall.top3, accuracy(logits[finished], labels[finished]).top1


def fit(
    model: SketchNet,
    dataset: SketchDataset,
    config: FitConfig,
    device: torch.device,
    teacher: TeacherLogits | None = None,
) -> FitResult:
    """Train in place; reports the measured training throughput in images per second."""
    if config.view_plan.view_count != dataset.view_count:
        raise ValueError(
            f"{config.view_plan.view_count} view weights for a {dataset.view_count}-view dataset"
        )
    if config.distillation is not None and teacher is None:
        raise ValueError("distillation needs teacher logits")
    train_indices = dataset.indices(Split.TRAIN)
    use_amp = device.type == "cuda"
    if use_amp:
        torch.backends.cudnn.benchmark = True
        model.to(memory_format=torch.channels_last)

    shuffle_rng = np.random.default_rng(config.seed)
    sampler = ViewSampler(config.view_plan, len(dataset.labels), config.seed)
    pairs = PairedEpochs(train_indices, shuffle_rng) if config.paired else None
    images_per_epoch = 2 * pairs.drawings_per_epoch if pairs is not None else len(train_indices)
    steps_per_epoch = -(-images_per_epoch // config.batch_size)

    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=config.max_learning_rate,
        weight_decay=WEIGHT_DECAY,
        fused=True if config.fused_optimizer and use_amp else None,
    )
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=config.max_learning_rate,
        total_steps=config.epochs * steps_per_epoch,
        pct_start=WARM_UP_SHARE,
    )
    amp_dtype = config.amp_dtype.torch_dtype
    scaler = torch.amp.GradScaler(
        device.type, enabled=use_amp and config.amp_dtype is AmpDtype.FLOAT16
    )
    objective = Objective(config.label_smoothing, config.distillation, config.embed_align)
    stepped = _compiled_or_eager(model, config, device, use_amp) if config.compile else model
    images_seen = 0
    seconds_training = 0.0
    history: list[EpochRecord] = []

    def step(batch: Batch) -> torch.Tensor:
        images = random_affine(batch.images)
        with torch.autocast(device_type=device.type, dtype=amp_dtype, enabled=use_amp):
            logits, embedding = stepped(images)
            loss = objective(logits, embedding, batch.labels, batch.teacher_logits, batch.paired)
        optimizer.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
        scheduler.step()
        return loss.detach().float() * len(batch.indices)

    for epoch in range(1, config.epochs + 1):
        model.train()
        started = time.perf_counter()
        running_loss = torch.zeros((), device=device)
        rows = _epoch_rows(config, dataset, train_indices, shuffle_rng, sampler, pairs)
        with iterate_batches(dataset, rows, device, teacher, config.readers) as batches:
            for batch in tqdm(
                batches, total=len(rows), desc=f"epoch {epoch}/{config.epochs}", leave=False
            ):
                running_loss += step(batch)
        elapsed = time.perf_counter() - started
        images_seen += images_per_epoch
        seconds_training += elapsed

        top1, top3, finished_top1 = _validate(model, dataset, config, device)
        record = EpochRecord(
            epoch,
            float(running_loss) / images_per_epoch,
            top1,
            top3,
            finished_top1,
            images_per_epoch / elapsed,
        )
        history.append(record)
        print(
            f"epoch {epoch:>2}/{config.epochs}  loss {record.loss:.3f}  "
            f"val top-1 {top1:.1%}  top-3 {top3:.1%}  finished top-1 {finished_top1:.1%}  "
            f"{record.images_per_second:,.0f} img/s",
            flush=True,
        )
    return FitResult(
        images_seen / seconds_training, seconds_training, stepped is not model, tuple(history)
    )
