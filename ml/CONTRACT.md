# Kami's Eye — the contract between training, serving and the game

One small raster CNN recognises sketches, finished or half-drawn. Everything that must agree between
the person who trains it, the process that serves it and the Bun server lives here.

## The tensor

`image` — float32 `[N, 1, 64, 64]`, ink = 1.0 on background 0.0, no mean/std normalisation.

Produced by **one function**, `ml/render.py: render(strokes) -> uint8 [64, 64]`, used by training and
by serving, so they cannot drift:

1. `strokes` is a list of strokes, each a list of `(x, y)` in any units, any scale, any position, y-down.
2. Drop empty strokes. Fit the bounding box of all points, aspect preserved, centred, into a 256×256
   canvas with a 12 px margin. A drawing that is a single point becomes a dot in the centre.
3. Draw every stroke as an anti-aliased polyline, thickness 6, white on black (`cv2.polylines`,
   `LINE_AA`); single-point strokes as filled circles of radius 3.
4. Downsample to 64×64 with `cv2.INTER_AREA`. Return uint8; the model input is that / 255.

A **prefix** (a drawing still under the pen) is rendered exactly the same way — fitted to *its own*
bounding box. Training makes half of all samples random prefixes (30–100 % of the points, in drawing
order), which is what lets one stateless model guess while the pen is still moving.

## The files a trained model ships as (`ml/artifacts/<name>/`)

| File | |
|---|---|
| `model.onnx` | input `image` as above; outputs `logits` float32 `[N, K]` and `embedding` float32 `[N, 512]` (the pooled features, not normalised). Opset 17, dynamic batch. |
| `labels.json` | array of K Quick, Draw! category names; index = logit index |
| `preprocess.json` | `{ "size": 64, "canvas": 256, "margin": 12, "thickness": 6, "temperature": T, "renderSha256": "<sha of render.py>", "trainedOn": "...", "top1": x, "top3": y }` — `temperature` from temperature scaling on held-out data, so probabilities mean what they say |
| `golden.json` | ~50 `{ "strokes": [...], "imageSha256": "...", "top3": [...] }` cases for parity tests |

## The sidecar (`ml/sidecar.py`, Python 3.12, ONNX Runtime CPU, stdlib HTTP)

Listens on `127.0.0.1:8790` (`KAMI_EYE_PORT`), loads `KAMI_EYE_MODEL` (an artifacts directory).

| Route | Request | Response |
|---|---|---|
| `GET /health` | | `{ "ok": true, "classes": K, "model": "<name>" }` |
| `POST /recognize` | `{ "strokes": [[{"x":1,"y":2},...],...], "partial": false, "top": 5 }` | `{ "labels": [...], "probs": [...] }` — best first, temperature-scaled softmax, `top` entries (default 5) |
| `POST /embed` | `{ "strokes": ... }` | `{ "embedding": [512 floats, L2-normalised] }` |

Strokes arrive raw, in world px; the sidecar owns rendering. Bad input → `400 {"error"}`; never a crash.

## The Bun server

`KAMI_RECOGNIZER_URL` (e.g. `http://127.0.0.1:8790`) selects the sidecar. `/api/recognize` asks it with a
short timeout; on timeout, error, or when unset it falls back to the built-in k-NN, so the client never
notices. Category names are merged through aliases ("birthday cake" → cake) and carry a physics nature
from the reviewed table in `server/natures/`. The public route's shape does not change except by addition.
