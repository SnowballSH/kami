"""Temperature scaling: the one scalar T that makes softmax(logits / T) honest on held-out data."""

from __future__ import annotations

import numpy as np
import torch
import torch.nn.functional as F
from numpy.typing import NDArray

LBFGS_STEPS = 200
LBFGS_LEARNING_RATE = 0.1
MIN_TEMPERATURE = 0.05
MAX_TEMPERATURE = 20.0


def negative_log_likelihood(
    logits: NDArray[np.float32], labels: NDArray[np.int64], temperature: float
) -> float:
    scaled = torch.from_numpy(logits).float() / temperature
    return float(F.cross_entropy(scaled, torch.from_numpy(labels)))


def fit_temperature(logits: NDArray[np.float32], labels: NDArray[np.int64]) -> float:
    held_out_logits = torch.from_numpy(logits).float()
    held_out_labels = torch.from_numpy(labels)
    log_temperature = torch.zeros(1, requires_grad=True)
    optimizer = torch.optim.LBFGS(
        [log_temperature],
        lr=LBFGS_LEARNING_RATE,
        max_iter=LBFGS_STEPS,
        line_search_fn="strong_wolfe",
    )

    def closure() -> torch.Tensor:
        optimizer.zero_grad()
        loss = F.cross_entropy(held_out_logits / log_temperature.exp(), held_out_labels)
        loss.backward()
        return loss

    optimizer.step(closure)
    return float(log_temperature.detach().exp().clamp(MIN_TEMPERATURE, MAX_TEMPERATURE))
