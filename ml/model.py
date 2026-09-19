"""ResNet-18 for 64x64 one-channel sketches: 3x3 stride-2 stem, no max-pool, 512-d embedding."""

from __future__ import annotations

from torch import Tensor, nn
from torchvision.models import resnet18

EMBEDDING_SIZE = 512
STEM_CHANNELS = 64


class SketchNet(nn.Module):
    def __init__(self, class_count: int) -> None:
        super().__init__()
        backbone = resnet18(weights=None)
        backbone.conv1 = nn.Conv2d(1, STEM_CHANNELS, kernel_size=3, stride=2, padding=1, bias=False)
        backbone.maxpool = nn.Identity()
        backbone.fc = nn.Identity()
        self.backbone = backbone
        self.classifier = nn.Linear(EMBEDDING_SIZE, class_count)

    def forward(self, image: Tensor) -> tuple[Tensor, Tensor]:
        embedding = self.backbone(image)
        return self.classifier(embedding), embedding
