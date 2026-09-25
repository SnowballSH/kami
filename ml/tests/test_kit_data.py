"""The corpus index, the looks and the on-the-fly batches: what the model is shown, and that it is
the same whoever renders it and whenever a run resumes."""

import pickle
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from synthetic import SYNTHETIC_CATEGORIES, write_synthetic_bins  # noqa: E402

from kit.corpus import Corpus, CorpusSpec  # noqa: E402
from kit.looks import (  # noqa: E402
    FINISHED,
    MIN_PREFIX,
    LookPolicy,
    held_out_look,
    held_out_prefix_fraction,
    training_look,
)
from kit.stream import (  # noqa: E402
    EpochPlan,
    HeldOutImages,
    HeldOutRows,
    Step,
    StepSampler,
    TrainingImages,
    batch_loader,
)
from quickdraw_bin import category_path, read_drawings  # noqa: E402
from render import from_xy_arrays, render, render_prefix  # noqa: E402
from splits import Split, split_of, splits_of  # noqa: E402

PER_CLASS = 40
PLAIN = LookPolicy(finished_share=1.0, max_rotation_degrees=0.0, max_shear=0.0, max_log_stretch=0.0)


@pytest.fixture(scope="module")
def corpus(tmp_path_factory: pytest.TempPathFactory) -> Corpus:
    root = tmp_path_factory.mktemp("corpus")
    write_synthetic_bins(root / "bin")
    spec = CorpusSpec(SYNTHETIC_CATEGORIES, PER_CLASS)
    return Corpus.build(spec, root / "bin", root / "index", workers=2)


def test_the_array_split_is_the_split_of_each_key_id() -> None:
    key_ids = np.random.default_rng(0).integers(0, 2**63, 5_000, dtype=np.uint64)
    assert splits_of(key_ids).tolist() == [split_of(int(key_id)) for key_id in key_ids]
    shares = Counter(splits_of(np.arange(5_000_000_000, 5_000_020_000, dtype=np.uint64)).tolist())
    assert abs(shares[Split.TRAIN] / 20_000 - 0.9) < 0.01


def test_the_index_is_the_head_of_each_category_recognised_drawings(corpus: Corpus) -> None:
    for label, category in enumerate(SYNTHETIC_CATEGORIES):
        drawings = read_drawings(category_path(corpus.bin_dir, category))
        expected = [drawing for drawing in drawings if drawing.recognized][:PER_CLASS]
        rows = np.flatnonzero(corpus.labels == label)
        assert corpus.ranks[rows].tolist() == list(range(PER_CLASS))
        assert corpus.key_ids[rows].tolist() == [drawing.key_id for drawing in expected]
        assert corpus.splits[rows].tolist() == [split_of(d.key_id) for d in expected]
        first = corpus.strokes(int(rows[0]))
        assert all(
            np.array_equal(a, b)
            for a, b in zip(first, from_xy_arrays(expected[0].strokes), strict=True)
        )
    assert corpus.counts() == dict.fromkeys(SYNTHETIC_CATEGORIES, PER_CLASS)


def test_indices_keep_to_a_split_and_a_head(corpus: Corpus) -> None:
    head = corpus.indices(Split.TRAIN, head=10)
    assert set(corpus.splits[head].tolist()) == {Split.TRAIN}
    assert corpus.ranks[head].max() < 10
    everything = sum(len(corpus.indices(split)) for split in Split)
    assert everything == len(corpus)


def test_a_pickled_corpus_is_its_paths_and_reads_the_same(corpus: Corpus) -> None:
    corpus.strokes(0)
    copy = pickle.loads(pickle.dumps(corpus))
    assert len(pickle.dumps(corpus)) < 1_000
    assert np.array_equal(copy.labels, corpus.labels)
    assert all(
        np.array_equal(a, b) for a, b in zip(copy.strokes(5), corpus.strokes(5), strict=True)
    )


def test_an_identical_index_is_reused_and_another_is_built_beside_it(
    corpus: Corpus, tmp_path: Path
) -> None:
    index_root = corpus.directory.parent
    again = Corpus.build(CorpusSpec(SYNTHETIC_CATEGORIES, PER_CLASS), corpus.bin_dir, index_root)
    assert again.directory == corpus.directory
    smaller = Corpus.build(CorpusSpec(SYNTHETIC_CATEGORIES, 10), corpus.bin_dir, index_root)
    assert smaller.directory != corpus.directory and len(smaller) == 20


def test_a_plain_finished_look_is_the_contract_render(corpus: Corpus) -> None:
    strokes = corpus.strokes(3)
    image, fraction = training_look(strokes, PLAIN, np.random.default_rng(0))
    assert fraction == FINISHED
    assert np.array_equal(image, render(strokes))


def test_looks_mix_finished_drawings_and_prefixes_and_repeat_with_the_seed(
    corpus: Corpus,
) -> None:
    policy = LookPolicy(finished_share=0.5)
    fractions = [policy.fraction(np.random.default_rng(seed)) for seed in range(400)]
    finished = sum(fraction == FINISHED for fraction in fractions)
    assert 150 < finished < 250
    assert all(MIN_PREFIX <= fraction <= FINISHED for fraction in fractions)
    strokes = corpus.strokes(1)
    first = training_look(strokes, policy, np.random.default_rng(7))
    second = training_look(strokes, policy, np.random.default_rng(7))
    assert np.array_equal(first[0], second[0]) and first[1] == second[1]


def test_reshaping_keeps_the_drawing_upright_and_near_its_shape() -> None:
    policy = LookPolicy()
    for seed in range(50):
        matrix = policy.reshaping(np.random.default_rng(seed))
        assert np.linalg.det(matrix) == pytest.approx(1.0, abs=1e-9)
        assert matrix[0, 0] > 0.8 and matrix[1, 1] > 0.8


def test_held_out_looks_are_a_pure_function_of_the_drawing(corpus: Corpus) -> None:
    key_id = int(corpus.key_ids[0])
    fraction = held_out_prefix_fraction(key_id)
    assert fraction == held_out_prefix_fraction(key_id)
    assert MIN_PREFIX <= fraction < FINISHED
    strokes = corpus.strokes(0)
    assert np.array_equal(held_out_look(strokes, fraction), render_prefix(strokes, fraction))
    assert np.array_equal(held_out_look(strokes, FINISHED), render(strokes))


def test_an_epoch_visits_each_drawing_once_in_whole_batches() -> None:
    plan = EpochPlan(np.arange(10, 33, dtype=np.int64), batch_size=5, epochs=2, seed=0)
    assert plan.steps_per_epoch == 4 and plan.total_steps == 8
    first = np.concatenate([plan.batch(step) for step in range(4)])
    second = np.concatenate([plan.batch(step) for step in range(4, 8)])
    assert len(set(first.tolist())) == 20 and set(first.tolist()) <= set(range(10, 33))
    assert not np.array_equal(first, second)
    replay = EpochPlan(np.arange(10, 33, dtype=np.int64), batch_size=5, epochs=2, seed=0)
    assert np.array_equal(replay.batch(6), plan.batch(6))


def test_a_sampler_resumed_at_a_step_is_the_rest_of_the_whole_run() -> None:
    plan = EpochPlan(np.arange(40, dtype=np.int64), batch_size=4, epochs=3, seed=1)
    whole = list(StepSampler(plan, 0))
    resumed = list(StepSampler(plan, 17))
    assert len(whole) == 30 and len(resumed) == 13
    assert all(
        a.step == b.step and np.array_equal(a.drawings, b.drawings)
        for a, b in zip(whole[17:], resumed, strict=True)
    )
    assert len(list(StepSampler(plan, 17, 20))) == 3


def test_a_training_batch_depends_on_its_step_not_on_who_renders_it(corpus: Corpus) -> None:
    images = TrainingImages(corpus, LookPolicy(), seed=3)
    drawings = corpus.indices(Split.TRAIN)[:8]
    first, again = images[Step(5, drawings)], images[Step(5, drawings)]
    other = images[Step(6, drawings)]
    assert torch.equal(first.images, again.images) and torch.equal(first.labels, again.labels)
    assert not torch.equal(first.images, other.images)
    plan = EpochPlan(corpus.indices(Split.TRAIN), batch_size=8, epochs=1, seed=0)
    in_process = [batch.images for batch in batch_loader(images, StepSampler(plan, 0), 0, False)]
    in_workers = [batch.images for batch in batch_loader(images, StepSampler(plan, 0), 2, False)]
    assert all(torch.equal(a, b) for a, b in zip(in_process, in_workers, strict=True))


def test_held_out_rows_read_each_drawing_finished_then_as_its_prefix(corpus: Corpus) -> None:
    drawings = corpus.indices(Split.TRAIN)[:6]
    rows = HeldOutRows.of(corpus, drawings)
    assert len(rows) == 12
    assert rows.fractions[:6].tolist() == [FINISHED] * 6
    assert np.all(rows.fractions[6:] < FINISHED)
    batch = HeldOutImages(corpus, rows)[slice(0, 12)]
    assert torch.equal(batch.images[0], torch.from_numpy(render(corpus.strokes(int(drawings[0])))))
    assert batch.labels.tolist() == np.tile(corpus.labels[drawings], 2).tolist()
