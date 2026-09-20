"""The queue driver against a fake process runner: what it starts, in which order, and decides."""

import json
import subprocess
from collections.abc import Sequence
from pathlib import Path

import pytest

from experiment_plan import Scale
from experiments import (
    ExperimentQueue,
    EyeNextPlan,
    Ledger,
    Outcome,
    Workspace,
    foreign_trainings,
    render_report,
    run_plain_queue,
)

CONTROL_SCORE = 60.0


def flag(flags: Sequence[str], name: str) -> str:
    return flags[flags.index(name) + 1]


class FakeBox:
    """Stands in for every process the queue would start, writing the files they would write."""

    def __init__(self, workspace: Workspace, gains: dict[str, float], failing: set[str]) -> None:
        self.workspace = workspace
        self.gains = gains
        self.failing = failing
        self.started: list[tuple[str, list[str]]] = []

    def selection(self, slug: str) -> dict[str, object]:
        return {
            "score": CONTROL_SCORE + self.gains.get(slug, 0.0),
            "top1_finished": 0.75,
            "top1_mid": 0.5,
            "top3_early": 0.5,
            "cov95_finished": 0.6,
            "certain_above_finished": 0.81,
            "ece_partial": 0.03,
            "retrieval_recall_at_10": 0.5 if slug.endswith("a") else 0.4,
        }

    def train(self, flags: Sequence[str]) -> None:
        if "--dataset-only" in flags:
            out = self.workspace.datasets / flag(flags, "--dataset-name")
            out.mkdir(parents=True, exist_ok=True)
            (out / "meta.json").write_text("{}")
            return
        name = flag(flags, "--name")
        out = Path(flag(flags, "--artifacts-dir")) / name
        out.mkdir(parents=True, exist_ok=True)
        (out / "model.pt").write_text("weights")
        slug = name.split("-")[-2] if name.count("-") >= 2 else name
        written = {
            "selection": self.selection(slug),
            "training": {"imagesPerSecond": 7000.0, "compiled": "--compile" in flags},
            "top1": 0.7,
            "top3": 0.9,
        }
        (out / "preprocess.json").write_text(json.dumps(written))

    def write(self, flags: Sequence[str], record: dict[str, object]) -> None:
        out = Path(flag(flags, "--out"))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(record))

    def run(self, name: str, script: str, flags: Sequence[str], timeout: int) -> Outcome:
        self.started.append((script, list(flags)))
        log = self.workspace.logs / f"{name}.log"
        if name in self.failing:
            return Outcome(False, 1.0, log, [script, *flags])
        if script == "train.py":
            self.train(flags)
        elif script == "evaluate.py":
            model = Path(flag(flags, "--model")).name
            self.write(flags, {"selection": self.selection("vka" if "next" in model else "b")})
        elif script == "latency.py":
            self.write(flags, {"ratio": 1.02, "recognizeRouteMs": 6.0})
        elif script == "probe.py":
            fast = "--compile" in flags
            speed = 8400.0 if fast else 7000.0
            self.write(flags, {"compiled": fast, "imagesPerSecond": speed, "loss": 3.2})
        elif script == "distill_teacher.py":
            self.write(flags, {})
        return Outcome(True, 1.0, log, [script, *flags])

    def trainings(self) -> list[str]:
        return [
            flag(flags, "--name")
            for script, flags in self.started
            if script == "train.py" and "--dataset-only" not in flags
        ]


class FinishedBuild:
    def wait(self, timeout: int | None = None) -> int:
        return 0


@pytest.fixture
def workspace(tmp_path: Path) -> Workspace:
    workspace = Workspace(tmp_path)
    for model in ("kami-eye", "kami-eye-xl"):
        (workspace.artifacts / model).mkdir(parents=True)
        (workspace.artifacts / model / "model.pt").write_text("weights")
    return workspace


def run_plan(
    workspace: Workspace,
    monkeypatch: pytest.MonkeyPatch,
    gains: dict[str, float],
    failing: set[str] | None = None,
) -> tuple[FakeBox, Ledger]:
    box = FakeBox(workspace, gains, failing or set())
    ledger = Ledger(workspace, "experiments")
    queue = ExperimentQueue(Scale.tonight(), workspace, ledger, wait_for_others=False)
    monkeypatch.setattr(queue, "run", box.run)

    def build(name: str, flags: Sequence[str]) -> FinishedBuild:
        box.train(flags)
        return FinishedBuild()

    monkeypatch.setattr(queue, "start_in_background", build)
    EyeNextPlan(queue).run()
    return box, ledger


def decisions(ledger: Ledger) -> str:
    return "\n".join(str(row["text"]) for row in ledger.rows() if row["kind"] == "decision")


def test_the_winning_recipe_is_replicated_and_becomes_the_long_run(
    workspace: Workspace, monkeypatch: pytest.MonkeyPatch
) -> None:
    gains = {"v": 0.3, "vd": 0.2, "vk": 1.5, "vkd": 1.2, "vka": 1.4}
    box, ledger = run_plan(workspace, monkeypatch, gains)

    assert box.trainings() == [
        *("abl-b-s0", "abl-b-s1", "abl-v-s0", "abl-vd-s0", "abl-vk-s0", "abl-vkd-s0"),
        *("abl-vka-s0", "abl-vka-s1", "kami-eye-next"),
    ]
    long_flags = next(flags for _, flags in box.started if "kami-eye-next" in flags)
    assert flag(long_flags, "--epochs") == "12"
    assert flag(long_flags, "--teacher-logits").endswith("kami-eye-xl.eye-next-22k-v4.npy")
    assert flag(long_flags, "--embed-align") == "0.5" and "--compile" in long_flags
    assert "--arch" not in long_flags
    peer = next(flags for _, flags in box.started if "abl-vk-s0" in flags)
    assert flag(peer, "--teacher-logits").endswith("abl-b-s0.abl-3k-v4.npy")

    evaluated = [Path(flag(f, "--model")).name for s, f in box.started if s == "evaluate.py"]
    assert evaluated == ["kami-eye-xl", "kami-eye", "kami-eye-next", "kami-eye-xl"]
    said = decisions(ledger)
    assert "best so far: V+K" in said and "alignment accepted" in said
    assert "V+K+A: accepted" in said and "a candidate to ship (a human decides)" in said
    assert said.strip().endswith("queue finished")


def test_without_a_winner_the_hours_go_to_the_teacher(
    workspace: Workspace, monkeypatch: pytest.MonkeyPatch
) -> None:
    box, ledger = run_plan(workspace, monkeypatch, {"v": 0.2, "vd": -0.1, "vk": 0.4, "vkd": 0.3})
    assert box.trainings()[-1] == "eye-teacher-r34"
    assert "kami-eye-next" not in box.trainings() and "abl-vk-s1" not in box.trainings()
    teacher = next(flags for _, flags in box.started if "eye-teacher-r34" in flags)
    assert flag(teacher, "--arch") == "resnet34" and flag(teacher, "--epochs") == "6"
    assert "no arm beats the control" in decisions(ledger)


def test_a_failing_arm_is_recorded_and_the_queue_goes_on(
    workspace: Workspace, monkeypatch: pytest.MonkeyPatch
) -> None:
    gains = {"v": 1.2, "vd": 3.0, "vk": 0.1, "vkd": 0.2}
    box, ledger = run_plan(workspace, monkeypatch, gains, failing={"abl-vd-s0"})
    failed = [row for row in ledger.rows() if row.get("status") == "failed"]
    assert [row["name"] for row in failed] == ["abl-vd-s0"]
    assert box.trainings()[-1] == "kami-eye-next"
    assert "best so far: V," in decisions(ledger)


def test_without_peer_logits_the_distilled_arms_are_skipped(
    workspace: Workspace, monkeypatch: pytest.MonkeyPatch
) -> None:
    box, ledger = run_plan(
        workspace, monkeypatch, {"v": 1.2}, failing={"abl-b-s0.abl-3k-v4.teacher"}
    )
    assert "abl-vk-s0" not in box.trainings() and "abl-vd-s0" in box.trainings()
    assert "V+K skipped" in decisions(ledger)


def test_a_restarted_queue_reuses_what_is_in_the_ledger(
    workspace: Workspace, monkeypatch: pytest.MonkeyPatch
) -> None:
    gains = {"v": 0.3, "vk": 1.5}
    first, _ = run_plan(workspace, monkeypatch, gains)
    again, ledger = run_plan(workspace, monkeypatch, gains)
    assert first.trainings() and again.trainings() == []
    assert [row["name"] for row in ledger.rows() if row.get("kind") == "arm"] == first.trainings()[
        :-1
    ]


def test_a_plain_queue_runs_its_list_and_survives_a_failure(
    workspace: Workspace, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    box = FakeBox(workspace, {}, failing={"one"})
    ledger = Ledger(workspace, "experiments")
    queue = ExperimentQueue(Scale.tonight(), workspace, ledger, wait_for_others=False)
    monkeypatch.setattr(queue, "run", box.run)
    plan = tmp_path / "queue.json"
    plan.write_text(
        json.dumps([{"name": name, "flags": ["--all", "--name", name]} for name in ("one", "two")])
    )
    run_plain_queue(queue, plan)
    assert [(row["name"], row["status"]) for row in ledger.rows()] == [
        ("one", "failed"),
        ("two", "ok"),
    ]


def test_the_report_is_rendered_from_the_ledger(workspace: Workspace) -> None:
    ledger = Ledger(workspace, "experiments")
    selection = FakeBox(workspace, {"v": 1.0}, set()).selection("v")
    ledger.append(
        {"name": "abl-v-s0", "kind": "arm", "recipe": "V seed 0", "status": "ok", "seconds": 630,
         "selection": selection, "imagesPerSecond": 7012.4, "latency": {"ratio": 1.04}}
    )  # fmt: skip
    ledger.append({"name": "abl-vd-s0", "kind": "arm", "status": "failed", "seconds": 12})
    ledger.decide("best so far: V")
    report = (workspace.artifacts / "experiments.md").read_text()
    assert (
        "| abl-v-s0 | arm | V seed 0 | ok | 61.00 | 75.0 | 50.0 | 50.0 | 60.0 | 0.8100 |" in report
    )
    assert "| abl-vd-s0 | arm |  | failed | - |" in report
    assert "best so far: V" in report and "How to read this" in report
    assert render_report([]).startswith("# Kami's Eye experiments")


def test_only_other_peoples_python_trainings_count_as_foreign(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    listing = "\n".join(
        [
            "  100 .venv/bin/python train.py --all --name kami-eye-xl",
            "  200 /usr/bin/python3 /home/asus/kami-ml/train.py --all --dataset-only",
            "  300 bash -c cd ~/kami-ml && .venv/bin/python train.py --all",
            "  400 .venv/bin/python experiments.py eye-next",
            "  500 tail -f logs/train.py.log",
        ]
    )

    def ps(*_: object, **__: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess([], 0, stdout=listing)

    monkeypatch.setattr(subprocess, "run", ps)
    assert foreign_trainings({200}) == [".venv/bin/python train.py --all --name kami-eye-xl"]
    assert len(foreign_trainings(set())) == 2
