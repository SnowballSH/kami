# Kami's Eye — training kit and sidecar

One ResNet-18 that reads a 64×64 rendering of a sketch, finished or half-drawn, and names it among
345 Quick, Draw! categories. `CONTRACT.md` is the agreement with the rest of Kami (tensor, artefact
files, sidecar routes); this directory is the Python that honours it: a retraining kit that runs on
any machine, and the ONNX sidecar the Bun server asks. Nothing here touches the game: the server
reaches the model through the sidecar and falls back to its k-NN when the sidecar is not there.

The model the image serves is **`kami-eye-next`**, trained with this kit's `full` preset on an
Apple M4 MacBook Air in 21 h 54 min (36.3 M image passes, one pass over up to 120,000 drawings
per category): **83.4 % top-1 / 95.3 % top-3 on finished test drawings**, published as the GitHub
Release `eye-kami-eye-next-2026.09.26` with its model card and pinned by `eye-release.json`. Its
predecessors, `kami-eye` (81.1 %) and `kami-eye-xl` (83.1 % / 95.2 %), were trained at the hackathon
on an NVIDIA GB10 at 6,800 img/s and are gone; `docs/reports/kami-eye-results.md` keeps their
numbers, `docs/reports/kami-eye-next.md` the analysis this kit's recipe follows.

| Test drawings | n | kami-eye-next | kami-eye-xl |
|---|---|---|---|
| finished | 379,472 | **83.4 % / 95.3 %** | 83.1 % / 95.2 % |
| 90–100 % of the points | 54,144 | 82.8 % / 95.1 % | 82.7 % / 95.1 % |
| 70–90 % | 108,494 | 76.6 % / 92.3 % | 76.2 % / 92.1 % |
| 50–70 % | 108,390 | 59.8 % / 81.9 % | 60.0 % / 81.6 % |
| 30–50 % | 108,444 | 36.1 % / 59.5 % | 36.7 % / 60.0 % |

To ship a new model: `ml/retrain.sh publish --name <run>`, then put its tarball's URL and SHA-256
(from the release's `SHA256SUMS`) in `eye-release.json`; the next image build bakes it in.

## Retrain — one command, any machine

```sh
ml/retrain.sh setup                                 # uv env: MPS/CPU torch on macOS, CUDA on Linux+NVIDIA
ml/retrain.sh all --preset smoke --name smoke       # ~5 min: 8 categories end to end, a servable release
ml/retrain.sh bench --seconds 300 --hours 24        # this machine's img/s, and what fits in 24 h
ml/retrain.sh launch all --preset full --name kami-eye-next   # the real run, detached (below)
```

`retrain.sh` is a thin wrapper: `setup`, `launch`, `status`, `watch` and `stop` are its own; every
other word is a stage of `retrain.py`, run with the venv's Python (`uv run` would re-sync torch to
the lock file and undo a CUDA build that `setup` installed).

| Stage | What it does | Skipped when |
|---|---|---|
| `bench` | times the real training step (model, AdamW, autocast, loss scaling) per precision with `--sweep`; renders training looks on one core; prints hours for several corpus sizes and the `--drawings-per-class` that fits `--hours` | never |
| `data` | range-fetches the head of each category's `.bin` (250 B per wanted drawing, topped up for categories that come up short) into `data/bin/`, then indexes it | the bytes and the index are there |
| `train` | the resumable fit (below); ends with `model.pt` and `training.json` | `model.pt` exists |
| `calibrate` | validation and test tables by prefix bucket, regime temperatures, 95 %-precision floors (CONTRACT.md → Regimes), selection metric S, own-drawing recall — `assessment.json` | `assessment.json` exists |
| `export` | the release the sidecar serves: `model.onnx`, `labels.json`, `preprocess.json`, `golden.json`, `release.json` in a new immutable directory, then the `artifacts/<name>` link swapped | the release holds these weights |
| `exemplars` | the `/complete` exemplar set (`--min-probability 0.7`, see below) | a set for this model exists |
| `validate` | release hashes, golden parity, and a live sidecar answering `/health`, `/recognize` (the golden top-3) and `/complete` | never |
| `package` | `kami-eye-<version>.tar.gz` (the release, exemplars included), the weights, `MODEL_CARD.md` with the test tables, `SHA256SUMS` | the four files exist |
| `publish` | `gh release create eye-<version> …` with the package; `--dry-run` prints it | never (run it yourself) |
| `all` | train → calibrate → export → exemplars → validate → package | per stage |
| `status` | stages done, step, img/s, ETA, the last log lines | — |

Where things are: downloads and the index in `ml/data/` (`bin/`, `index/`), a run's state in
`ml/artifacts/runs/<name>/` (`recipe.json`, `checkpoint.pt`, `retrain.log`, `progress.json`,
`model.pt`, `training.json`, `assessment.json`, `package/`), its release at `ml/artifacts/<name>` —
a link to `ml/artifacts/.<name>-releases/release-…`, what `KAMI_EYE_MODEL` points at. All gitignored.

### Recipe, runtime, resume

The **recipe** (categories, drawings per class, epochs, batch, learning rate, arch, looks, eval
head, seed) is written to `recipe.json` when a run starts. Re-running any stage with the same
`--name` and no recipe flags continues that run; a contradicting flag is an error, never a silent
restart. The **runtime** (`--device`, `--precision`, `--workers`, `--checkpoint-minutes`,
`--probe-minutes`) may change between resumes, even to another machine.

Checkpoints (weights, AdamW, loss scaler, step, clocks, history) are written atomically every 15
minutes, at every epoch end, and on SIGINT/SIGTERM. The learning rate is a pure function of the step
and every batch a pure function of (seed, step), so a resumed run trains exactly the batches it would
have — a test checks that stop-and-resume ends bit-identical to an uninterrupted run. A crash, a
reboot or a flat battery costs at most the minutes since the last checkpoint.

Every minute `retrain.log` gets a line — `step 12,345/66,000 (18.7 %) epoch 1/1 loss 1.912 lr
1.46e-03 452 img/s trained 7h35 ETA 32h50 (Sat 09:14)` — and every hour (and each epoch end) a
probe of 13,800 validation looks: `validation top-1 … (finished …, prefixes …)`.

### The real run on a Mac, detached

```sh
ml/retrain.sh launch all --preset full --name kami-eye-next
ml/retrain.sh watch --name kami-eye-next      # tail -F of retrain.log (Ctrl-C stops watching only)
ml/retrain.sh status --name kami-eye-next     # stages done, step, img/s, ETA
ml/retrain.sh stop --name kami-eye-next       # checkpoints and exits; `launch` the same line to resume
```

`launch` runs the stage under `nohup` (it survives the terminal) inside `caffeinate -dimsu` on macOS
or `systemd-inhibit` on Linux (no idle or system sleep while it runs), and restarts `retrain.py` up
to five times after a crash, a minute apart; each restart resumes from the checkpoint. After a reboot,
run the same `launch` line again. On a MacBook: keep it on power and the lid open (a closed lid
sleeps whatever `caffeinate` says, unless an external display is attached), switch Low Power Mode
off, and expect a few percent less than a cold `bench` once it is warm.

### Per platform

| | Chosen by `--precision auto` and measured | Also |
|---|---|---|
| Apple Silicon (MPS) | fp32, contiguous. On the M4, fp16/bf16 autocast was 0.9–1.1× fp32, `channels_last` 0.4×, `torch.compile` 0.5× | `--workers 4` render on the CPU; the GPU is the limit |
| NVIDIA CUDA | bf16 autocast (fp16 + GradScaler on cards without bf16), `channels_last`, fused AdamW, cuDNN autotuning, TF32 | `--compile` (measure it with `bench --compile`); pinned host memory |
| CPU | fp32 (`--precision bf16` is allowed) | only for tests and smoke runs |

## The recipe, and why it beats kami-eye-xl

kami-eye-xl pre-rendered each drawing once into a 31 GB memmap: half of the drawings existed only
finished, half only as one fixed prefix, repeated identically for 10 epochs (68 M image passes over
6.83 M training drawings) with a small affine on the GPU. The kit renders **on the fly** in
DataLoader worker processes, from the `.bin` files and a small index (key_id, split, byte offset,
rank per drawing), with `render.py` still the only rasteriser:

- **Every pass is a new look.** Each image pass draws afresh: finished with probability 0.5,
  otherwise a prefix of U(0.3, 1.0) of the points (kami-eye-xl's mixture, so its prefix buckets stay
  comparable), then a rotation (±10°), shear (±0.1) and change of aspect (e^±0.1) **of the points**,
  before rendering. The renderer fits every drawing to its own bounds, so shifts and zooms in pixel
  space — what the GPU affine did — never occur at serving time; point-space re-shaping keeps every
  training image exactly what the sidecar would draw for such ink.
- **More drawings instead of more epochs.** Disk is the `.bin` bytes (~250 B a drawing), not 4 KB a
  rendered image, so 120,000 drawings per class cost ~10 GB instead of 170 GB. The full preset makes
  one pass over up to 120,000 recognised drawings per category (≈37 M training drawings, 5.5× xl's),
  every image seen once.
- **Rendering is free.** One M4 core renders ~1,700 training looks/s (decode, cut, re-shape,
  render; measured while other jobs loaded the CPU); the GPU takes 300–500. The default four workers
  are ample on the Mac; `bench` says how many a faster card needs.
- **Schedule.** AdamW (lr 1.5e-3 at batch 512, weight decay 0.02), 3 % linear warm-up from lr/25,
  cosine to lr/250,000 — OneCycle's envelope as a pure function of the step; label smoothing 0.1.
- **Evaluation stays comparable.** Validation and test drawings are those of their split among each
  category's first `--eval-head` (22,000) recognised drawings — exactly the drawings kami-eye-xl was
  validated and tested on — each read finished and as one prefix of U(0.3, 1.0) seeded by its
  key_id. So the test table has the same buckets (and twice xl's n per bucket), the alias folds and
  floors are fitted as before, and `MODEL_CARD.md` prints kami-eye-xl's numbers beside the new ones.

What was **not** taken from `kami-eye-next.md`: distillation (no teacher survives), ResNet-18D (0.94×
the step speed on MPS and ~+4 % latency for an expected +0.3–1.0), 4-view pre-rendering (subsumed by
fresh looks), embedding alignment and mixed precision on MPS (no speed-up there).

### Pilots on this M4 (30 categories, one seed, while other jobs shared the GPU)

Every arm trains on the same 30 categories (`angel … triangle`, every 11th of `all.txt`) and is
scored by the kit on the same held-out drawings (validation + test among the first 2,000 per
category: 5,957 finished drawings, 5,954 prefixes). Equal image passes (≈216 k) per arm.

| Arm | Recipe | Finished top-1 / top-3 | 50–70 % top-1 | 30–50 % top-1 |
|---|---|---|---|---|
| A10 | kami-eye-xl's pipeline and schedule: 800 drawings/class × **10 epochs**, fixed pre-rendered views, GPU affine | 89.4 % / 97.0 % | 74.6 % | 52.7 % |
| A | the same pipeline, 2,000/class × 4 epochs | 90.2 % / 97.4 % | 75.8 % | 54.4 % |
| B | the kit: fresh looks every pass, 2,000/class × 4 epochs | 90.7 % / 97.8 % | 76.4 % | 53.5 % |
| C | the kit: **8,000/class × 1 epoch**, every image unique | 90.7 % / 97.9 % | 77.1 % | 53.9 % |

The binomial standard error of a finished top-1 here is ~0.4 points. At equal compute, the kit's
one-pass recipe (C) beats kami-eye-xl's ten-epoch regime (A10) by 1.3 points on finished drawings
and 2.5 on half-drawn ones; up to about four epochs repetition costs little (A ≈ B ≈ C), which is
why the full run spends its hours on unique drawings rather than on a tenth pass. Also measured and
rejected: 48 px training for the early steps (only 1.3× faster on MPS), `torch.compile`,
`channels_last` and autocast on MPS (numbers below).

### Measured on this M4 (MacBook Air, 10-core GPU, 24 GB)

Measured with other agents' jobs sharing the GPU (it read 90–98 % busy before our runs started), so
treat these as lower bounds and run `ml/retrain.sh bench --seconds 300 --hours 30` on an idle,
plugged-in machine before launching. ResNet-18, batch 512, the real training step:

| Setting | img/s |
|---|---|
| fp32 (the default on MPS), quietest moment of the evening | 491 |
| fp32 / fp16 autocast / bf16 autocast, `bench --sweep` while shared | 321 / 353 / 341 |
| fp16 autocast, quietest moment | 440 |
| fp32 `channels_last` | 186 |
| fp32 `torch.compile` (inductor on MPS) | 234 |
| ResNet-18D, fp32 | 298 (0.94× ResNet-18 at the same moment) |
| batch 256 / 1024 | same as 512 / slower |
| training inside `train`, pilots (DataLoader, 3 workers, shared GPU) | 290–365 |
| inference (no grad), fp32 | ~1,200 |
| one CPU core rendering training looks from the corpus | 1,724 |
| `/recognize` through the sidecar, smoke model, keep-alive | 5.3 ms p50 |

kami-eye-xl's 68 M image passes would take 38–54 h here.

### The full run

`--preset full`: all 345 categories × up to 120,000 recognised drawings, one epoch, batch 512,
lr 1.5e-3, 50 % finished looks, eval head 22,000, seed 0 — ≈37 M image passes, 55 % of
kami-eye-xl's compute, every one a unique drawing in a fresh look.

| | |
|---|---|
| Training | 37.3 M passes: **21 h at 491 img/s, 29 h at 353 img/s** (the ETA line tracks the real rate) |
| Afterwards | ~1 h: assessment of 1.5 M held-out looks (~25 min), export, exemplars (~20–30 min on the CPU), validate, package |
| Download | ~10 GB of `.bin` heads (250 B per drawing; short categories topped up), once |
| Disk | ~10 GB data + ~1 GB index + checkpoints and releases (< 0.5 GB); no rendered dataset |
| Memory | ~3–4 GB (main process, four workers, page cache for the `.bin` files as it can) |

Expected accuracy: the pilots put the one-pass recipe ~1.3 points ahead of xl's regime at equal
compute, and kami-eye → kami-eye-xl gained ~1.1 points per doubling of compute, so 55 % of xl's
compute spent this way lands at about xl's 83.1 % or a little above — **~83–84 % finished top-1**,
with the half-drawn buckets gaining more. That is an estimate from a 30-category pilot, not a
promise. With more hours, give the run more drawings, not more epochs (few categories have many more
than 120 k recognised drawings; `--epochs 2` over 120 k costs twice as long and should add roughly
another point). `bench --hours H` prints `--drawings-per-class` for a budget; the recipe is fixed
once `train` starts.

## Serve a model

```sh
cd ml && KAMI_EYE_MODEL=artifacts/kami-eye-next uv run python sidecar.py      # :8790
curl -s localhost:8790/recognize -d '{"strokes":[[{"x":0,"y":0},{"x":90,"y":5},{"x":85,"y":90},{"x":0,"y":80},{"x":0,"y":0}]]}'
```

The game's server uses it with `KAMI_RECOGNIZER_URL=http://127.0.0.1:8790` (and `/complete` with
`KAMI_BEAUTIFY_URL=http://127.0.0.1:8790/complete`). The sidecar needs `numpy`,
`opencv-python-headless` and `onnxruntime` and never imports torch. `KAMI_EYE_PORT` changes the
port; `KAMI_EYE_MODEL` defaults to `artifacts/kami-eye`; `KAMI_EYE_HOST` (default `127.0.0.1`) is
what it binds, `0.0.0.0` inside a container; `KAMI_EYE_THREADS` caps ONNX Runtime's threads on a
shared host. `ml/Containerfile` packages the sidecar alone, and `docs/hosting.md` runs it beside the
game. `KAMI_EYE_MODEL=artifacts/<name> uv run --group dev pytest tests/test_golden.py` checks golden
parity of any release (the `validate` stage does the same and more).

Sidecar behaviour beyond the contract's table: `partial` selects the regime's temperature and floor
(CONTRACT.md → Regimes); `top` is 1–1000 and capped at K; a drawing with no points, non-finite or
absurd (> 1e9) coordinates, more than 256 strokes, 1024 points per stroke, 2048 points total, a body
over 262,144 bytes or anything outside the documented JSON is rejected before model execution
(`400 {"error"}`); unknown routes are `404 {"error"}`; an unexpected exception is `500 {"error"}` and
the process keeps serving. `/health` additionally reports `artifactId` (the release manifest
SHA-256) and `renderMatches: true`. Incompatible or incomplete releases fail startup; they never
serve predictions. One log line per request: `POST /recognize 200 5.3 ms`. The handler sets
`TCP_NODELAY`: the stdlib server writes headers and body separately, and a keep-alive client would
otherwise sit out a 40 ms delayed ACK on every request.

## Kami finishes your drawing — exemplars and `/complete`

`POST /complete` answers a rough sketch (and, optionally, the name the player gave it) with a clean
human drawing of the same thing from Quick, Draw!, chosen in the recogniser's own embedding space
and morphed onto the player's ink; the rules are in `CONTRACT.md` → Completion. It needs an exemplar
set next to the model, built once per trained model on the CPU (ONNX Runtime, no torch) by the
`exemplars` stage, or by hand:

```sh
cd ml && uv run python exemplars.py --model artifacts/<name> --min-probability 0.7
```

Switches: `--per-class 200`, `--candidates-per-class 1500` (the head of each `.bin`),
`--min-probability 0.9` (the contract's default), `--threads 6`, `--data-dir data`. The same model,
data and arguments write byte-identical files. `--min-probability` only decides categories that come
up short: candidates are ranked by probability, so a category with 200 drawings above 0.9 keeps the
same 200 at any lower bar. The 81 % model was rarely 0.9 sure of the plainest shapes (circle,
square), which look like many things; at 0.7 it filled 342 of 345 categories (69 k exemplars,
79 MB, 1,054 s for 517,500 candidates on the GB10's CPU), hence 0.7 in the kit. Retrain the model
and the set is stale: the sidecar notices (`modelSha256`), warns, and serves without `/complete`
until the set is rebuilt. Without an exemplar set `/complete` is `404` and the game keeps the
player's own ink. `morph_review.py` measures the morph on held-out drawings drawn as a player would.

## How it is put together

| File | |
|---|---|
| `retrain.py`, `retrain.sh` | the stages above; the wrapper that sets up, launches, watches and stops |
| `kit/recipe.py` | `Recipe` (what a run learns, fingerprinted), presets `smoke` and `full`, `Runtime` |
| `kit/corpus.py` | the index over the `.bin` files: label, byte offset, key_id, split, rank per drawing, memory-mapped; a pickled `Corpus` is two paths |
| `kit/looks.py` | finished or prefix, point-space re-shaping; the held-out looks |
| `kit/stream.py` | the epoch plan (a permutation per (seed, epoch)), the step sampler, the datasets that render whole batches in worker processes |
| `kit/trainer.py` | the resumable fit, checkpoints, stop signals, progress lines and probes |
| `kit/assess.py` | held-out reading, bucket tables, temperatures, floors, selection metric |
| `kit/devices.py`, `kit/bench.py` | what each machine trains fastest with; the measurements behind `bench` |
| `kit/verify.py`, `kit/release.py`, `kit/journal.py` | the `validate` checks; package, model card, `gh release`; the log and `progress.json` |
| `render.py` | the contract's rasteriser, plus `take_prefix` / `render_prefix`, `from_xy_arrays`, `to_model_input`, `image_sha256` |
| `quickdraw_bin.py` | `.bin` parser and writer; range-fetches the first N MB per category, cut back to whole records, with a manifest so nothing is fetched twice |
| `splits.py` | the split of a drawing: splitmix64 of its `key_id`, modulo 100 — < 90 train, < 95 validation, else test |
| `model.py` | `SketchNet`: torchvision `resnet18` with a 3×3 stride-2 stem and no max-pool, `forward -> (logits, embedding)`; `resnet18d`, `resnet34` |
| `metrics.py`, `calibrate.py`, `folding.py`, `selective.py`, `retrieval.py`, `selection.py` | bucketed top-1/top-3, temperature scaling per regime, alias folding, ECE and coverage at 95 % precision, own-drawing recall@10, the selection metric S |
| `export.py`, `artifacts.py`, `checkpoint.py` | ONNX export, `golden.json` and the release; bundle validation and atomic publication; a release back as a PyTorch model |
| `recognizer.py`, `sidecar.py` | artefact directory → recogniser; the stdlib HTTP server over it |
| `exemplars.py`, `exemplar_set.py`, `completion.py`, `likeness.py`, `pose.py`, `morph.py`, `morph_review.py` | `/complete`: the exemplar set, choosing an exemplar and pose, the morph, and its review |
| `latency.py` | a model's ONNX and `/recognize` latency against another's, interleaved in one process |

- **Stem: 3×3 stride 2, no max-pool**: ink is ~1.5 px wide after the 256 → 64 area-downsample, so
  one early stride loses little, and it is 4× cheaper than a stride-1 stem — ~5 ms CPU inference.
- **Fit**: points map to pixel centres 12 … 243 of the 256 canvas, rounded to whole pixels, so the
  picture is exactly centred and a mirrored sketch gives a mirrored image.
- **Prefixes** keep the first ⌈fraction × points⌉ points in drawing order (at least one) and are
  fitted to their own bounds.
- **`golden.json`**: 50 test-split drawings spread over the categories, every other one cut to a
  35/50/65/80 % prefix, in the sidecar's request shape, with the sha256 of `render(strokes)` and the
  top-3 of the exported ONNX through the sidecar's own code path.
- `renderSha256` is the sha256 of `render.py`'s bytes — any edit to that file, even whitespace,
  rejects older models at startup, so a model and its renderer can never drift.
- **Releases**: export builds a private directory, validates it, and atomically swaps the
  `artifacts/<name>` link; older releases stay for rollback. A plain directory at that name is never
  replaced. `release.json` binds the four files by SHA-256.

## Checks

```sh
cd ml
uv run --group dev --group train pytest -q     # render, .bin, corpus, looks, batches, the resumable
                                               # trainer, `retrain.py all` end to end on synthetic
                                               # drawings, sidecar routes, export, regimes, completion
uv run --group check ruff check . && uv run --group check ruff format --check . && uv run --group check mypy .
```

Without the `train` group the torch-dependent tests skip themselves.

## Serving: the sidecar and handwriting

`sidecar.py` serves two things, each optional: Kami's Eye over a trained artefact directory
(`KAMI_EYE_MODEL`) and the handwriting reader (`POST /read`, `KAMI_HANDWRITING_MODEL`) over two pinned
pretrained models, PP-OCRv5 English mobile and TrOCR-small-handwritten int8. `handwriting/` is its
code, [HANDWRITING.md](HANDWRITING.md) the design and the measurements behind it, [CONTRACT.md](CONTRACT.md)
the routes.

```sh
uv sync --no-default-groups                              # numpy, OpenCV headless, ONNX Runtime
uv run python -m handwriting.fetch models/handwriting    # 73 MB, checked against pinned SHA-256s
uv run python sidecar.py                                 # 127.0.0.1:8790; serves what it finds
```

The kami image runs this sidecar itself (the Bun server starts and supervises it with
`KAMI_SIDECAR=auto`); `Containerfile` here builds it alone. With the bundle fetched, `pytest` also
reads Kami's own pen strokes (`tests/fixtures/handwriting/`) through the real models.
