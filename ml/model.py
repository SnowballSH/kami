"""ResNets for 64x64 one-channel sketches: stride-2 stem, no max-pool, 512-d embedding.

`resnet18` is the first recipe. `resnet18d` reads the raw pixels at full resolution before the
first stride and average-pools before each 1x1 shortcut (He et al. 2019, ResNet-D): ink is ~1.5 px
wide, and a stride-2 convolution on raw pixels samples thin lines with aliasing. `resnet34` is a
teacher only.
"""

from __future__ import annotations

from enum import StrEnum

from torch import Tensor, nn
from torchvision.models import ResNet, resnet18, resnet34

EMBEDDING_SIZE = 512
STEM_CHANNELS = 64
DEEP_STEM_CHANNELS = 32


class Arch(StrEnum):
    RESNET18 = "resnet18"
    RESNET18D = "resnet18d"
    RESNET34 = "resnet34"


def _strided_stem() -> nn.Module:
    return nn.Conv2d(1, STEM_CHANNELS, kernel_size=3, stride=2, padding=1, bias=False)


def _full_resolution_stem() -> nn.Module:
    stem = nn.Sequential(
        nn.Conv2d(1, DEEP_STEM_CHANNELS, kernel_size=3, stride=1, padding=1, bias=False),
        nn.BatchNorm2d(DEEP_STEM_CHANNELS),
        nn.ReLU(inplace=True),
        nn.Conv2d(
            DEEP_STEM_CHANNELS, STEM_CHANNELS, kernel_size=3, stride=2, padding=1, bias=False
        ),
    )
    _initialise_convolutions(stem)
    return stem


def _initialise_convolutions(module: nn.Module) -> None:
    for layer in module.modules():
        if isinstance(layer, nn.Conv2d):
            nn.init.kaiming_normal_(layer.weight, mode="fan_out", nonlinearity="relu")


def _pool_before_shortcuts(backbone: ResNet) -> None:
    for stage in (backbone.layer2, backbone.layer3, backbone.layer4):
        block = stage[0]
        strided, norm = block.downsample
        projection = nn.Conv2d(strided.in_channels, strided.out_channels, kernel_size=1, bias=False)
        _initialise_convolutions(projection)
        block.downsample = nn.Sequential(nn.AvgPool2d(kernel_size=2, stride=2), projection, norm)


def _backbone(arch: Arch) -> ResNet:
    backbone = resnet34(weights=None) if arch is Arch.RESNET34 else resnet18(weights=None)
    if arch is Arch.RESNET18D:
        backbone.conv1 = _full_resolution_stem()
        _pool_before_shortcuts(backbone)
    else:
        backbone.conv1 = _strided_stem()
    backbone.maxpool = nn.Identity()
    backbone.fc = nn.Identity()
    return backbone


class SketchNet(nn.Module):
    def __init__(self, class_count: int, arch: Arch = Arch.RESNET18) -> None:
        super().__init__()
        self.arch = arch
        self.backbone = _backbone(arch)
        self.classifier = nn.Linear(EMBEDDING_SIZE, class_count)

    def forward(self, image: Tensor) -> tuple[Tensor, Tensor]:
        embedding = self.backbone(image)
        return self.classifier(embedding), embedding
