"""The resumable fit: AdamW, warm-up then cosine, label-smoothed cross-entropy, on batches rendered
on the fly (kit/stream.py).

A checkpoint (weights, optimiser, loss scaler, step, clocks, history) is written atomically every
`checkpoint_minutes`, at the end of every epoch and when the process is asked to stop (SIGINT,
SIGTERM, SIGHUP). The learning rate is a pure function of the step and the batches are a pure
function of (seed, step), so a run resumed from step s continues exactly where it was.
"""

from __future__ import annotations

import math
import signal
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from types import FrameType

import torch
import torch.nn.functional as F

from kit.assess import probe_drawings, read_held_out
from kit.corpus import Corpus
from kit.devices import Accelerator
from kit.journal import (
    Pace,
    ProgressReport,
    finishes_at,
    journal,
    report_progress,
    write_json_atomically,
)
from kit.recipe import Recipe, Runtime
from kit.stream import EpochPlan, StepSampler, TrainingImages, batch_loader
from metrics import accuracy
from model import SketchNet
from splits import Split

START_LR_SHARE = 1 / 25
END_LR_SHARE = 1 / 25 / 1e4
STOP_SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)


def learning_rate(step: int, total_steps: int, peak: float, warmup_share: float) -> float:
    """Linear warm-up from peak/25, then a cosine down to peak/250,000 — OneCycle's envelope."""
    warmup = max(1, round(total_steps * warmup_share))
    if step < warmup:
        return peak * (START_LR_SHARE + (1 - START_LR_SHARE) * step / warmup)
    progress = min(1.0, (step - warmup) / max(1, total_steps - warmup))
    return peak * (END_LR_SHARE + (1 - END_LR_SHARE) * 0.5 * (1 + math.cos(math.pi * progress)))


@dataclass(frozen=True, slots=True)
class ProbeRecord:
    step: int
    epoch: float
    loss: float
    top1: float
    top3: float
    finished_top1: float
    partial_top1: float
    images_per_second: float


@dataclass(slots=True)
class Clocks:
    seconds_training: float = 0.0
    images: int = 0
    history: list[ProbeRecord] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class RunFiles:
    directory: Path

    @property
    def recipe(self) -> Path:
        return self.directory / "recipe.json"

    @property
    def checkpoint(self) -> Path:
        return self.directory / "checkpoint.pt"

    @property
    def weights(self) -> Path:
        return self.directory / "model.pt"

    @property
    def training(self) -> Path:
        return self.directory / "training.json"

    @property
    def progress(self) -> Path:
        return self.directory / "progress.json"

    @property
    def log(self) -> Path:
        return self.directory / "retrain.log"

    @property
    def assessment(self) -> Path:
        return self.directory / "assessment.json"

    @property
    def package(self) -> Path:
        return self.directory / "package"


class StopRequest:
    """Turns the stop signals into a flag the loop checks between steps; a signal the process was
    started ignoring (SIGHUP under nohup) stays ignored."""

    def __init__(self) -> None:
        self.signal: int | None = None
        self._previous: dict[int, object] = {}

    def __enter__(self) -> StopRequest:
        for number in STOP_SIGNALS:
            if signal.getsignal(number) is not signal.SIG_IGN:
                self._previous[number] = signal.signal(number, self._handle)
        return self

    def __exit__(self, *_: object) -> None:
        for number, handler in self._previous.items():
            signal.signal(number, handler)  # type: ignore[arg-type]

    def _handle(self, number: int, _: FrameType | None) -> None:
        self.signal = number

    @property
    def requested(self) -> bool:
        return self.signal is not None


class Trainer:
    def __init__(
        self,
        recipe: Recipe,
        corpus: Corpus,
        files: RunFiles,
        accelerator: Accelerator,
        runtime: Runtime,
    ) -> None:
        self.recipe = recipe
        self.corpus = corpus
        self.files = files
        self.accelerator = accelerator
        self.runtime = runtime
        torch.manual_seed(recipe.seed)
        self.model = SketchNet(len(recipe.categories), recipe.arch)
        accelerator.prepare(self.model)
        self.stepped: torch.nn.Module = (
            torch.compile(self.model) if accelerator.compile else self.model  # type: ignore[assignment]
        )
        self.optimizer = accelerator.optimizer(
            list(self.model.parameters()), recipe.learning_rate, recipe.weight_decay
        )
        self.scaler = torch.amp.GradScaler(
            accelerator.device.type, enabled=accelerator.needs_grad_scaler
        )
        self.plan = EpochPlan(
            corpus.indices(Split.TRAIN, recipe.drawings_per_class),
            recipe.batch_size,
            recipe.epochs,
            recipe.seed,
        )
        self.probes = probe_drawings(corpus, recipe.eval_head, runtime.probe_drawings_per_class)
        self.step = 0
        self.clocks = Clocks()

    def _state(self) -> dict[str, object]:
        return {
            "recipe": self.recipe.fingerprint(),
            "step": self.step,
            "model": self.model.state_dict(),
            "optimizer": self.optimizer.state_dict(),
            "scaler": self.scaler.state_dict(),
            "secondsTraining": self.clocks.seconds_training,
            "images": self.clocks.images,
            "history": [asdict(record) for record in self.clocks.history],
        }

    def save_checkpoint(self) -> None:
        staging = self.files.checkpoint.with_suffix(".tmp")
        torch.save(self._state(), staging)
        staging.replace(self.files.checkpoint)

    def resume(self) -> bool:
        if not self.files.checkpoint.exists():
            return False
        state = torch.load(self.files.checkpoint, map_location="cpu", weights_only=True)
        if state["recipe"] != self.recipe.fingerprint():
            raise SystemExit(f"{self.files.checkpoint} belongs to another recipe")
        self.model.load_state_dict(state["model"])
        self.optimizer.load_state_dict(state["optimizer"])
        self.scaler.load_state_dict(state["scaler"])
        self.step = int(state["step"])
        self.clocks = Clocks(
            float(state["secondsTraining"]),
            int(state["images"]),
            [ProbeRecord(**record) for record in state["history"]],
        )
        return True

    def _probe(self, loss: float, images_per_second: float) -> ProbeRecord:
        reading = read_held_out(
            self.model, self.corpus, self.probes, self.accelerator, self.runtime.workers
        )
        overall = accuracy(reading.logits, reading.labels)
        finished = ~reading.partial
        record = ProbeRecord(
            step=self.step,
            epoch=self.step / self.plan.steps_per_epoch,
            loss=loss,
            top1=overall.top1,
            top3=overall.top3,
            finished_top1=accuracy(reading.logits[finished], reading.labels[finished]).top1,
            partial_top1=accuracy(reading.logits[~finished], reading.labels[~finished]).top1,
            images_per_second=images_per_second,
        )
        journal().info(
            f"probe at epoch {record.epoch:.2f}: validation top-1 {record.top1:.1%} "
            f"(finished {record.finished_top1:.1%}, prefixes {record.partial_top1:.1%}), "
            f"top-3 {record.top3:.1%} on {len(reading.labels):,} looks"
        )
        return record

    def _train_step(self, images: torch.Tensor, labels: torch.Tensor) -> torch.Tensor:
        rate = learning_rate(
            self.step, self.plan.total_steps, self.recipe.learning_rate, self.recipe.warmup_share
        )
        for group in self.optimizer.param_groups:
            group["lr"] = rate
        with self.accelerator.autocast():
            logits, _ = self.stepped(images)
        loss = F.cross_entropy(logits.float(), labels, label_smoothing=self.recipe.label_smoothing)
        self.optimizer.zero_grad(set_to_none=True)
        self.scaler.scale(loss).backward()
        self.scaler.step(self.optimizer)
        self.scaler.update()
        return loss.detach()

    def fit(self, until: int | None = None) -> None:
        """Train to the end, or only up to step `until` (then checkpoint): resuming continues."""
        log = journal()
        total = self.plan.total_steps
        last = total if until is None else min(until, total)
        if self.resume():
            log.info(f"resuming at step {self.step:,} of {total:,}")
        if self.step >= last:
            return
        log.info(
            f"{len(self.plan.drawings):,} training drawings, {self.plan.steps_per_epoch:,} "
            f"steps per epoch, {total:,} steps on {self.accelerator.describe()}"
        )
        self.model.train()
        loader = batch_loader(
            TrainingImages(self.corpus, self.recipe.looks, self.recipe.seed),
            StepSampler(self.plan, self.step, last),
            self.runtime.workers,
            self.accelerator.is_cuda,
        )
        pace = Pace(self.step)
        tick = last_log = last_checkpoint = last_probe = interval_started = time.monotonic()
        interval_steps = 0
        running_loss = torch.zeros((), device=self.accelerator.device)
        batch_size = self.recipe.batch_size

        with StopRequest() as stop:
            batches = iter(loader)
            while self.step < last and not stop.requested:
                try:
                    batch = next(batches)
                except Exception:
                    if stop.requested:
                        break
                    raise
                images = self.accelerator.images(batch.images)
                labels = batch.labels.to(self.accelerator.device, non_blocking=True)
                running_loss += self._train_step(images, labels)
                self.step += 1
                interval_steps += 1
                self.clocks.images += batch_size
                now = time.monotonic()
                self.clocks.seconds_training += now - tick
                tick = now
                epoch_ends = self.step % self.plan.steps_per_epoch == 0
                if now - last_log >= self.runtime.log_seconds or epoch_ends or stop.requested:
                    loss = float(running_loss) / interval_steps
                    images_per_second = (
                        interval_steps * batch_size / (time.monotonic() - interval_started)
                    )
                    self._report(loss, images_per_second, pace.seconds_remaining(self.step, total))
                    if epoch_ends or now - last_probe >= self.runtime.probe_minutes * 60:
                        self.clocks.history.append(self._probe(loss, images_per_second))
                        last_probe = time.monotonic()
                    running_loss.zero_()
                    interval_steps = 0
                    last_log = interval_started = tick = time.monotonic()
                if epoch_ends or now - last_checkpoint >= self.runtime.checkpoint_minutes * 60:
                    self.save_checkpoint()
                    last_checkpoint = tick = time.monotonic()
            if self.step < total:
                self.save_checkpoint()
            if stop.requested:
                log.info(f"stopped by signal {stop.signal} at step {self.step:,}; resumable")
                raise SystemExit(128 + (stop.signal or 0))

    def _report(self, loss: float, images_per_second: float, remaining: float) -> None:
        report_progress(
            self.files.progress,
            ProgressReport(
                step=self.step,
                total_steps=self.plan.total_steps,
                epoch=self.plan.epoch_of(self.step - 1) + 1,
                epochs=self.recipe.epochs,
                loss=loss,
                learning_rate=self.optimizer.param_groups[0]["lr"],
                images_per_second=images_per_second,
                seconds_training=self.clocks.seconds_training,
                seconds_remaining=remaining,
                finishes_at=finishes_at(remaining),
                updated_at=time.strftime("%Y-%m-%d %H:%M:%S"),
            ),
        )

    def write_weights(self) -> None:
        torch.save(self.model.state_dict(), self.files.weights)
        seconds = self.clocks.seconds_training
        report = {
            "steps": self.step,
            "images": self.clocks.images,
            "secondsTraining": seconds,
            "imagesPerSecond": self.clocks.images / seconds if seconds > 0 else 0.0,
            "trainingDrawings": len(self.plan.drawings),
            "device": self.accelerator.describe(),
            "history": [asdict(record) for record in self.clocks.history],
        }
        write_json_atomically(self.files.training, report)
