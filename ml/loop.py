"""The optimisation loop: AdamW + OneCycle, AMP on CUDA, label smoothing, affine augmentation."""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F
from numpy.typing import NDArray
from tqdm import tqdm

from augment import random_affine
from batches import iterate_batches
from dataset import SketchDataset, Split
from metrics import accuracy
from model import SketchNet

LABEL_SMOOTHING = 0.1
WEIGHT_DECAY = 0.02
WARM_UP_SHARE = 0.15


@dataclass(frozen=True, slots=True)
class FitConfig:
    epochs: int
    batch_size: int
    max_learning_rate: float
    seed: int


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
) -> NDArray[np.float32]:
    """Logits for `indices`, in the order given (which must be ascending)."""
    model.eval()
    with iterate_batches(dataset, indices, batch_size, device) as batches:
        logits = [model(batch.images)[0].float().cpu().numpy() for batch in batches]
    return np.concatenate(logits).astype(np.float32)


def fit(model: SketchNet, dataset: SketchDataset, config: FitConfig, device: torch.device) -> float:
    """Train in place; returns the measured training throughput in images per second."""
    train_indices = dataset.indices(Split.TRAIN)
    val_indices = dataset.indices(Split.VAL)
    steps_per_epoch = -(-len(train_indices) // config.batch_size)
    use_amp = device.type == "cuda"
    if use_amp:
        torch.backends.cudnn.benchmark = True
        model.to(memory_format=torch.channels_last)

    optimizer = torch.optim.AdamW(
        model.parameters(), lr=config.max_learning_rate, weight_decay=WEIGHT_DECAY
    )
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer,
        max_lr=config.max_learning_rate,
        total_steps=config.epochs * steps_per_epoch,
        pct_start=WARM_UP_SHARE,
    )
    scaler = torch.amp.GradScaler(device.type, enabled=use_amp)
    shuffle_rng = np.random.default_rng(config.seed)
    images_seen = 0
    seconds_training = 0.0

    for epoch in range(1, config.epochs + 1):
        model.train()
        started = time.perf_counter()
        running_loss = torch.zeros((), device=device)
        with iterate_batches(
            dataset, train_indices, config.batch_size, device, shuffle_rng
        ) as batches:
            for batch in tqdm(
                batches, total=steps_per_epoch, desc=f"epoch {epoch}/{config.epochs}", leave=False
            ):
                images = random_affine(batch.images)
                with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=use_amp):
                    logits, _ = model(images)
                    loss = F.cross_entropy(
                        logits.float(), batch.labels, label_smoothing=LABEL_SMOOTHING
                    )
                optimizer.zero_grad(set_to_none=True)
                scaler.scale(loss).backward()
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                running_loss += loss.detach().float() * len(batch.indices)
        elapsed = time.perf_counter() - started
        images_seen += len(train_indices)
        seconds_training += elapsed

        val_logits = predict(model, dataset, val_indices, config.batch_size, device)
        validation = accuracy(val_logits, dataset.labels[val_indices])
        mean_loss = float(running_loss) / len(train_indices)
        print(
            f"epoch {epoch:>2}/{config.epochs}  loss {mean_loss:.3f}  "
            f"val top-1 {validation.top1:.1%}  top-3 {validation.top3:.1%}  "
            f"{len(train_indices) / elapsed:,.0f} img/s",
            flush=True,
        )
    return images_seen / seconds_training
