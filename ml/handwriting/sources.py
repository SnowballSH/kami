"""The pinned, checksummed files the handwriting reader is made of (docs: ml/HANDWRITING.md)."""

from __future__ import annotations

from dataclasses import dataclass

HUGGING_FACE = "https://huggingface.co"
PPOCR_REPOSITORY = "monkt/paddleocr-onnx"
PPOCR_REVISION = "7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65"
TROCR_REPOSITORY = "Xenova/trocr-small-handwritten"
TROCR_REVISION = "2432e24d184b1d964d07ed04f5d9e21d31a59141"


@dataclass(frozen=True, slots=True)
class PinnedFile:
    """`name` is the file's name in the bundle; the rest says exactly which bytes it must be."""

    name: str
    repository: str
    revision: str
    path: str
    sha256: str
    size: int

    @property
    def url(self) -> str:
        return f"{HUGGING_FACE}/{self.repository}/resolve/{self.revision}/{self.path}"


SCREEN_MODEL = PinnedFile(
    "screen.onnx",
    PPOCR_REPOSITORY,
    PPOCR_REVISION,
    "languages/english/rec.onnx",
    "4e16deb22c4da6468bdca539b2cd3c8687825538b67109177c47d359ab994cd7",
    7_830_888,
)
SCREEN_CHARACTERS = PinnedFile(
    "screen-characters.txt",
    PPOCR_REPOSITORY,
    PPOCR_REVISION,
    "languages/english/dict.txt",
    "e025a66d31f327ba0c232e03f407ae8d105e1e709e7ccb3f408aa778c24e70d6",
    1_416,
)
READER_ENCODER = PinnedFile(
    "reader-encoder.onnx",
    TROCR_REPOSITORY,
    TROCR_REVISION,
    "onnx/encoder_model_quantized.onnx",
    "2f29edbd925f8a49c9c7d1349895f960cf09d2efdc76fe23f957048d476e0d03",
    23_082_942,
)
READER_DECODER = PinnedFile(
    "reader-decoder.onnx",
    TROCR_REPOSITORY,
    TROCR_REVISION,
    "onnx/decoder_model_merged_quantized.onnx",
    "51076aa396ab5939c4668db9de901ad51765094b4c05c4c8c1f8ae2012ba1e08",
    40_527_613,
)
READER_TOKENIZER = PinnedFile(
    "reader-tokenizer.json",
    TROCR_REPOSITORY,
    TROCR_REVISION,
    "tokenizer.json",
    "68bcb5468c854362a615f3d2ff6a5e4091a85f4c8198993ed9a30afe0b143737",
    4_494_727,
)

BUNDLE: tuple[PinnedFile, ...] = (
    SCREEN_MODEL,
    SCREEN_CHARACTERS,
    READER_ENCODER,
    READER_DECODER,
    READER_TOKENIZER,
)
