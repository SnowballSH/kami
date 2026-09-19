"""Train-time augmentation on the device: a small random affine per image, a batch at once."""

from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from torch import Tensor

MAX_ROTATION_DEGREES = 10.0
MIN_SCALE = 0.9
MAX_SCALE = 1.08
MAX_SHEAR = 0.1
MAX_SHIFT = 0.06


def _uniform(count: int, low: float, high: float, like: Tensor) -> Tensor:
    return torch.empty(count, device=like.device, dtype=like.dtype).uniform_(low, high)


def random_affine(images: Tensor) -> Tensor:
    """images float [N, 1, H, W]; each gets its own rotation, scale, shear and shift."""
    count = images.shape[0]
    max_angle = math.radians(MAX_ROTATION_DEGREES)
    angle = _uniform(count, -max_angle, max_angle, images)
    zoom = 1.0 / _uniform(count, MIN_SCALE, MAX_SCALE, images)
    shear = _uniform(count, -MAX_SHEAR, MAX_SHEAR, images)
    cos, sin = torch.cos(angle) * zoom, torch.sin(angle) * zoom
    theta = torch.stack(
        [
            torch.stack(
                [cos, -sin + shear * cos, _uniform(count, -MAX_SHIFT, MAX_SHIFT, images)], dim=1
            ),
            torch.stack(
                [sin, cos + shear * sin, _uniform(count, -MAX_SHIFT, MAX_SHIFT, images)], dim=1
            ),
        ],
        dim=1,
    )
    grid = F.affine_grid(theta, list(images.shape), align_corners=False)
    return F.grid_sample(images, grid, mode="bilinear", padding_mode="zeros", align_corners=False)
