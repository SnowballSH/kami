import json
import time
from pathlib import Path

import numpy as np
import pytest

from exemplar_set import (
    EMBEDDING_SIZE,
    EMBEDDINGS_FILE,
    EXEMPLARS_DIR,
    META_FILE,
    MODEL_FILE,
    Exemplar,
    ExemplarSet,
    ExemplarSetError,
    load_exemplars,
    load_exemplars_of_model,
    model_sha256,
)

CATEGORIES = ("circle", "square", "mushroom")


def unit_vector(rng: np.random.Generator) -> np.ndarray:
    vector = rng.normal(size=EMBEDDING_SIZE).astype(np.float32)
    return np.asarray(vector / np.linalg.norm(vector), dtype=np.float32)


def exemplar(
    rng: np.random.Generator, label: int, key_id: int, stroke_lengths: list[int]
) -> Exemplar:
    return Exemplar(
        label=label,
        probability=float(rng.uniform(0.9, 1.0)),
        key_id=key_id,
        embedding=unit_vector(rng),
        strokes=[rng.integers(0, 256, (length, 2)).astype(np.uint8) for length in stroke_lengths],
    )


@pytest.fixture
def exemplars() -> list[Exemplar]:
    rng = np.random.default_rng(5)
    return [
        exemplar(rng, 2, 2**63 + 9, [4, 1, 7]),
        exemplar(rng, 0, 11, [3]),
        exemplar(rng, 2, 12, [2, 2]),
        exemplar(rng, 0, 13, [5, 6]),
    ]


def test_round_trip_keeps_every_drawing_and_number(
    tmp_path: Path, exemplars: list[Exemplar]
) -> None:
    ExemplarSet.of(CATEGORIES, exemplars).save(tmp_path / "set", {"model": "tiny"})
    loaded = load_exemplars(tmp_path / "set")

    assert loaded.categories == CATEGORIES
    assert loaded.count == 4
    assert loaded.labels.tolist() == [0, 0, 2, 2]
    assert loaded.key_ids.tolist() == [11, 13, 2**63 + 9, 12]
    assert loaded.embeddings.dtype == np.float16
    assert loaded.embeddings.shape == (4, EMBEDDING_SIZE)
    by_key = {item.key_id: item for item in exemplars}
    for index, key_id in enumerate(loaded.key_ids.tolist()):
        expected = by_key[key_id]
        assert loaded.probabilities[index] == pytest.approx(expected.probability, abs=1e-3)
        assert loaded.embeddings[index] == pytest.approx(expected.embedding, abs=1e-3)
        strokes = loaded.strokes(index)
        assert len(strokes) == len(expected.strokes)
        for actual, original in zip(strokes, expected.strokes, strict=True):
            assert actual.dtype == np.uint8 and np.array_equal(actual, original)


def test_exemplars_of_a_label_are_one_window_in_the_given_order(
    exemplars: list[Exemplar],
) -> None:
    exemplar_set = ExemplarSet.of(CATEGORIES, exemplars)
    assert exemplar_set.of_label(0) == range(0, 2)
    assert exemplar_set.of_label(1) == range(2, 2)
    assert exemplar_set.of_label(2) == range(2, 4)
    assert exemplar_set.key_ids[exemplar_set.of_label(2).start] == 2**63 + 9


def test_an_empty_set_round_trips(tmp_path: Path) -> None:
    ExemplarSet.of(CATEGORIES, []).save(tmp_path, {})
    loaded = load_exemplars(tmp_path)
    assert loaded.count == 0
    assert loaded.of_label(1) == range(0, 0)


def test_saving_twice_writes_the_same_bytes(tmp_path: Path, exemplars: list[Exemplar]) -> None:
    for name in ("first", "second"):
        ExemplarSet.of(CATEGORIES, exemplars).save(tmp_path / name, {"model": "tiny"})
    for written in sorted((tmp_path / "first").iterdir()):
        assert written.read_bytes() == (tmp_path / "second" / written.name).read_bytes()


def test_arrays_that_disagree_are_refused(tmp_path: Path, exemplars: list[Exemplar]) -> None:
    ExemplarSet.of(CATEGORIES, exemplars).save(tmp_path, {})
    np.save(tmp_path / EMBEDDINGS_FILE, np.zeros((3, EMBEDDING_SIZE), dtype=np.float16))
    with pytest.raises(ExemplarSetError):
        load_exemplars(tmp_path)
    np.save(tmp_path / EMBEDDINGS_FILE, np.zeros((4, EMBEDDING_SIZE), dtype=np.float32))
    with pytest.raises(ExemplarSetError):
        load_exemplars(tmp_path)


def test_labels_outside_the_categories_are_refused(exemplars: list[Exemplar]) -> None:
    with pytest.raises(ExemplarSetError):
        ExemplarSet.of(CATEGORIES[:2], exemplars)


def test_another_format_version_is_refused(tmp_path: Path, exemplars: list[Exemplar]) -> None:
    ExemplarSet.of(CATEGORIES, exemplars).save(tmp_path, {})
    meta = json.loads((tmp_path / META_FILE).read_text())
    (tmp_path / META_FILE).write_text(json.dumps({**meta, "version": 0}))
    with pytest.raises(ExemplarSetError):
        load_exemplars(tmp_path)


def test_a_model_without_exemplars_has_none(tmp_path: Path) -> None:
    (tmp_path / MODEL_FILE).write_bytes(b"a model")
    assert load_exemplars_of_model(tmp_path) is None


def test_exemplars_belong_to_the_model_they_were_built_with(
    tmp_path: Path, exemplars: list[Exemplar]
) -> None:
    (tmp_path / MODEL_FILE).write_bytes(b"a model")
    ExemplarSet.of(CATEGORIES, exemplars).save(
        tmp_path / EXEMPLARS_DIR, {"modelSha256": model_sha256(tmp_path)}
    )
    loaded = load_exemplars_of_model(tmp_path)
    assert loaded is not None and loaded.count == 4

    (tmp_path / MODEL_FILE).write_bytes(b"a retrained model")
    with pytest.raises(ExemplarSetError, match="another model"):
        load_exemplars_of_model(tmp_path)


def test_the_full_vocabulary_loads_fast_and_small(tmp_path: Path) -> None:
    count, strokes_each, points_each = 345 * 200, 4, 12
    rng = np.random.default_rng(1)
    ExemplarSet(
        categories=tuple(f"category {index}" for index in range(345)),
        embeddings=rng.normal(size=(count, EMBEDDING_SIZE)).astype(np.float16),
        labels=np.repeat(np.arange(345, dtype=np.int32), 200),
        probabilities=np.full(count, 0.95, dtype=np.float16),
        key_ids=np.arange(count, dtype=np.uint64),
        points=rng.integers(0, 256, (count * strokes_each * points_each, 2)).astype(np.uint8),
        stroke_offsets=np.arange(0, count * strokes_each + 1, dtype=np.uint32) * points_each,
        drawing_offsets=np.arange(0, count + 1, dtype=np.uint32) * strokes_each,
    ).save(tmp_path, {})

    started = time.perf_counter()
    loaded = load_exemplars(tmp_path)
    seconds = time.perf_counter() - started

    in_memory = sum(
        array.nbytes
        for array in (
            loaded.embeddings,
            loaded.labels,
            loaded.probabilities,
            loaded.key_ids,
            loaded.points,
            loaded.stroke_offsets,
            loaded.drawing_offsets,
        )
    )
    assert seconds < 1.0
    assert in_memory < 100_000_000
    assert len(loaded.strokes(count - 1)) == strokes_each
