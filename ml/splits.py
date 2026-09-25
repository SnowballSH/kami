"""Which side of the train / validation / test split a Quick, Draw! drawing is on, forever.

The split is a pure function of the drawing's `key_id`, so a drawing never changes side between
runs, corpus sizes or machines, and every model since the first is scored on the same test drawings.
"""

from __future__ import annotations

from enum import IntEnum

import numpy as np
from numpy.typing import NDArray

TRAIN_PERCENT = 90
VAL_PERCENT = 5

_MASK_64 = (1 << 64) - 1
_SPLITMIX_INCREMENT = 0x9E3779B97F4A7C15
_SPLITMIX_MULTIPLIER_A = 0xBF58476D1CE4E5B9
_SPLITMIX_MULTIPLIER_B = 0x94D049BB133111EB


class Split(IntEnum):
    TRAIN = 0
    VAL = 1
    TEST = 2


def split_of(key_id: int) -> Split:
    """A drawing's split from the splitmix64 hash of its key_id: 90 % train, 5 % val, 5 % test."""
    mixed = (key_id + _SPLITMIX_INCREMENT) & _MASK_64
    mixed = ((mixed ^ (mixed >> 30)) * _SPLITMIX_MULTIPLIER_A) & _MASK_64
    mixed = ((mixed ^ (mixed >> 27)) * _SPLITMIX_MULTIPLIER_B) & _MASK_64
    bucket = (mixed ^ (mixed >> 31)) % 100
    if bucket < TRAIN_PERCENT:
        return Split.TRAIN
    return Split.VAL if bucket < TRAIN_PERCENT + VAL_PERCENT else Split.TEST


def splits_of(key_ids: NDArray[np.uint64]) -> NDArray[np.uint8]:
    """`split_of` of every key_id at once (uint64 arithmetic wraps as the hash needs)."""
    mixed = key_ids.astype(np.uint64) + np.uint64(_SPLITMIX_INCREMENT)
    mixed = (mixed ^ (mixed >> np.uint64(30))) * np.uint64(_SPLITMIX_MULTIPLIER_A)
    mixed = (mixed ^ (mixed >> np.uint64(27))) * np.uint64(_SPLITMIX_MULTIPLIER_B)
    bucket = (mixed ^ (mixed >> np.uint64(31))) % np.uint64(100)
    return np.where(
        bucket < TRAIN_PERCENT,
        Split.TRAIN,
        np.where(bucket < TRAIN_PERCENT + VAL_PERCENT, Split.VAL, Split.TEST),
    ).astype(np.uint8)
