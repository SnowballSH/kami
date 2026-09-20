"""The autonomous experiment queue of the GX10: ablations, then the long run they argue for.

    setsid nohup .venv/bin/python experiments.py eye-next > logs/experiments.log 2>&1 < /dev/null &

It waits until no other train.py is running (it never stops anything it did not start), runs every
experiment as its own train.py process with its own log, scores each from the artefacts it wrote
(the selection metric of selection.py, the exported model's CPU latency), survives failures, and
appends every step to artifacts/experiments.jsonl, from which artifacts/experiments.md is rendered.
Finished steps are reused when the queue is started again. The plan and its decision rules are in
experiment_plan.py; `queue FILE.json` runs a plain list of {"name", "flags"} instead.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path

import numpy as np

from experiment_plan import (
    FAST_FLAGS,
    MAX_LATENCY_RATIO,
    ArmResult,
    Control,
    ProbeResult,
    Recipe,
    Scale,
    Views,
    accepts_alignment,
    base_views,
    best_candidate,
    clears_the_bar,
    fast_flags_pay,
    long_run_epochs,
    teacher_flags,
    teacher_run_epochs,
    verdict,
    vetoed,
    wins_early_but_loses_finished,
    with_alignment,
)

ML_DIR = Path(__file__).parent
LIVE_MODEL_NAME = "kami-eye"
PYTHON = sys.executable
QUICKDRAW_CATEGORIES = 345

IDLE_POLL_SECONDS = 60
ARM_TIMEOUT = 3_600
SHORT_TIMEOUT = 1_800
BUILD_TIMEOUT = 7_200
LONG_TIMEOUT = 36_000
TRAIN_SHARE = 0.9
TRAIN_SPLIT = 0
SLOW_ARM_FACTOR = 1.15
TEST_GAIN_TO_SHIP = 1.0
MAX_RECOGNIZE_MS = 15.0

Row = dict[str, object]


@dataclass(frozen=True, slots=True)
class Workspace:
    """Where the queue reads and writes; the code it runs is always this directory's."""

    root: Path = ML_DIR

    @property
    def artifacts(self) -> Path:
        return self.root / "artifacts"

    @property
    def datasets(self) -> Path:
        return self.root / "data" / "datasets"

    @property
    def teachers(self) -> Path:
        return self.root / "data" / "teachers"

    @property
    def logs(self) -> Path:
        return self.root / "logs" / "experiments"

    @property
    def live_model(self) -> Path:
        return self.artifacts / LIVE_MODEL_NAME

    def train_flags(self) -> list[str]:
        return ["--data-dir", str(self.root / "data"), "--artifacts-dir", str(self.artifacts)]


def now() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def say(message: str) -> None:
    print(f"[{now()}] {message}", flush=True)


class Ledger:
    """Append-only experiments.jsonl, and the experiments.md rendered from it after every row."""

    def __init__(self, workspace: Workspace, stem: str) -> None:
        workspace.artifacts.mkdir(parents=True, exist_ok=True)
        self._jsonl = workspace.artifacts / f"{stem}.jsonl"
        self._report = workspace.artifacts / f"{stem}.md"

    def rows(self) -> list[Row]:
        if not self._jsonl.exists():
            return []
        return [json.loads(line) for line in self._jsonl.read_text().splitlines() if line.strip()]

    def append(self, row: Row) -> Row:
        with self._jsonl.open("a") as ledger:
            ledger.write(json.dumps(row) + "\n")
        self._report.write_text(render_report(self.rows()))
        return row

    def completed(self, name: str) -> Row | None:
        done = [row for row in self.rows() if row.get("name") == name and row.get("status") == "ok"]
        return done[-1] if done else None

    def decide(self, text: str) -> None:
        say(text)
        self.append({"kind": "decision", "at": now(), "text": text})


def _percent(value: object) -> str:
    return f"{100 * value:.1f}" if isinstance(value, int | float) else "-"


def _number(value: object, digits: int = 2) -> str:
    return f"{value:.{digits}f}" if isinstance(value, int | float) else "-"


def _selection_cells(selection: Mapping[str, object]) -> list[str]:
    return [
        _number(selection.get("score")),
        _percent(selection.get("top1_finished")),
        _percent(selection.get("top1_mid")),
        _percent(selection.get("top3_early")),
        _percent(selection.get("cov95_finished")),
        _number(selection.get("certain_above_finished"), 4),
        _percent(selection.get("ece_partial")),
        _percent(selection.get("retrieval_recall_at_10")),
    ]


REPORT_HEADER = (
    "| experiment | kind | recipe | status | S | finished top-1 | 50-70 % top-1 | 30-50 % top-3 "
    "| cov95 | floor | partial ECE | recall@10 | img/s | latency x live | /recognize ms | min |\n"
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"
)
REPORT_LEGEND = """
## How to read this

All accuracy columns are percentages on alias-folded labels over stratified views of held-out
drawings (validation unless the experiment says test). **S** = 0.35 finished top-1 + 0.25 top-1 at
50-70 % of the ink + 0.20 top-3 at 30-50 % + 0.20 cov95, where **cov95** is the share of finished
drawings that can be named at 95 % precision and **floor** the calibrated confidence it takes.
**partial ECE** and **recall@10** (a 50-70 % prefix finds its own finished drawing among its class)
are guard-rails; **latency x live** is the exported ONNX against artifacts/kami-eye, interleaved in
one process on the CPU, bound 1.25. Differences in S below 0.5 are noise, 0.5-1.0 need the second
seed to agree, 1.0 and more are accepted (doubled when the two control seeds differ by more than
0.5). Rules: ml/experiment_plan.py; design: docs/reports/kami-eye-next.md.
"""


def render_report(rows: Sequence[Row]) -> str:
    lines = ["# Kami's Eye experiments\n", f"Rendered {now()} from the ledger beside this file.\n"]
    lines.append(REPORT_HEADER.rstrip("\n"))
    for row in rows:
        if row.get("kind") in ("decision", "probe"):
            continue
        selection = row.get("selection")
        latency = row.get("latency")
        seconds = row.get("seconds")
        cells = [
            str(row.get("name")),
            str(row.get("kind")),
            str(row.get("recipe", "")),
            str(row.get("status")),
            *_selection_cells(selection if isinstance(selection, dict) else {}),
            _number(row.get("imagesPerSecond"), 0),
            _number(latency.get("ratio") if isinstance(latency, dict) else None),
            _number(latency.get("recognizeRouteMs") if isinstance(latency, dict) else None, 1),
            _number(seconds / 60 if isinstance(seconds, int | float) else None, 1),
        ]
        lines.append("| " + " | ".join(cells) + " |")
    probes = [row for row in rows if row.get("kind") == "probe"]
    if probes:
        lines.append("\n## Throughput probes\n")
        lines += [
            f"- {row.get('name')}: {row.get('status')}, {_number(row.get('imagesPerSecond'), 0)} "
            f"img/s, loss {_number(row.get('loss'), 3)}, compiled {row.get('compiled')}"
            for row in probes
        ]
    decisions = [row for row in rows if row.get("kind") == "decision"]
    if decisions:
        lines.append("\n## Decisions, in order\n")
        lines += [f"- {row.get('at')}: {row.get('text')}" for row in decisions]
    return "\n".join(lines) + "\n" + REPORT_LEGEND


def foreign_trainings(own_groups: set[int]) -> list[str]:
    """Command lines of python processes running a train.py that this queue did not start."""
    listing = subprocess.run(
        ["ps", "-eo", "pgid=,args="], capture_output=True, text=True, check=True
    ).stdout
    found: list[str] = []
    for line in listing.splitlines():
        group, _, arguments = line.strip().partition(" ")
        words = arguments.split()
        is_python = bool(words) and Path(words[0]).name.startswith("python")
        trains = any(Path(word).name == "train.py" for word in words[1:4])
        if is_python and trains and int(group) not in own_groups:
            found.append(arguments)
    return found


@dataclass(frozen=True, slots=True)
class Outcome:
    ok: bool
    seconds: float
    log: Path
    command: list[str]

    def row(self, name: str, kind: str) -> Row:
        return {
            "name": name,
            "kind": kind,
            "status": "ok" if self.ok else "failed",
            "finishedAt": now(),
            "seconds": round(self.seconds, 1),
            "command": " ".join(self.command),
            "log": str(self.log),
        }


def read_json(path: Path) -> dict[str, object]:
    value: object = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError(f"{path} is not a JSON object")
    return value


class ExperimentQueue:
    def __init__(
        self, scale: Scale, workspace: Workspace, ledger: Ledger, wait_for_others: bool
    ) -> None:
        self.scale = scale
        self.workspace = workspace
        self.ledger = ledger
        self._wait_for_others = wait_for_others
        self._own_groups = {os.getpgid(0)}
        workspace.logs.mkdir(parents=True, exist_ok=True)

    def wait_until_idle(self) -> None:
        if not self._wait_for_others:
            return
        while others := foreign_trainings(self._own_groups):
            say(f"waiting: another training holds the GPU ({others[0][:120]})")
            time.sleep(IDLE_POLL_SECONDS)

    def _environment(self) -> dict[str, str]:
        return {**os.environ, "TQDM_MININTERVAL": "10", "PYTHONUNBUFFERED": "1"}

    def run(self, name: str, script: str, flags: Sequence[str], timeout: int) -> Outcome:
        self.wait_until_idle()
        command = [PYTHON, script, *flags]
        log = self.workspace.logs / f"{name}.log"
        say(f"start {name}: {' '.join(command[1:])}")
        started = time.perf_counter()
        with log.open("ab") as output:
            try:
                status = subprocess.run(
                    command,
                    cwd=ML_DIR,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    env=self._environment(),
                    timeout=timeout,
                    check=False,
                ).returncode
            except subprocess.TimeoutExpired:
                status = -1
                output.write(f"\nstopped by the queue after {timeout} s\n".encode())
        outcome = Outcome(status == 0, time.perf_counter() - started, log, command)
        say(f"{'done' if outcome.ok else 'FAILED'} {name} in {outcome.seconds / 60:.1f} min")
        return outcome

    def start_in_background(self, name: str, flags: Sequence[str]) -> subprocess.Popen[bytes]:
        """A CPU-only train.py at the lowest CPU and I/O priority, in its own process group."""
        command = ["nice", "-n", "19", "ionice", "-c", "3", PYTHON, "train.py", *flags]
        command += self.workspace.train_flags()
        say(f"start in the background {name}: {' '.join(command)}")
        with (self.workspace.logs / f"{name}.log").open("ab") as output:
            process = subprocess.Popen(
                command,
                cwd=ML_DIR,
                stdout=output,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                env={**self._environment(), "CUDA_VISIBLE_DEVICES": ""},
                start_new_session=True,
            )
        self._own_groups.add(process.pid)
        return process

    def latency(self, name: str) -> dict[str, object] | None:
        artifacts = self.workspace.artifacts
        if not self.workspace.live_model.exists():
            return None
        out = artifacts / "latency" / f"{name}.json"
        flags = ["--model", str(artifacts / name), "--reference", str(self.workspace.live_model)]
        flags += ["--out", str(out)]
        outcome = self.run(f"{name}.latency", "latency.py", flags, SHORT_TIMEOUT)
        return read_json(out) if outcome.ok else None

    def train(self, kind: str, name: str, recipe: str, flags: Sequence[str], timeout: int) -> Row:
        if (done := self.ledger.completed(name)) is not None:
            say(f"reuse {name}: already in the ledger")
            return done
        outcome = self.run(name, "train.py", [*flags, *self.workspace.train_flags()], timeout)
        row = {**outcome.row(name, kind), "recipe": recipe}
        preprocess = self.workspace.artifacts / name / "preprocess.json"
        if outcome.ok and preprocess.exists():
            written = read_json(preprocess)
            training = written.get("training")
            row["selection"] = written.get("selection")
            row["test"] = {"top1": written.get("top1"), "top3": written.get("top3")}
            row["temperatures"] = [written.get("temperature"), written.get("temperaturePartial")]
            row["certainAbove"] = written.get("certainAbove")
            if isinstance(training, dict):
                row["imagesPerSecond"] = training.get("imagesPerSecond")
                row["compiled"] = training.get("compiled")
            row["latency"] = self.latency(name)
        return self.ledger.append(row)

    def evaluate(self, model: str, dataset: str, split: str, kind: str) -> Row:
        name = f"{model}.{dataset}.{split}"
        if (done := self.ledger.completed(name)) is not None:
            return done
        artifacts = self.workspace.artifacts
        out = artifacts / "evaluations" / f"{name}.json"
        flags = ["--model", str(artifacts / model)]
        flags += ["--dataset", str(self.workspace.datasets / dataset)]
        flags += ["--split", split, "--out", str(out), "--readers", str(self.scale.readers)]
        outcome = self.run(name, "evaluate.py", flags, SHORT_TIMEOUT)
        row = {**outcome.row(name, kind), "recipe": f"{model} on {split}"}
        if outcome.ok:
            row["selection"] = read_json(out).get("selection")
        own = artifacts / model / "preprocess.json"
        if own.exists():
            written = read_json(own)
            row["ownReport"] = {key: written.get(key) for key in ("trainedOn", "top1", "top3")}
        return self.ledger.append(row)

    def teach(self, teacher_model: str, dataset: str) -> Path | None:
        """The teacher's logits over a dataset's finished training views; None when it failed."""
        path = self.workspace.teachers / f"{teacher_model}.{dataset}.npy"
        name = f"{teacher_model}.{dataset}.teacher"
        if self.ledger.completed(name) is not None and path.exists():
            return path
        flags = ["--model", str(self.workspace.artifacts / teacher_model)]
        flags += ["--dataset", str(self.workspace.datasets / dataset)]
        flags += ["--out", str(path), "--readers", str(self.scale.readers)]
        outcome = self.run(name, "distill_teacher.py", flags, SHORT_TIMEOUT)
        self.ledger.append({**outcome.row(name, "teacher"), "recipe": f"logits of {teacher_model}"})
        return path if outcome.ok else None

    def probe(self, name: str, flags: Sequence[str]) -> ProbeResult | None:
        out = self.workspace.artifacts / "probes" / f"{name}.json"
        dataset = self.workspace.datasets / self.scale.arm_dataset
        common = ["--dataset", str(dataset), "--out", str(out)]
        common += ["--steps", str(self.scale.probe_steps)]
        common += ["--batch-size", str(self.scale.batch_size), "--readers", str(self.scale.readers)]
        outcome = self.run(name, "probe.py", [*common, *flags], SHORT_TIMEOUT)
        row = outcome.row(name, "probe")
        if not outcome.ok:
            self.ledger.append(row)
            return None
        measured = read_json(out)
        self.ledger.append({**row, **measured})
        return ProbeResult(
            bool(measured["compiled"]),
            float(str(measured["imagesPerSecond"])),
            float(str(measured["loss"])),
        )


def arm_result(row: Row, recipe: Recipe, seed: int) -> ArmResult | None:
    selection = row.get("selection")
    if row.get("status") != "ok" or not isinstance(selection, dict):
        return None
    latency = row.get("latency")

    def number(value: object) -> float:
        return float(value) if isinstance(value, int | float) else float("nan")

    recall = selection.get("retrieval_recall_at_10")
    ratio = latency.get("ratio") if isinstance(latency, dict) else None
    return ArmResult(
        name=str(row["name"]),
        recipe=recipe,
        seed=seed,
        score=number(selection.get("score")),
        top1_finished=number(selection.get("top1_finished")),
        top3_early=number(selection.get("top3_early")),
        ece_partial=number(selection.get("ece_partial")),
        recall_at_10=float(recall) if isinstance(recall, int | float) else None,
        images_per_second=number(row.get("imagesPerSecond")),
        latency_ratio=float(ratio) if isinstance(ratio, int | float) else None,
    )


class EyeNextPlan:
    """Tonight's staged plan: controls, greedy forward selection, replication, the long run."""

    def __init__(self, queue: ExperimentQueue) -> None:
        self.queue = queue
        self.scale = queue.scale
        self.workspace = queue.workspace
        self.ledger = queue.ledger
        self.peer_teacher: Path | None = None

    def has_checkpoint(self, model: str) -> bool:
        return (self.workspace.artifacts / model / "model.pt").exists()

    def arm(self, recipe: Recipe, seed: int = 0) -> ArmResult | None:
        if recipe.distilled and self.peer_teacher is None:
            self.ledger.decide(f"{recipe.label} skipped: there are no peer-teacher logits")
            return None
        name = self.scale.arm_name(recipe, seed)
        flags = self.scale.arm_flags(recipe, seed, self.peer_teacher)
        row = self.queue.train("arm", name, f"{recipe.label} seed {seed}", flags, ARM_TIMEOUT)
        return arm_result(row, recipe, seed)

    def arms(self, *recipes: Recipe) -> list[ArmResult]:
        return [arm for recipe in recipes if (arm := self.arm(recipe)) is not None]

    def ensure_arm_dataset(self) -> None:
        if (self.workspace.datasets / self.scale.arm_dataset / "meta.json").exists():
            return
        flags = self.scale.dataset_only_flags(self.scale.arm_samples, self.scale.arm_dataset)
        flags += self.workspace.train_flags()
        self.queue.run(f"{self.scale.arm_dataset}.build", "train.py", flags, BUILD_TIMEOUT)

    def references(self) -> None:
        """The baseline and the live model on the arms' own validation views, for the same S."""
        if self.scale.reference_model is None:
            return
        for model in (self.scale.reference_model, LIVE_MODEL_NAME):
            if self.has_checkpoint(model):
                self.queue.evaluate(model, self.scale.arm_dataset, "val", "reference")

    def fast_flags_pay(self) -> bool:
        eager = self.queue.probe(f"{self.scale.prefix}probe-eager", [])
        fast = self.queue.probe(f"{self.scale.prefix}probe-fast", list(FAST_FLAGS))
        if eager is None or fast is None:
            self.ledger.decide("speed flags: a probe failed, the long run stays eager fp16")
            return False
        pays = fast_flags_pay(eager, fast)
        self.ledger.decide(
            f"speed flags: {fast.images_per_second:,.0f} against {eager.images_per_second:,.0f} "
            f"img/s, loss {fast.loss:.3f} against {eager.loss:.3f}, torch.compile "
            f"{'worked' if fast.compiled else 'fell back to eager'} -> the long run "
            f"{'uses' if pays else 'does not use'} {' '.join(FAST_FLAGS)}"
        )
        return pays

    def select(self) -> tuple[Recipe | None, Control | None, ArmResult | None]:
        """Arms 1-8. Returns the recipe that clears the bar (or None), the control, the winner."""
        controls = [arm for seed in (0, 1) if (arm := self.arm(Recipe(), seed)) is not None]
        if not controls:
            self.ledger.decide("both control arms failed: nothing can be compared tonight")
            return None, None, None
        control = Control(tuple(controls))
        bars = control.thresholds
        self.ledger.decide(
            f"control S {control.score:.2f} over {len(controls)} seed(s): "
            f"suggestive from +{bars.suggestive}, accepted from +{bars.accepted}"
        )
        self.peer_teacher = self.queue.teach(control.first.name, self.scale.arm_dataset)

        view_arms = self.arms(Recipe(Views.EARLY))
        if view_arms and wins_early_but_loses_finished(view_arms[0], control):
            self.ledger.decide("V wins early but loses finished drawings: trying legacy weights")
            view_arms += self.arms(Recipe(Views.RESAMPLE_LEGACY))
        base = Recipe(base_views(view_arms, control))
        self.ledger.decide(f"later arms build on the views of {base.label}")

        candidates = view_arms + self.arms(
            replace(base, deep_stem=True),
            replace(base, distilled=True),
            replace(base, deep_stem=True, distilled=True),
        )
        for arm in candidates:
            if (reason := vetoed(arm, control)) is not None:
                self.ledger.decide(f"{arm.name} is out: {reason}")
            if arm.images_per_second * SLOW_ARM_FACTOR < control.first.images_per_second:
                self.ledger.decide(
                    f"{arm.name} trains at {arm.images_per_second:,.0f} img/s, the control at "
                    f"{control.first.images_per_second:,.0f}: its long run gets fewer epochs"
                )
        winner = best_candidate(candidates, control)
        if winner is None:
            self.ledger.decide("no arm beats the control by more than noise")
            return None, control, None
        self.ledger.decide(
            f"best so far: {winner.recipe.label}, S {winner.score:.2f} "
            f"({winner.score - control.score:+.2f} on the control)"
        )

        aligned = self.arm(with_alignment(winner.recipe))
        if aligned is not None and accepts_alignment(aligned, winner, control):
            self.ledger.decide(
                f"alignment accepted: recall@10 {winner.recall_at_10:.1%} -> "
                f"{aligned.recall_at_10:.1%}, S {aligned.score:.2f}"
            )
            winner = aligned
        else:
            self.ledger.decide("alignment not accepted")

        replication = self.arm(winner.recipe, seed=1)
        decision = verdict(winner, replication, control)
        self.ledger.decide(f"{winner.recipe.label}: {decision.value}")
        return (winner.recipe if clears_the_bar(decision) else None), control, winner

    def train_drawings(self) -> int:
        splits = self.workspace.datasets / self.scale.long_dataset / "splits.npy"
        if splits.exists():
            return int((np.load(splits) == TRAIN_SPLIT).sum())
        return int(TRAIN_SHARE * self.scale.long_samples * QUICKDRAW_CATEGORIES)

    def long_run(self, recipe: Recipe, speed: float, fast: bool) -> Row:
        teacher: Path | None = None
        if recipe.distilled:
            model = self.scale.long_teacher_model or self.scale.arm_name(Recipe(), 0)
            if self.has_checkpoint(model):
                teacher = self.queue.teach(model, self.scale.long_dataset)
            if teacher is None:
                self.ledger.decide(f"no teacher logits from {model}: the long run does not distil")
                recipe = replace(recipe, distilled=False)
        epochs = self.scale.fixed_long_epochs or long_run_epochs(speed, self.train_drawings())
        name = self.scale.long_name
        self.ledger.decide(
            f"long run {name}: {recipe.label}, {epochs} epochs at an expected {speed:,.0f} img/s"
            f"{', with the speed flags' if fast else ''}"
        )
        flags = self.scale.long_flags(name, epochs, recipe.flags(teacher))
        row = self.queue.train(
            "long-run", name, recipe.label, [*flags, *(FAST_FLAGS if fast else ())], LONG_TIMEOUT
        )
        if row.get("status") != "ok" and fast:
            self.ledger.decide("the long run failed with the speed flags: once more, eager fp16")
            row = self.queue.train("long-run", name, recipe.label, flags, LONG_TIMEOUT)
        return row

    def teacher_run(self, control: Control | None) -> None:
        speed = control.first.images_per_second if control is not None else 7_000.0
        epochs = self.scale.fixed_long_epochs or teacher_run_epochs(speed, self.train_drawings())
        name = self.scale.fallback_name
        self.ledger.decide(
            f"no recipe cleared the bar: the GPU hours go to a ResNet-34 teacher ({name}, "
            f"{epochs} epochs, today's recipe) for the next night; ship kami-eye-xl meanwhile"
        )
        flags = self.scale.long_flags(name, epochs, teacher_flags())
        self.queue.train("teacher-run", name, "B resnet34", flags, LONG_TIMEOUT)

    def final_report(self, long_row: Row) -> None:
        if long_row.get("status") != "ok":
            self.ledger.decide("the long run failed: nothing to compare; see its log")
            return
        name, dataset = self.scale.long_name, self.scale.long_dataset
        candidate = self.queue.evaluate(name, dataset, "test", "final")
        reference = self.scale.reference_model
        if reference is None or not self.has_checkpoint(reference):
            self.ledger.decide(f"{name} is trained; there is no reference model to compare with")
            return
        control = self.queue.evaluate(reference, dataset, "test", "final")
        ours, theirs = candidate.get("selection"), control.get("selection")
        if not isinstance(ours, dict) or not isinstance(theirs, dict):
            self.ledger.decide("a final evaluation failed: compare by hand, see the logs")
            return
        gain = float(ours["score"]) - float(theirs["score"])
        latency = long_row.get("latency")
        ratio = latency.get("ratio") if isinstance(latency, dict) else None
        route = latency.get("recognizeRouteMs") if isinstance(latency, dict) else None
        cheap = (
            isinstance(ratio, int | float)
            and isinstance(route, int | float)
            and ratio <= MAX_LATENCY_RATIO
            and route <= MAX_RECOGNIZE_MS
        )
        ships = gain >= TEST_GAIN_TO_SHIP and cheap
        self.ledger.decide(
            f"FINAL on test: {name} S {float(ours['score']):.2f} against {reference} "
            f"{float(theirs['score']):.2f} ({gain:+.2f}); latency {ratio}x live, "
            f"/recognize {route} ms -> "
            f"{'a candidate to ship (a human decides)' if ships else 'does not clear the bar'}."
            " Nothing was deployed; exemplars were not rebuilt."
        )

    def run(self) -> None:
        self.queue.wait_until_idle()
        self.ledger.decide(f"queue started at scale '{self.scale.prefix}'")
        self.ensure_arm_dataset()
        build = self.queue.start_in_background(
            f"{self.scale.long_dataset}.build",
            self.scale.dataset_only_flags(self.scale.long_samples, self.scale.long_dataset),
        )
        self.references()
        fast = self.fast_flags_pay()
        recipe, control, winner = self.select()
        say("waiting for the long run's dataset")
        try:
            say(f"the long dataset build ended with status {build.wait(timeout=BUILD_TIMEOUT)}")
        except subprocess.TimeoutExpired:
            say("the long dataset build is still running: the long run will wait for the GPU only")
        if recipe is None or winner is None:
            self.teacher_run(control)
        else:
            self.final_report(self.long_run(recipe, winner.images_per_second, fast))
        self.ledger.decide("queue finished")


def run_plain_queue(queue: ExperimentQueue, path: Path) -> None:
    experiments: object = json.loads(path.read_text())
    if not isinstance(experiments, list):
        raise SystemExit(f"{path} must be a JSON array of {{name, flags}}")
    for experiment in experiments:
        name, flags = str(experiment["name"]), [str(flag) for flag in experiment["flags"]]
        queue.train("queued", name, str(experiment.get("recipe", "")), flags, LONG_TIMEOUT)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="mode", required=True)
    plan = modes.add_parser("eye-next", help="the staged plan of docs/reports/kami-eye-next.md")
    plan.add_argument("--smoke", action="store_true", help="tiny sizes, its own ledger")
    plan.add_argument("--no-wait", action="store_true", help="do not wait for other trainings")
    plain = modes.add_parser("queue", help="run a JSON list of {name, flags} through train.py")
    plain.add_argument("file", type=Path)
    plain.add_argument("--no-wait", action="store_true")
    arguments = parser.parse_args()

    workspace = Workspace()
    wait = not arguments.no_wait
    if arguments.mode == "queue":
        ledger = Ledger(workspace, "experiments")
        run_plain_queue(ExperimentQueue(Scale.tonight(), workspace, ledger, wait), arguments.file)
        return
    scale = Scale.smoke() if arguments.smoke else Scale.tonight()
    ledger = Ledger(workspace, "experiments-smoke" if arguments.smoke else "experiments")
    EyeNextPlan(ExperimentQueue(scale, workspace, ledger, wait)).run()


if __name__ == "__main__":
    main()
