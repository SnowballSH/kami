# Reading handwriting on the CPU

Players write notes on the board with the pen ("gravity is low", "summon a rabbit", "teleport us to
the moon"). The sidecar turns those strokes into text with two small pretrained models under ONNX
Runtime, in the kami container, with no GPU and no external service. `POST /read` is its route
(CONTRACT.md); `POST /api/transcribe` on the Bun server is the game's (server/README.md →
"Handwriting reading").

## The pipeline (`handwriting/`)

1. **Lines** (`ink.split_lines`). Strokes whose vertical extents overlap form a band; a band shorter
   than 35 % of the tallest (the dots of i's, an underline) joins its nearest neighbour. Each band is a
   line of writing, read top first and joined with a space. More than four bands is not a note: the
   ink is read as one line.
2. **Rendering** (`ink.render_line`), the one rasteriser of handwriting: black ink on white paper,
   the line's ink scaled to 64 px tall (narrower when it would pass 2048 px wide), an 8 px margin,
   anti-aliased polylines 3 px thick, single points as dots of radius 2. Position and scale of the
   strokes do not matter.
3. **The screen**: PP-OCRv5 English mobile, a CTC recogniser, reads the line resized to 48 px high.
   If its typical symbol probability (geometric mean) is below **0.4**, or its text does not read as
   writing, the ink is a drawing: `null`, and the second model never runs. If its least sure symbol is
   at least **0.8**, its text is the answer.
4. **The reader**: TrOCR-small-handwritten (int8), a ViT encoder over the line squashed to 384 × 384
   and a greedy autoregressive decoder, reads what the screen was unsure of. Its answer stands if its
   typical token probability is at least **0.4**. IAM's transcription habits it learned are undone
   (`"moon ."` → `"moon"`, `"0. 3"` → `"0.3"`).
5. **Reads as writing** (`reader.reads_as_writing`): at most 80 characters, at least two different
   letters or digits — the Bun server's rule — and at least one letter: the wheels of a drawn bicycle
   read as "60" far more often than anyone writes a bare number.

Why two models: each is good where the other is not. The screen is fast (≈ 20 ms), reads neat
writing and symbols (`=`, which IAM never taught TrOCR) exactly, and rarely sees text in a drawing;
it fails on joined-up or messy writing. TrOCR reads messy writing far better but will find words in
almost any scribble (it read 64 % of drawings as text), and it "corrects" rare words toward English
("unicorn" → "uniform"). Screening with the first and reading with the second keeps the strengths of
both: 5 % of drawings read as text, and messy writing as well as TrOCR alone.

Both ONNX Runtime sessions run without a memory arena and without prepacked weights: prepacking
cost ~60 MB for ~10 % speed, and an arena keeps the memory of the longest line ever read.

## The bundle (`KAMI_HANDWRITING_MODEL`)

`python -m handwriting.fetch <directory>` (standard library only) downloads five files from pinned
Hugging Face revisions and checks each against its pinned size and SHA-256 (`handwriting/sources.py`)
before moving it into place; the sidecar checks them again at start-up and refuses altered files.
The container build runs it; locally, `uv run python -m handwriting.fetch models/handwriting` (the
sidecar's default, gitignored). 73 MB in all.

| File | From | Licence |
|---|---|---|
| `screen.onnx`, `screen-characters.txt` | `monkt/paddleocr-onnx` `languages/english/` — an ONNX conversion of `PaddlePaddle/en_PP-OCRv5_mobile_rec` | Apache-2.0 |
| `reader-encoder.onnx`, `reader-decoder.onnx`, `reader-tokenizer.json` | `Xenova/trocr-small-handwritten` `onnx/*_quantized.onnx` (dynamic int8), `tokenizer.json` — Microsoft's `trocr-small-handwritten` | MIT |

The screen's ONNX file is a third party's conversion, so it was checked against our own: converting
the official PaddlePaddle model with `paddle2onnx` 2.1.0 (opset 17) gives outputs within 6 × 10⁻⁷ of
it on random inputs of widths 64–800, and the same 436-character dictionary. Converting at build time
instead would need PaddlePaddle, which has no Linux arm64 wheel.

## How it was chosen (September 2026)

Short phrases written with a pen, rendered exactly as above, on an Apple M4 with ONNX Runtime 1.30 on
**one thread**. Test sets, each as strokes (skeletons of scanned ink traced into polylines, or real
pen strokes):

- **Kami's pen**: 306 phrases from Kami's own rules, scenes and summoning tests (`src/rules`,
  `src/summoning`, `src/reading`), written by the game's handwriting (`src/handwriting`, EMS
  Readability with its wobble).
- **Handwriting fonts**: the same 306 phrases in six handwriting fonts (Bradley Hand, Noteworthy,
  Chalkboard SE, Marker Felt, Comic Sans, Snell Roundhand), slanted, turned and jittered, skeletonised.
- **IAM lines**: 200 lines of the IAM Handwriting Database *test* split (`Teklia/IAM-line`), writers
  TrOCR never saw; **IAM short**: 49 of them cut to their first two or three words.
- **GNHK**: 200 runs of two to four words from the GoodNotes Handwriting Kollection test pages
  (CC BY 4.0), phone photographs of real notes in many hands — neither model's training data.
- **Drawings**: 240 Quick, Draw! drawings (16 categories, from ladders and fences to squiggles), of
  which 132 pass the client's `couldBeWriting` gate and so reach the reader.

Text is compared lower-cased with punctuation other than `= . % + -` dropped. Word accuracy is
1 − word error rate.

| Candidate | Size | IAM CER / words | IAM short | GNHK | Fonts CER / words / exact | Kami's pen | Drawings read as text | p50 latency | RSS added |
|---|---|---|---|---|---|---|---|---|---|
| PP-OCRv5 English mobile | 7.8 MB | 0.30 / 0.41 | 0.18 / 0.59 | 0.31 / 0.37 | 0.046 / 0.89 / 0.80 | 0.000 / 1.00 | 11 % | ≈ 20 ms | 30–60 MB |
| PP-OCRv5 multilingual mobile | 16.5 MB | 0.34 / 0.25 | | | 0.046 / 0.86 / 0.75 | | | ≈ 40 ms | |
| PP-OCRv5 multilingual server | 84 MB | 0.37 / 0.30 | | | 0.065 / 0.84 / 0.74 | | | ≈ 430 ms | ≈ 230 MB |
| TrOCR-small-handwritten, int8 | 63 MB | 0.12 / 0.77 | 0.10 / 0.87 | 0.28 / 0.53 | 0.036 / 0.89 / 0.72 | 0.017 / 0.94 | 64 % | ≈ 130 ms | 160–220 MB |
| TrOCR-small-handwritten, fp32 | 247 MB | | | | | | | ≈ 130 ms | ≈ 520 MB |
| **Screen + reader (served)** | 71 MB | 0.19 / 0.71 | 0.10 / 0.85 | 0.31 / 0.53 | 0.040 / 0.91 / 0.80 | 0.005 / 0.98 | **5 %** | 20–300 ms | ≈ 200–265 MB (the whole process) |

Latency and memory are for one line on one thread, the RSS added by loading and reading (TrOCR
without prepacked weights: with them it is ~60 MB larger and ~10 % faster). Blank cells were not
measured once a candidate was clearly out. TrOCR's IAM columns are its raw output, as IAM's references
keep IAM's spacing; its other columns undo that spacing. The multilingual
and server PP-OCRv5 models were worse than the English mobile one on handwriting; TrOCR-base (334 M
parameters, five times the compute) was not tried: it would not fit one second of one small core. Fine-tuning
either model on pen strokes would help the rare words ("sumikui") and messy writing most; it was out of
scope.

Floors were chosen on these sets to keep drawings read as text near 5 % while losing as little
writing as possible: with the screen floor at 0.5 drawings fall to 2.5 % but IAM word accuracy to
0.67; with the reader floor at 0 they rise to 6–7 % for +0.004 words.

## In the container (2 vCPUs, 4 GB, `KAMI_EYE_THREADS=1`)

The kami image, run hardened (`--read-only`, `--cap-drop=ALL`, `--userns=keep-id`) in a podman VM
with 2 vCPUs on the same M4. CPU time of one read inside the image, one thread, 98 requests (the
handwriting fonts, IAM short, GNHK, Kami's pen, drawings that pass the client gate):

| | CPU per read, p50 | max |
|---|---|---|
| Kami's pen | 39 ms | 0.68 s |
| handwriting fonts | 235 ms | 0.29 s |
| GNHK | 230 ms | 0.25 s |
| IAM short | 328 ms | 0.79 s |
| drawings | 6 ms | 10 ms |

Through `POST /api/transcribe` the wall time was the same plus a few milliseconds when the host was
quiet (0.2–0.6 s p50, under 1 s at most) and up to twice that while other work loaded the host. The
same 98 requests read 20/20 drawings as `null`, Kami's pen 10/10, the handwriting fonts 25/30 exactly
("the robot guards dice", "daylight - 0.1", "sunikui" among the misses), and GNHK and IAM short about
half exactly, with most of the rest one letter off.

The sidecar's resident memory is ≈ 210 MB idle (Python, numpy, OpenCV, ONNX Runtime and both models)
and settles near 260 MB after hundreds of reads (with ONNX Runtime's arena it grew past 310 MB). It
adds ≈ 400 MB to the image, uncompressed: Python 102 MB, numpy + OpenCV + ONNX Runtime 223 MB, the
models 76 MB. Kami's Eye, when mounted, shares the
process and adds its own model (ml/README.md).

## Re-evaluating

The evaluation harness is not part of the repository (it downloads IAM, GNHK and Quick, Draw!
samples); rebuild it from this description. What matters: render through `handwriting.ink`, read
through `handwriting.reader.HandwritingReader` with the pinned bundle, compare as above, and count
drawings only after the client gate (`src/reading/gate.ts`). A new model or new floors should beat
the served row on GNHK and IAM short without reading more drawings as text.
