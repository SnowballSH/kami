"""What a run tells the person waiting for it: one log file (appended across resumes, mirrored to
stdout) and `progress.json`, the latest state for `retrain.sh status`."""

from __future__ import annotations

import json
import logging
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path

LOGGER_NAME = "kami.retrain"


def open_journal(log_file: Path) -> logging.Logger:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        handler.close()
    formatter = logging.Formatter("%(asctime)s %(message)s", "%Y-%m-%d %H:%M:%S")
    for handler in (logging.FileHandler(log_file), logging.StreamHandler(sys.stdout)):
        handler.setFormatter(formatter)
        logger.addHandler(handler)
    return logger


def journal() -> logging.Logger:
    return logging.getLogger(LOGGER_NAME)


def duration(seconds: float) -> str:
    minutes = max(0, round(seconds / 60))
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h{minutes:02d}" if hours else f"{minutes} min"


def write_json_atomically(path: Path, value: object) -> None:
    staging = path.with_suffix(path.suffix + ".tmp")
    staging.write_text(json.dumps(value, indent=2))
    staging.replace(path)


@dataclass(frozen=True, slots=True)
class ProgressReport:
    step: int
    total_steps: int
    epoch: int
    epochs: int
    loss: float
    learning_rate: float
    images_per_second: float
    seconds_training: float
    seconds_remaining: float
    finishes_at: str
    updated_at: str

    @property
    def percent(self) -> float:
        return 100 * self.step / self.total_steps

    def line(self) -> str:
        return (
            f"step {self.step:,}/{self.total_steps:,} ({self.percent:.1f} %)  "
            f"epoch {self.epoch}/{self.epochs}  loss {self.loss:.3f}  lr {self.learning_rate:.2e}  "
            f"{self.images_per_second:,.0f} img/s  trained {duration(self.seconds_training)}  "
            f"ETA {duration(self.seconds_remaining)} ({self.finishes_at})"
        )


class Pace:
    """Seconds per step as measured since this process started, all overheads included, so the
    estimate that goes into the ETA is what the wall clock will actually do."""

    def __init__(self, first_step: int) -> None:
        self._first_step = first_step
        self._started = time.monotonic()

    def seconds_remaining(self, step: int, total_steps: int) -> float:
        done = step - self._first_step
        if done <= 0:
            return float("nan")
        return (time.monotonic() - self._started) / done * (total_steps - step)


def finishes_at(seconds_remaining: float) -> str:
    if seconds_remaining != seconds_remaining:
        return "unknown"
    return (datetime.now() + timedelta(seconds=seconds_remaining)).strftime("%a %H:%M")


def report_progress(path: Path, report: ProgressReport) -> None:
    journal().info(report.line())
    write_json_atomically(path, {**asdict(report), "percent": report.percent})
