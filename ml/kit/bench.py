"""How fast this machine trains, and what that buys: the training step's images per second on the
accelerator, the renderer's images per second on one CPU core, and the run a time budget allows.

The step is the trainer's own (model, AdamW, autocast, loss scaling) on random pixels — the
content of an image does not change its cost. Laptops slow down as they warm up; measure for a few
minutes (`--seconds 300`) before trusting a number for a day-long run.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F

from kit.corpus import Corpus
from kit.devices import Accelerator
from kit.looks import LookPolicy, training_look
from model import Arch, SketchNet
from render import SIZE
from splits import Split

WARM_UP_STEPS = 10
RENDER_SAMPLE = 2_000
CLASSES = 345
TRAIN_SHARE = 0.9
ASSESSMENT_HOURS = 0.75


@dataclass(frozen=True, slots=True)
class StepSpeed:
    accelerator: Accelerator
    batch_size: int
    arch: Arch
    images_per_second: float

    def line(self) -> str:
        return (
            f"{self.arch.value} batch {self.batch_size} on {self.accelerator.describe()}: "
            f"{self.images_per_second:,.0f} img/s"
        )


def measure_step(
    accelerator: Accelerator, arch: Arch, batch_size: int, seconds: float
) -> StepSpeed:
    model = SketchNet(CLASSES, arch)
    accelerator.prepare(model)
    stepped: torch.nn.Module = torch.compile(model) if accelerator.compile else model  # type: ignore[assignment]
    optimizer = accelerator.optimizer(list(model.parameters()), 1e-3, 0.02)
    scaler = torch.amp.GradScaler(accelerator.device.type, enabled=accelerator.needs_grad_scaler)
    pixels = torch.randint(0, 256, (batch_size, SIZE, SIZE), dtype=torch.uint8)
    labels = torch.randint(0, CLASSES, (batch_size,), device=accelerator.device)
    model.train()

    def step() -> None:
        with accelerator.autocast():
            logits, _ = stepped(accelerator.images(pixels))
        loss = F.cross_entropy(logits.float(), labels, label_smoothing=0.1)
        optimizer.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()

    for _ in range(WARM_UP_STEPS):
        step()
    accelerator.synchronize()
    started = time.perf_counter()
    steps = 0
    while time.perf_counter() - started < seconds:
        step()
        steps += 1
        if steps % 10 == 0:
            accelerator.synchronize()
    accelerator.synchronize()
    elapsed = time.perf_counter() - started
    return StepSpeed(accelerator, batch_size, arch, steps * batch_size / elapsed)


def measure_render(corpus: Corpus | None, policy: LookPolicy) -> float:
    """Training looks per second on one core: decode, cut, re-shape, render."""
    rng = np.random.default_rng(0)
    if corpus is not None:
        train = corpus.indices(Split.TRAIN)
        chosen = rng.choice(train, size=min(RENDER_SAMPLE, len(train)), replace=False)
        drawings = [corpus.strokes(int(index)) for index in chosen]
    else:
        drawings = [
            [rng.uniform(0, 255, (int(rng.integers(8, 40)), 2)) for _ in range(4)]
            for _ in range(RENDER_SAMPLE)
        ]
    started = time.perf_counter()
    for strokes in drawings:
        training_look(strokes, policy, rng)
    return len(drawings) / (time.perf_counter() - started)


@dataclass(frozen=True, slots=True)
class Budget:
    categories: int
    drawings_per_class: int
    epochs: int
    images_per_second: float

    @property
    def image_passes(self) -> int:
        return round(self.categories * self.drawings_per_class * TRAIN_SHARE * self.epochs)

    @property
    def training_hours(self) -> float:
        return self.image_passes / self.images_per_second / 3600

    def line(self) -> str:
        return (
            f"{self.categories} x {self.drawings_per_class:>7,} drawings x {self.epochs} epoch(s)"
            f" = {self.image_passes / 1e6:6.1f} M image passes: {self.training_hours:5.1f} h "
            f"training + ~{ASSESSMENT_HOURS:g} h assessment and export"
        )


def drawings_for_hours(hours: float, categories: int, epochs: int, images_per_second: float) -> int:
    training_seconds = max(0.0, hours - ASSESSMENT_HOURS) * 3600
    return math.floor(training_seconds * images_per_second / (categories * TRAIN_SHARE * epochs))


def workers_needed(images_per_second: float, renders_per_second: float) -> int:
    """Two workers' worth of headroom beyond the bare need: renders stall on page faults too."""
    return max(2, math.ceil(images_per_second / renders_per_second) + 1)
