"""What each kind of machine trains fastest with, as measured (ml/README.md -> Bench).

CUDA: channels_last, autocast (bf16 where the card has it, else fp16 with a GradScaler), fused
AdamW, cuDNN autotuning. Apple MPS: plain fp32, contiguous — on an M4 autocast was no faster and
channels_last and torch.compile were 2.5x and 2x slower. CPU: plain fp32.
"""

from __future__ import annotations

from contextlib import AbstractContextManager, nullcontext
from dataclasses import dataclass
from enum import StrEnum

import torch
from torch import nn


class Precision(StrEnum):
    FP32 = "fp32"
    FP16 = "fp16"
    BF16 = "bf16"

    @property
    def autocast_dtype(self) -> torch.dtype | None:
        return {Precision.FP16: torch.float16, Precision.BF16: torch.bfloat16}.get(self)


DEVICE_CHOICES = ("auto", "cuda", "mps", "cpu")
PRECISION_CHOICES = ("auto", *(precision.value for precision in Precision))


def pick_device(name: str = "auto") -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")


def best_precision(device: torch.device) -> Precision:
    if device.type != "cuda":
        return Precision.FP32
    return Precision.BF16 if torch.cuda.is_bf16_supported() else Precision.FP16


@dataclass(frozen=True, slots=True)
class Accelerator:
    device: torch.device
    precision: Precision
    compile: bool = False

    @staticmethod
    def of(device_name: str, precision_name: str = "auto", compile: bool = False) -> Accelerator:
        device = pick_device(device_name)
        precision = (
            best_precision(device) if precision_name == "auto" else Precision(precision_name)
        )
        if device.type == "cpu" and precision is Precision.FP16:
            raise ValueError("fp16 autocast is for GPUs; use fp32 or bf16 on the CPU")
        return Accelerator(device, precision, compile)

    @property
    def is_cuda(self) -> bool:
        return self.device.type == "cuda"

    @property
    def needs_grad_scaler(self) -> bool:
        return self.precision is Precision.FP16

    def describe(self) -> str:
        name = torch.cuda.get_device_name(self.device) if self.is_cuda else self.device.type
        compiled = ", torch.compile" if self.compile else ""
        return (
            f"{name} ({self.device}), {self.precision.value}{compiled}, torch {torch.__version__}"
        )

    def prepare(self, model: nn.Module) -> nn.Module:
        model.to(self.device)
        if self.is_cuda:
            torch.backends.cudnn.benchmark = True
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            model.to(memory_format=torch.channels_last)
        return model

    def images(self, batch: torch.Tensor) -> torch.Tensor:
        """uint8 [N, 64, 64] on the host -> float [N, 1, 64, 64] on the device with ink = 1."""
        moved = batch.to(self.device, non_blocking=self.is_cuda).unsqueeze(1).float().div_(255.0)
        return moved.contiguous(memory_format=torch.channels_last) if self.is_cuda else moved

    def autocast(self) -> AbstractContextManager[object]:
        dtype = self.precision.autocast_dtype
        if dtype is None:
            return nullcontext()
        return torch.autocast(device_type=self.device.type, dtype=dtype)

    def optimizer(
        self, parameters: list[nn.Parameter], learning_rate: float, weight_decay: float
    ) -> torch.optim.AdamW:
        return torch.optim.AdamW(
            parameters, lr=learning_rate, weight_decay=weight_decay, fused=self.is_cuda or None
        )

    def synchronize(self) -> None:
        if self.is_cuda:
            torch.cuda.synchronize(self.device)
        elif self.device.type == "mps":
            torch.mps.synchronize()
