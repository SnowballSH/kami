# Kami server

Kami's memory and his eyes: a small Bun HTTP API over MongoDB. It remembers every board
(drawings, notes, rules), recognises sketches against Google's Quick, Draw! dataset, and can ask a
language model to compile physics notes the offline grammar did not understand.

Nothing in `src/` imports this directory. The browser reaches it through the thin clients in
`src/persistence` and `src/recognition`, on the same origin (`/api`, proxied by Vite in dev). If the
server is down, choose **Play without server** at startup (it is not remembered): recognition falls
back to geometry and model features return no answer.
Persistence failures are visible: reopening a board retains its in-session snapshot if available,
and a failed first load leaves the board editable with the failure shown. Failed writes stay in
the tab's outbox until explicitly retried; closing the tab can lose them.

Start with the [current integration guide](../docs/architecture.md) for ownership, gameplay flow,
controller wiring and verification limits, and [the trust model](../docs/access.md) for the two access
modes: `demo` (the default: an unauthenticated trusted LAN) and `shared`.

## Run

```sh
bun run dev                 # web + server together
bun run server              # server alone, http://localhost:8787, restarts on edits
PORT=8799 bun server/index.ts
```

With no configuration the server starts a real `mongod` (via `mongodb-memory-server`, binary cached
in `node_modules/.cache`) on `127.0.0.1:27117` with its data in `.kami-data/` (gitignored, or
`KAMI_DATA_DIR`), so boards survive restarts with zero setup. `Ctrl-C` / `SIGTERM` shuts the
`mongod` down cleanly. `GET /api/health` answers `200 {"ok":true}` as soon as the server listens, in
either access mode and without a session, for a container's health check.

### Self-hosting on a small shared box

Kami runs as one process (plus its `mongod`) behind a TLS reverse proxy such as Caddy, in a rootless
container if you like; `docs/access.md` has the trust model. What a 2-vCPU / 4 GB host shared with
other services needs:

- **Secrets as files.** Every secret-bearing variable — `KAMI_LLM_API_KEY`,
  `KAMI_TRANSCRIBE_API_KEY`, `KAMI_RECOGNIZER_API_KEY`, `KAMI_BEAUTIFY_API_KEY`, `MONGODB_URI`,
  `KAMI_CREDENTIALS`, `KAMI_PASSWORD` — may be given as `<NAME>_FILE`, the path of a file whose trimmed content is
  the value (podman/docker secrets, systemd `LoadCredential`). Setting both `X` and `X_FILE`, or
  naming a file that cannot be read, stops start-up with a message naming the variable.
- **Sketches without an ingest.** The Quick, Draw! corpus is a read-only file, not a collection:
  copy the `quickdraw.ndjson.gz` an ingest wrote and point `KAMI_QUICKDRAW_SNAPSHOT` at it. The
  image bakes one in with its features precomputed, so a container start reads 65 MB of features
  in well under a second and MongoDB holds boards alone ("Quick, Draw!" below).
- **Ranking off the event loop.** The built-in k-NN compares a sketch with ~50 000 rows
  (about 8 ms of arithmetic) on every pen lift and every 150 ms while drawing; it does so on a worker
  thread (`KAMI_RECOGNIZER_THREADS`, default 1; `0` ranks on the event loop as before) over one shared
  copy of the 65 MB sparse matrix. At most 32 drawings wait for a thread, and at most 4 of them live
  sketches: a newer live sketch replaces the oldest waiting one, which is answered with the empty
  "nothing to say yet" result the contract allows; with only finished drawings waiting, a live sketch
  gets that silence itself and a finished one is refused with **503** and `Retry-After: 1`. Measured
  on an M-series laptop with a synthetic 50 000-row matrix (`bun scripts/bench/recognizerLatency.ts`):
  at 25 live guesses a second the p99 lag of a 5 ms timer on the event loop fell from 19.8 ms to
  0.8 ms with one thread; at 100 a second (2.7× more than one thread can rank) from 21.9 ms to 1.1 ms,
  with guesses still answered in 51 ms median, 74 ms p99.
- **A small `mongod`.** The embedded one is started with `--wiredTigerCacheSizeGB` set to
  `KAMI_MONGO_CACHE_GB` (default `0.25`, the smallest WiredTiger allows; without it mongod takes half
  the machine's memory), with room for 1000 WiredTiger sessions instead of 33 000 (each preallocated;
  about 60 MB) and without diagnostic data collection.
- **Model budgets.** `KAMI_MODEL_REQUESTS_PER_MINUTE` / `KAMI_MODEL_CONCURRENCY` default to
  6000 / 32, sized for a LAN demo. For a public box behind a paid gateway set them to what the
  gateway and your wallet allow, e.g. `600` / `4`; `docs/access.md` has the reasoning.
- **Warm-ups.** At start-up the rules model is asked one question so a cold local model loads before
  the first player needs it; `KAMI_LLM_WARM_UP=off` skips it where every request costs money. The
  handwriting reader's single check always runs, because passing it is what enables
  `/api/transcribe`.
- **Static files.** The built game is served from memory with `br`/`gzip` compression negotiated per
  request and cached, immutable caching for hashed `assets/`, and `ETag` / `304` for `index.html`.

### Local models

Ollama can serve local models through the existing API without application code changes. The recipes in `scripts/local/` use Qwen3 4B Instruct for structured
rules and Qwen3.5 2B Q4 for handwriting, with four CPU threads, a 4096-token context and
deterministic sampling. On NixOS, use a recent Ollama package from Nixpkgs that supports these models.

Start Ollama with the following limits on a 16 GB laptop:

```sh
OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=30m ollama serve
```

In another terminal, from the repository root:

```sh
ollama pull qwen3:4b-instruct
ollama pull qwen3.5:2b-q4_K_M
ollama create kami-rules -f scripts/local/Modelfile.rules
ollama create kami-handwriting -f scripts/local/Modelfile.handwriting
```

Put the following in the repository's gitignored `.env.local` and restart `bun run dev`:

```dotenv
KAMI_LLM_URL=http://127.0.0.1:11434
KAMI_LLM_MODEL=kami-rules
KAMI_TRANSCRIBE_MODEL=kami-handwriting
```

NixOS's embedded MongoDB launcher also needs `MONGOMS_DISTRO=ubuntu-24.04` and a working
`nix-ld` environment for the downloaded binary, or `MONGOMS_SYSTEM_BINARY` pointing at a
Nix-packaged `mongod`. Run `bun run quickdraw:ingest` once for local sketch recognition,
then restart the API to load the samples. Handwriting is enabled only after the model passes
the startup image check. Each model gets up to two minutes for startup warmup on a CPU;
wait for `model is awake` and `handwriting reader is ready` in the server log. Interactive
rule and handwriting requests retain their 30-second and 35-second server deadlines; the browser
allows 40 seconds for handwriting so it receives the server's answer on a CPU-only machine.
The original trained Eye and tidying artifacts are separate from
the language model.

| Env | |
|---|---|
| `PORT` | HTTP port, default `8787` (what `vite.config.ts` proxies `/api` to) |
| `KAMI_TLS_CERT` / `KAMI_TLS_KEY` | Enable the optional HTTPS listener when both are non-empty; certificate and private-key files. |
| `KAMI_TLS_PORT` | HTTPS port, default `8443`. |
| `KAMI_ACCESS_MODE` | `demo` (default, trusted LAN only) or `shared` (scoped authentication). Unset with `KAMI_PASSWORD` set means `shared`; `demo` beside a password stops start-up. See [access and deployment](../docs/access.md). |
| `KAMI_PASSWORD` | One password for the whole server: setting it switches on `shared` mode, and signing in with it grants every board, every controller and the models. Surrounding whitespace is ignored; at most 1024 characters. Prefer `KAMI_PASSWORD_FILE`. May sit beside `KAMI_CREDENTIALS` (the gate then asks for the password; scoped tokens keep working for devices and scripts), but must differ from every token. |
| `KAMI_TRUSTED_PROXIES` | Comma-separated IP addresses, default `127.0.0.1,::1`. When a sign-in comes from one of these, the last `X-Forwarded-For` entry names the client whose failed attempts are counted. Used for sign-in throttling only, never for authorization. Empty trusts none. |
| `KAMI_BIND_HOST` | HTTP bind address: `0.0.0.0` in demo, `127.0.0.1` in shared mode. |
| `KAMI_WEB_HOST` | Vite development bind address, default `0.0.0.0`; use `127.0.0.1` for local-only development. |
| `KAMI_ALLOWED_ORIGINS` | Comma-separated exact origins, no trailing slash or wildcard. Shared mode requires HTTPS origins, or loopback ones (`http://localhost:5173`) for trying it on one machine. Demo also permits same-origin requests. |
| `KAMI_CREDENTIALS` | Shared-only JSON credentials with `id`, `token`, `boards`, `controllers`, and `models` grants; keep outside version control. Required in shared mode unless `KAMI_PASSWORD` is set. |
| `KAMI_MODEL_REQUESTS_PER_MINUTE` | Positive integer, default `6000`, shared across all model routes and callers per process. One iPad posts a live guess and a handwriting read on every pen lift — several a second while drawing — so the default leaves room for a few devices on a LAN; a public box behind a paid gateway wants far less (`600`; see `docs/access.md`). |
| `KAMI_MODEL_CONCURRENCY` | Positive integer, default `32`, held through complete model responses. Requests over the limit are refused with `429`, not queued. `4` is plenty on a shared 2-vCPU host. |
| `MONGODB_URI` | Use this MongoDB instead of the embedded one, e.g. the Atlas `mongodb+srv://…` string. Database `kami`. May be given as `MONGODB_URI_FILE`. |
| `KAMI_DATA_DIR` | Where the embedded `mongod` keeps its data, default `<repo>/.kami-data`; also where the Quick, Draw! corpus is by default, and where its feature index is cached when it cannot be written beside the corpus. Mount a volume there in a container. |
| `KAMI_MONGO_CACHE_GB` | The embedded `mongod`'s WiredTiger cache in GB, default `0.25` (its minimum); ignored with `MONGODB_URI`. |
| `KAMI_QUICKDRAW_SNAPSHOT` | The Quick, Draw! corpus the k-NN learns from and summons out of: the gzipped NDJSON file `bun run quickdraw:ingest` writes, default `$KAMI_DATA_DIR/quickdraw.ndjson.gz` (the image sets its baked copy). Read-only; its features are cached beside it (see "Quick, Draw!"). |
| `KAMI_LLM_URL` | An OpenAI-compatible server for `/api/compile`, `/api/scene` and `/api/transcribe`: a root (`http://127.0.0.1:11434`), a `/v1` base, or the full `/v1/chat/completions` URL. vLLM, Ollama, llama.cpp, OpenAI itself and gateways in front of Anthropic all work; see "Model-backed compile" for how the client learns what each accepts. |
| `KAMI_LLM_MODEL` | Compiler model name; also the fallback handwriting model. Compilation is **off** unless both URL and model are set. |
| `KAMI_LLM_API_KEY` | Optional bearer token; may be given as `KAMI_LLM_API_KEY_FILE`. |
| `KAMI_LLM_REASONING_EFFORT` | What to ask for as `reasoning_effort`: `none` (default), `minimal`, `low`, `medium`, `high`, `xhigh`, or `off` to never send the field. Anything else stops start-up. A server that rejects the field is asked again without it, once, and remembered. |
| `KAMI_SIDECAR` | `auto` starts `ml/sidecar.py` beside the server and supervises it (the image's default); `off` or unset does not. Anything else stops start-up. See "Handwriting reading". |
| `KAMI_SIDECAR_PYTHON` / `KAMI_SIDECAR_PORT` | The Python the sidecar runs with (default `ml/.venv/bin/python` if it exists, else `python3`) and its loopback port (default `8790`). |
| `KAMI_HANDWRITING_MODEL` | The handwriting bundle the sidecar loads (default `ml/models/handwriting`; the image bakes one in at `/app/models/handwriting`). |
| `KAMI_EYE_MODEL` / `KAMI_EYE_THREADS` | Passed to the managed sidecar: Kami's Eye artefact directory (default `ml/artifacts/kami-eye`; `/models/kami-eye` in the image — the server recognises with the sidecar only when it exists) and ONNX Runtime threads (a positive integer; unset leaves Runtime its default, the image says `1`). |
| `KAMI_HANDWRITING_URL` | The sidecar whose `POST /read` reads handwriting, first choice over the vision model. Unset: the managed sidecar, else `KAMI_RECOGNIZER_URL`'s. `off`: never a sidecar. |
| `KAMI_HANDWRITING_API_KEY` | Sent as `Authorization: Bearer` to that sidecar; may be given as `KAMI_HANDWRITING_API_KEY_FILE`. Defaults to `KAMI_RECOGNIZER_API_KEY` only when the URL is the recogniser's. |
| `KAMI_TRANSCRIBE_URL` / `KAMI_TRANSCRIBE_MODEL` / `KAMI_TRANSCRIBE_API_KEY` / `KAMI_TRANSCRIBE_REASONING_EFFORT` | The handwriting vision model, used only when no sidecar reader passes its check; each falls back to its `KAMI_LLM_*` counterpart, so a different model on the same server needs only `KAMI_TRANSCRIBE_MODEL`, and a different server sets `KAMI_TRANSCRIBE_URL` (and its own key, or it inherits the LLM's). The key may be given as `KAMI_TRANSCRIBE_API_KEY_FILE`. Start-up must correctly read a known PNG before it is used — a text-only gateway fails the check and is simply not used. With no reader ready the route returns **501**. |
| `KAMI_LLM_WARM_UP` | `off` skips the rules model's one start-up question ("hello"), which only serves to load a cold local model; the handwriting image check still runs once. |
| `KAMI_RECOGNIZER_URL` | The Kami's Eye sidecar (`ml/CONTRACT.md`), used for `/api/recognize` with the k-NN as its fallback; unset, the managed sidecar (`KAMI_SIDECAR=auto`) when a model is at `KAMI_EYE_MODEL`, else the k-NN alone; `off` means the k-NN alone. |
| `KAMI_RECOGNIZER_API_KEY` | Sent as `Authorization: Bearer` to the sidecar, for one behind an authenticating proxy or on another host; may be given as `KAMI_RECOGNIZER_API_KEY_FILE`. |
| `KAMI_RECOGNIZER_THREADS` | Worker threads ranking sketches for the built-in k-NN, default `1`; `0` ranks on the event loop. See "Self-hosting" above for the queue. |
| `KAMI_BEAUTIFY_URL` | Where `/api/beautify` forwards to. Unset with `KAMI_RECOGNIZER_URL` set, it is the sidecar's `<KAMI_RECOGNIZER_URL>/complete` (the Eye serves both) with the recogniser's key; `off` keeps the player's own ink (**501**). |
| `KAMI_BEAUTIFY_API_KEY` | Sent as `Authorization: Bearer` to the beautifier; may be given as `KAMI_BEAUTIFY_API_KEY_FILE`. Defaults to `KAMI_RECOGNIZER_API_KEY` only when the URL is derived from the recogniser's. |
| `KAMI_SKETCHES` | The Eye's exemplar set directory (`ml/CONTRACT.md`; `<artifacts>/kami-eye/exemplars` beside the trained model), whose clean drawings `/api/exemplar` summons by name across all 345 categories. Unset, summons come from the ingested Quick, Draw! samples, then from Quick, Draw! itself, for the curated categories only. |
| `KAMI_CONTROLLER_UDP_PORT` | UDP port physical controllers send to, default `8788`; `off` disables. See `docs/controllers.md`. |
| `KAMI_CONTROLLER_SERIAL` | `auto` (default: every `/dev/ttyACM*`, rescanned every 3 s), a device path, or `off`. The user needs the `dialout` group. |

## Routes

| Route | Answer |
|---|---|
| `GET /api/health` | `{ ok: true }` — the server is up; no session needed in either mode, nothing else disclosed |
| `GET /api/session` | `{ mode, authenticated, boards, controllers, secret, unrestricted }`; anonymous callers receive no grants. `secret` is what the gate asks for — `"password"`, `"token"`, or `null` in demo mode; `unrestricted` is true when the session reaches every board and controller (demo, or the password), whose lists are then empty |
| `POST /api/session` | Exchange `Authorization: Bearer <token>`, or the body `{ "password": "…" }` (JSON) when `KAMI_PASSWORD` is set, for an eight-hour secure HTTP-only session cookie. `401` for a wrong secret; `429` with `Retry-After` after 30 attempts a minute in all, or 10 failures from one client in 15 minutes |
| `DELETE /api/session` | Revoke the current browser session and clear its cookie |
| `GET /api/boards` | `{ boards: BoardSummary[] }` |
| `GET /api/boards/:board` | `{ drawings: StoredDrawing[], notes: Note[], rules: Rule[] }`, oldest first; an unknown board is empty |
| `PUT /api/boards/:board/{drawings,notes,rules}/:id` | upsert; the body is the client's object and its id must match the path |
| `DELETE /api/boards/:board/{drawings,notes,rules}/:id` | remove one (idempotent) |
| `DELETE /api/boards/:board` | clear the board |
| `GET /api/boards/:board/events?peer=<id>[&since=<seq>]` | Server-Sent Events: every put/delete/clear on the board as it happens, numbered; who else is on it. See the API contract below. |
| `POST /api/boards/:board/presence` `{ peer, alice }` | `204`; where this device's Alice is, relayed to everyone else on the board |
| `POST /api/recognize` `{ strokes: {x,y}[][], partial?: boolean }` | Structured parallel arrays plus `certain`; at most three, best first. See the API contract below. |
| `POST /api/beautify` `{ strokes, name? }` | Upstream model response; the current browser validates point-for-point `{ tidied, added, category, confidence }` into its `Completion` type. |
| `POST /api/compile` `{ text }` | `{ rule: CompiledRule \| null }` |
| `POST /api/scene` `{ text }` | `{ scene: Scene \| null }` — a place as a bundle of laws and props Kami draws ("Scenes" below) |
| `POST /api/controllers/:id/state` `<x> <y> [buttons]` (plain text) | `204`; a joystick's whole state, axes -100 … 100 with y up (`docs/controllers.md`) |
| `GET /api/controllers/:id/events` | Server-Sent Events: `{ x, y, held, buttons }` on connect and on every change |
| `GET /api/controllers` | `[{ id, x, y, held, buttons, transport, idleMs }]` |
| `WS /api/stage/:stage?role=source\|screen` | The big screen: playing devices show what they render, a monitor on `/?screen` watches whichever is in use (`docs/screen.md`) |
| `POST /api/transcribe` `{ strokes: {x,y}[][] }` | `{ text: string \| null }` — the strokes read as handwriting, `null` for a drawing; `501` without a reader |
| `GET /api/exemplars` | `{ categories: string[] }` — every Quick, Draw! category a drawing can be summoned for |

Entity/model JSON bodies are validated with Zod (`schemas.ts` re-exports the browser-safe entity
schemas in `src/persistence/schemas.ts` and defines request-specific schemas). Controller text has
its own parser. Invalid values return `400`; excessive body bytes return `413` before JSON parsing.
Entities are loose objects: unknown additive fields are stored and returned untouched. Origin policy,
credentials and board/controller grants are enforced before route handling; shared credentials
restrict listings too. See [the trust model](../docs/access.md) before exposing a server beyond a
trusted demo LAN.

Collections `drawings`, `notes`, `rules` hold the client's objects as they are plus `boardId`
(and, for drawings, a top-level `id` copied from `drawing.id`), with a unique `{ boardId, id }`
index. `_id` and `boardId` never leave the server.

Drawing labels carry an optional `Note.drawingId`, a board-local deletion association. The client
removes those labels on rename, erase, consumption or devouring, including after reload. Older notes
without it remain unassociated; their target is not guessed from their text or position. This does
not make labels follow moving drawings. Passing remarks and guess notes remain transient.

## Quick, Draw!

```sh
bun run quickdraw:ingest          # 300 drawings per category (default)
bun run quickdraw:ingest 600      # or another N
bun server/quickdraw/evaluate.ts
```

`ingest` range-fetches the first 1.5 MB of
`https://storage.googleapis.com/quickdraw_dataset/full/simplified/<category>.ndjson` for the 42
categories in `quickdraw/categories.ts` (chosen because the Cat's lexicon can use them: mushroom,
ladder, stairs, cloud, hot air balloon, cake, wine bottle, key, door, …, plus the plain shapes),
keeps `recognized: true` drawings, drops the line the byte range cut short, takes the first N and
writes them to the **corpus**, `KAMI_QUICKDRAW_SNAPSHOT` (default `.kami-data/quickdraw.ndjson.gz`):
gzipped NDJSON, one `{ category, keyId, drawing }` per line, sorted (`quickdraw/snapshotFile.ts`;
1.4 MB for N = 300). Each run replaces the file, so a smaller N or a shorter category list is simply
what remains. About 25 s for N = 300, then it builds the feature index below so the next start is
fast. **Restart the server afterwards** — the corpus is loaded once, at startup. The server only
reads the file; nothing about sketches lives in MongoDB. A database from before this change still
holds a `quickdraw` collection: the server drops it on its first start (and logs that it did), so
run the ingest once to recreate the corpus as a file if `.kami-data` has none.

**Feature index.** Features are derived, never stored in the corpus, so they cannot drift from the
code. `quickdraw/corpus.ts` computes them once (2–3 s for 12 600 drawings, peaking around 0.5 GB)
and caches them as `quickdraw.features.bin` beside the corpus, or in `KAMI_DATA_DIR` when that
directory is read-only; `quickdraw/indexFile.ts` has the layout. The cache is keyed by a SHA-256 of
the corpus file, the index format and a fingerprint of the features a few fixed drawings get, so a
changed corpus or a change to `feature.ts`/`prefix.ts` recomputes it on the next start without
anyone remembering to. Reading it is a few `read`s straight into shared memory: 30 ms. The container
build precomputes it, so a container start never computes features.

The feature (`quickdraw/feature.ts`, shared by ingest and `/api/recognize`): strokes are fitted to
a 24×24 grid by their bounding box (aspect kept, centred, 1.5-cell margin), rasterised with
bilinear line drawing, blurred once with a 3×3 binomial kernel and L2-normalised, so a dot product
is cosine similarity. Player strokes in world px and the dataset's 0–255 grid go through the same
code, which makes recognition independent of where and how large something was drawn.

**Half-finished drawings.** So that the same index can guess while the pen is still moving, every
drawing is indexed at each share of its points in `PREFIX_FRACTIONS` (`quickdraw/prefix.ts`: 20 %,
35 %, 65 % and 100 %). `prefixOfStrokes` takes the first share of the points in drawing order
across strokes, keeps stroke boundaries and cuts the stroke under the pen short; each prefix is
then fitted to *its own* bounding box, exactly as a half-drawn sketch arrives from the player.
Shares that cut a short drawing at the same point are indexed once. 12 600 drawings become 50 206
rows. A feature is mostly empty paper — 37 % of the cells are non-zero — so the matrix keeps only
those, with their cell numbers: 65 MB instead of 116 MB of dense `Float32Array`. Features are never
negative, so summing over the non-zero cells in order gives bit for bit the dense dot product (every
skipped term adds zero); on 10 800 queries against the real corpus the sparse and dense rankers
agreed exactly, and the sparse one is 2.2–2.8× faster.

The recogniser (`quickdraw/recognizer.ts`) keeps every feature in one sparse matrix
(`quickdraw/featureMatrix.ts`), whole drawings first, and does brute-force cosine k-NN: k = 15, each neighbour votes for its category
with weight similarity⁸, categories are ranked by vote share (the `confidence` the route returns),
and up to three with a share of at least 0.08 are returned. If the single best neighbour is below
0.35 similarity the answer is `[]`. `rank(strokes, { partial })` is synchronous; `read(strokes,
{ partial })` is the same ranking with the vote share above which it may go unasked (`certainAbove`,
see "Naming without asking"), and `recognition/inProcessRanker.ts` wraps that in the promise-returning
shape the recogniser chain speaks.

- **Finished** (`partial` absent or false): compared with the whole-drawing rows only. Same answers
  as before prefixes existed, 2.6 ms per sketch.
- **Still under the pen** (`partial: true`): compared with every row, 7.8 ms per sketch. Too few
  points is never a reason to refuse, but the answer is `[]` unless the leading category holds at
  least 0.6 of the vote (`partialLeaderFloor`) — Kami takes most of a second to write a guess, so a
  live guess has to be worth writing.

### Measured accuracy

`evaluate.ts` fetches, for each category, the next 50 recognised drawings that are **not** in the
corpus (42 × 50 = 2100), shows the recogniser the first 20/40/60/80/100 % of each one's points
as a live guess and the whole drawing once more as a finished one, and scores the answers as the
route would give them (floors included). *Top-1/top-3* ignore the live silence floor, to show what
the ranking knows; *speaks* is how often the live floor lets an answer out and *right when it
speaks* how often that answer's first guess is correct. The last column is the reliability of a
high confidence: how often the leader reaches 0.8, and how often it is right when it does. Index:
42 categories × 300, indexed at 20/35/65/100 %. Single-threaded on an Apple M4, other work running.

| Ink shown | Top-1 | Top-3 | Speaks (leader ≥ 0.6) | Right when it speaks | Confidence ≥ 0.8: how often / right | Per query |
|---|---|---|---|---|---|---|
| 20 %, live | 18.0 % | 38.1 % | 6.2 % | 30.8 % | 1.6 % / 48.5 % | 19 ms |
| 40 %, live | 32.7 % | 57.9 % | 13.0 % | 59.0 % | 3.6 % / 66.7 % | 19 ms |
| 60 %, live | 47.3 % | 69.0 % | 23.0 % | 81.5 % | 8.1 % / 91.8 % | 19 ms |
| 80 %, live | 58.2 % | 78.6 % | 30.4 % | 85.9 % | 13.0 % / 95.2 % | 19 ms |
| 100 %, live | 62.0 % | 81.0 % | 35.4 % | 89.0 % | 15.0 % / 98.1 % | 19 ms |
| 100 %, finished | **65.1 %** | **82.9 %** | always | 65.1 % | 25.3 % / 95.5 % | 4.8 ms |

The per-query times predate the sparse matrix, which gives the same answers in 2.6 ms (finished) and
7.8 ms (live) on the same kind of machine.

Over all 10 500 live trials a stated guess is right **79.6 %** of the time and one is stated 21.6 %
of the time. The floor is a trade (`evaluate.ts` prints the sweep): ≥ 0.5 speaks 32.4 % / right
72.7 %, ≥ 0.6 21.6 % / 79.6 %, ≥ 0.7 13.8 % / 86.3 %, ≥ 0.8 8.3 % / 91.4 %. The vote share does not
know how much of the drawing it is looking at, so the rare early answers are the unreliable ones
(a first stroke looks like a finished `line`); from 60 % of the ink on, four stated guesses in five
are right. A client that wants to be surer can wait for a returned confidence of 0.8.

What the prefix rows cost and buy, all measured the same way:

| Index | 20 % | 40 % | 60 % | 80 % | 100 % | Live answers at equal precision |
|---|---|---|---|---|---|---|
| whole drawings only (measured before this change) | 5.4 / 13.1 | 18.5 / 32.4 | 37.3 / 57.7 | 58.0 / 78.1 | 65.1 / 82.9 | — |
| + 35 %, 65 % rows, searched for every query | 14.5 / 30.8 | 35.0 / 60.4 | 49.5 / 71.4 | 60.5 / 80.4 | 63.3 / 81.7 | 27.7 % speak at 72.7 % right |
| + 20 %, 35 %, 65 % rows (now) | 18.0 / 38.1 | 32.7 / 57.9 | 47.3 / 69.0 | 58.2 / 78.6 | 62.0 / 81.0 live, **65.1 / 82.9** finished | 32.4 % speak at 72.7 % right |

Searching the prefix rows for a finished drawing costs 1.8–3.1 points of top-1 and four times the
query time, which is why finished drawings are compared with whole drawings only and keep 65.1 /
82.9. The 20 % rows cost the live ranking about two points in the middle of a drawing but teach
the index what a first stroke looks like in every category: without them high-confidence answers
at 20 % ink were right 17 % of the time instead of 48 % and three times as frequent, and on a
700-sketch subsample 17 of the 28 confident wrong answers at 20 % ink were "line". On the same
subsample more neighbours (k = 30), a sharper vote (16) and also gating on how finished the
neighbours were did not improve the speak/right trade, so they were left out.

Finished drawings, per category (top-1/top-3) — best: line 92/96, door 88/98, fence 88/92, circle
86/90, stairs 82/88, triangle 82/88, wine bottle 80/90, ladder 76/84, hot air balloon 76/94,
mushroom 68/88. Worst: zigzag 20/40 and bird 22/32 (drawn too many ways for a raster match),
birthday cake 44/74 and cake 52/88 (they steal each other's votes; the Cat maps both to "a cake").
N = 600 only bought +2 points for twice the memory and query time, so 300 is the default. k from 5
to 25 and the vote exponent from 1 to 16 move the numbers by about a point. The trained model
(`ml/CONTRACT.md`) replaces the k-NN behind the same route when its sidecar answers; this stays as
the fallback.

## Model-backed compile

`compile/llmCompiler.ts` posts the note to `<KAMI_LLM_URL>/v1/chat/completions` with a system
prompt (`compile/prompt.ts`) that lists every `RuleEffect` variant with its unit and range and asks
for `{"effect": …, "explanation": …}` or `{"effect": null}`. The reply may be wrapped in prose or
code fences; the outermost JSON object is parsed, validated against the raw effect union and
clamped (`compile/effectRanges.ts`): gravity ±30 g per axis, wind ±3 g, timeScale
0.1–3, airDrag and friction 0–10, bounciness 0–1. A missing gloss is written for it. Timeouts
(30 s server request, 35 s browser request), HTTP errors, garbage and unknown settings all become
`null`, which the client treats as "not a rule". Persistence uses the refined effect-domain schema;
raw model values are clamped before they reach it. Injected-fetch and fake-server tests establish
transport/parsing behavior, not real model quality. Model quality is measured separately, against the live model.

### One client, many servers

`llm/chatClient.ts` speaks to whatever stands at `KAMI_LLM_URL`, and servers disagree about the
optional fields. vLLM, Ollama and llama.cpp take `response_format` with a JSON schema; a gateway in
front of Anthropic (modelgate) rejects `response_format` outright with a 400 but takes
`reasoning_effort`; OpenAI's gpt-5 family rejects `max_tokens` (wanting `max_completion_tokens`),
any `temperature` but the default, and `reasoning_effort: "none"` on the models that predate it.
Rather than pick a dialect per vendor, the client starts with everything — `temperature: 0`,
`max_tokens`, `reasoning_effort` (`KAMI_LLM_REASONING_EFFORT`, default `none`) and
`response_format: json_schema` — and on each 400 drops one feature (`llm/requestShape.ts`): the one
the error message names when it names a field we send, otherwise the next in an order that gives up
the least first — `json_schema` → `json_object` → no `response_format`, then reasoning control, then
`max_tokens` → `max_completion_tokens`, then the temperature. The shape that finally works is
remembered by that client for the rest of the process, so the learning costs a handful of cheap
rejections once, not once per request; a request that is still refused with nothing left to drop
(a text-only gateway shown an image, say) is `null` after at most six attempts. The compiler, the
scene compiler and the handwriting reader each have their own client, so a vision model on another
server learns separately.

The schema each client sends is written for the strictest of them, OpenAI's strict structured
outputs (`llm/strictJsonSchema.ts`): `anyOf` instead of `oneOf`, every object closed and every
property required, an optional field spelled as a nullable one (so the reply schemas take `null`
wherever a field may be left out), no string-length bounds. And OpenAI refuses `json_object` mode
unless the input says "JSON". The system prompts say it, but a gateway that speaks OpenAI's
Responses API upstream (modelgate does, for its OpenAI models) moves system messages out of the
input into `instructions`, where that check does not look; so in `json_object` mode, when no user
message mentions JSON, the client adds "Reply with a JSON object." to the last one. A server that
still refuses a step falls down the same chain.

## Handwriting reading

`/api/transcribe` lets the player write with the pen instead of the text prompt. Two readers can
answer it, tried in this order at start-up (`transcribe/transcriber.ts`, `transcribe/chain.ts`): the
first whose start-up check passes reads from then on, and the log says which
(`handwriting reader is ready: local reader (http://127.0.0.1:8790)`).

1. **The sidecar's local reader** (`transcribe/sidecarTranscriber.ts`): `POST /read` on a Kami
   sidecar (`ml/CONTRACT.md`), which renders the strokes and reads them with two small pretrained
   models on the CPU, no external service (`ml/HANDWRITING.md`). Where: `KAMI_HANDWRITING_URL`; unset,
   the sidecar the server runs itself (`KAMI_SIDECAR=auto`, below); else `KAMI_RECOGNIZER_URL`'s
   sidecar with its key. `KAMI_HANDWRITING_URL=off` skips it. Its check: the sidecar's `/health`
   reports `capabilities.handwriting` (polled for up to two minutes while it starts) and it answers one
   read. Reads go one at a time, eight at most waiting: every pen lift asks about the ink so far and
   withdraws the question before it, and a withdrawn read that has not started is dropped unsent
   (`transcribe/serialQueue.ts`). A read has 10 s.
2. **A vision model**: `transcribe/llmTranscriber.ts` draws the strokes black-on-white into a small
   grayscale PNG (`transcribe/strokeImage.ts`, a line of writing fitted to 64 px tall, no image library)
   and shows it to `KAMI_TRANSCRIBE_MODEL` (falling back to `KAMI_LLM_MODEL`) through
   `llm/chatClient.ts`, the OpenAI-compatible client `/api/compile` also uses, with
   `reasoning_effort: "none"` (`KAMI_TRANSCRIBE_REASONING_EFFORT`, falling back to the LLM's) so it
   answers in one breath (about 2 s warm on a local GPU; a `400` from a server that does not know the field
   retries without it — "One client, many servers" above). The prompt (`transcribe/prompt.ts`) asks for
   `{"text": "…"}` for words and `{"text": null}` for a drawing. Its check is reading a known image of
   "HI"; a text-only gateway fails it and is simply not used for handwriting.

Either answer must read as writing (`transcribe/types.ts`: ≤ 80 characters, at least two different
letters — a fence once came back as `IIIIII`). Anything else, a timeout, an HTTP error or an abort is
`null`: the strokes stay ink. With no reader ready the route returns `501`. `/api/transcribe` forwards
the request's abort signal to stop an obsolete client wait; that does not guarantee a model cancels
work already accepted.

### The sidecar the server runs itself

`KAMI_SIDECAR=auto` (the image's default; off otherwise) makes the server start `ml/sidecar.py` as a
child process (`sidecar/supervisor.ts`) on `127.0.0.1:KAMI_SIDECAR_PORT` (8790) with
`KAMI_SIDECAR_PYTHON` (default `ml/.venv/bin/python`, else `python3`), `KAMI_EYE_THREADS`,
`KAMI_EYE_MODEL` and `KAMI_HANDWRITING_MODEL`, and none of the server's secrets. Its log lines appear
in the server's prefixed `sidecar:`; if it exits it is started again after 1 s, doubling to at most
60 s, back to 1 s after a run of a minute; on shutdown it gets `SIGINT`, then `SIGKILL` after 1.5 s, and a server that dies without stopping it takes it along (`KAMI_SIDECAR_PARENT_PID`). The
same sidecar serves Kami's Eye when a model is at `KAMI_EYE_MODEL`: `/api/recognize` and
`/api/beautify` then use it unless `KAMI_RECOGNIZER_URL` / `KAMI_BEAUTIFY_URL` say otherwise.

Outside the image: `cd ml && uv sync --no-default-groups && uv run python -m handwriting.fetch
models/handwriting`, then `KAMI_SIDECAR=auto bun run dev`.

## Summoning

`sketch/` holds the clean drawings behind `/api/exemplar`, which the game draws in when the player
writes `summon a rabbit` or `a house, a tree and the sun`. With `KAMI_SKETCHES` it reads the Eye's
exemplar set (`ml/CONTRACT.md`: plain `.npy`, one contiguous window per category, best first;
`sketch/npy.ts` reads the integer arrays, `sketch/exemplarLibrary.ts` loads the whole set in tens of
milliseconds) and picks at random among a category's 24 best, so what appears is recognisable but not
always the same. Without it, `sketch/storedLibrary.ts` answers from the corpus — the 24 drawings of
each category closest to its mean picture, chosen when the feature index is built — and
`sketch/quickdrawLibrary.ts` fetches the first recognised drawings of each curated category straight
from Quick, Draw! on first request. Strokes are handed out in the dataset's 0–255 space; the client
scales and places them. `GET /api/exemplars` lists the categories, from which the game builds its
summoning lexicon (plurals, aliases, scenes like "a forest") — `src/summoning`.

## Two things that would otherwise bite

- **Bun and `bson`.** `bson` 7 probes `v8.startupSnapshot.isBuildingSnapshot()` while it loads, and
  Bun 1.3 throws "not implemented" from it, so `import "mongodb"` crashes. `db/bsonSnapshotShim.ts`
  replaces the probe with `() => false` when it throws, and `db/mongo.ts` loads the driver with a
  dynamic `import()` afterwards (Bun evaluates statically imported CommonJS before any shim could
  run). Import the driver from `db/mongo.ts`, never from `"mongodb"` directly.
- **`bun --watch` and the data directory lock.** A watch reload re-executes the server in place, so
  the `mongod` it spawned is still running and still holds `.kami-data/mongod.lock`. That is why
  the embedded `mongod` has a fixed port: `connectDatabase` first tries to adopt whatever is
  listening there and only spawns one if nothing answers. The server's shutdown stops the `mongod`
  either way; `ingest` and `evaluate` stop it only if they started it.

## Tests

`bunx vitest run server` — every file is `// @vitest-environment node` and the ones that need
MongoDB start their own throwaway in-memory `mongod` (`testing/memoryDatabase.ts`), never
`.kami-data/`.

## API contract (what the client may rely on)

Input budgets come from `src/core/inputLimits.ts`: each drawing allows 256 strokes, 1024 points
per stroke and 2048 points in total, with finite coordinates within ±1,000,000,000. Drawing and
model requests are limited to 262,144 UTF-8 bytes; notes, rules and compile requests to 131,072
bytes; controller state to 256 bytes. Text is limited to 4000 UTF-16 code units, completion names
to 80. Byte excess returns `413 {"error"}` before JSON parsing; invalid counts/coordinates/text
return `400 {"error"}` before persistence or model calls, including streamed requests without
Content-Length. The pen and text prompt enforce matching limits before committing. Detailed
drawings must be split into smaller drawings. The 2048-point aggregate bounds simplification
and Matter.js construction, exercised by the maximum-size zigzag test in `src/sim/inkBody.test.ts`.

Same origin, JSON unless noted. Additive changes only; anything else is announced in `AGENTS.md`.

| Route | Request | Response |
|---|---|---|
| `POST /api/recognize` | `{ strokes: {x,y}[][], partial?: boolean }` — world px, any scale or position | `{ guesses: string[], confidence: number[], names: string[], natures: Nature[], strengths: number[], lines: string[], certain: boolean }` — parallel arrays, best first, at most three, all empty when unsure. `guesses` are bare Quick, Draw! words, each with a 0–1 `confidence`; the other four say what each guess is for the game (below). `certain: true` means `guesses[0]` may be named without offering the player a choice (see "Naming without asking"); a client that ignores it keeps asking, as before |
| `POST /api/beautify` | `{ strokes: {x,y}[][], name?: string, strength?: number }` (`strength` 0–1, the HUD slider: 0 is the player's drawing untouched, 0.5 — the default — Kami's own light hand, 1 the dataset's drawing in its place) | whatever the attached model answers, content-type preserved. With Kami's Eye attached: **`application/json` `{ tidied, added, category, confidence, similarity, exemplar }`** — `tidied` is the player's own strokes, point for point, each moved toward a clean drawing of the same thing (a bounded nudge up to `strength` 0.5, all the way onto it at 1); `added` is what theirs was missing (`ml/CONTRACT.md`, "Completion"). Another model may answer an image (`image/png`, `image/webp`). **`501`** `{ error }` when no model is attached (`KAMI_BEAUTIFY_URL`) or it failed — keep the player's own ink. |
| `GET /api/exemplar?word=rabbit` | `word`: what to draw, as the player said it ("a rabbit", "rabbits", "the hot air balloon") | `{ word: string, strokes: {x,y}[][] }` — one clean drawing of it, a different one each time, in the Quick, Draw! frame: 0–256 px, y down, every stroke at least two points; `word` is the Quick, Draw! category it is a drawing of, which the game names it by. **`404`** `{ error }` when no category matches or there is no drawing of it (`KAMI_SKETCHES` covers all 345; without it, what was ingested or Quick, Draw! itself); **`400`** without a word. The client is `LiveRecognizer.exemplar(word)` (`src/recognition`); the game fits and places the strokes itself ("Summons" below). |
| `POST /api/compile` | `{ text }` | `{ rule: CompiledRule \| null }` |
| `GET /api/exemplars` | — | `{ categories: string[] }` — every Quick, Draw! category `/api/exemplar` has a drawing of; the client builds its summoning lexicon from it |
| `POST /api/scene` | `{ text }` — the whole travel sentence ("teleport us to the moon") | `{ scene: Scene \| null }` where `Scene = { place: string, laws: CompiledRule[], props: { word: string, at: {x,y}, size: number }[], line: string }`. `laws` are ordinary compiled rules (at most five, one per setting, clamped to `effectRanges`); `props` are Quick, Draw! categories with where to stand them relative to the note (`at.x` ±450, `at.y` −350 … −40, y up is negative) and a size factor 0.3–2; `line` is what Kami says on arrival. `null` when the text asks to go nowhere or the model cannot make the place. Only asked for places the client's own atlas lacks (`src/rules/scenes/atlas.ts`). |
| `POST /api/transcribe` | `{ strokes: {x,y}[][] }` — at least one stroke, world px | `{ text: string \| null }` — what the pen wrote, whitespace collapsed, `null` when the strokes are a drawing or the reader is unsure. **`501`** `{ error }` when no reader is configured or none has passed its start-up check (a sidecar's local reader, or the vision model — "Handwriting reading"). Stateless; the client may abort a request (the read of a prefix) freely. |
| boards, drawings, notes, rules | see the table above | |
| `GET /api/boards/:board/events` | `?peer=<id>` (`[a-z0-9-]{1,64}`, this device's name on the board, optional) and `?since=<seq>` or the browser's own `Last-Event-ID` on reconnect | `text/event-stream`: `retry: 1000`, then the board's changes as `id: <seq>` + `data: {"seq","type":"put","kind":"drawings"\|"notes"\|"rules","id","entity"}`, `{"seq","type":"delete","kind","id"}` or `{"seq","type":"clear"}` — first everything after `since` that the server still holds (the last 2000 per board, in memory), else `data: {"type":"resync","seq"}` meaning *reload the board, then follow from `seq`*; without `since`, `data: {"type":"cursor","seq"}` says where the feed stands. `data: {"type":"presence","peer","alice"}` for every peer on the board on connect and on every report, with `alice: null` when one leaves (its stream closed). `: keep-alive` every 5 s. Every `PUT`/`DELETE` on the board's entities and `DELETE` of the board is echoed to every stream, the sender's included; the schemas are `src/sync/wire.ts` (`feedMessageSchema`) |
| `POST /api/boards/:board/presence` | `{ peer: string, alice: AliceSnapshot }` — `alice` is the client's own `sim` snapshot of her (`src/sim/types.ts`) with `look: { kind: "alice" }` — a drawn body stays on its own page (`ghostOf`, `src/sync/wire.ts`) | `204`; `400` `{ error }` for a bad peer or snapshot. Relayed as a `presence` message; nothing is stored |
| `POST /api/controllers/:id/state` | `text/plain` `<x> <y> [buttons]`, e.g. `100 0 A`: axes -100 … 100 (y up), then the letters of the buttons held (`A` `B` `X` `Y`). `:id` is `[a-z0-9-]{1,32}` | `204`, or `400` `{ error }` |
| `GET /api/controllers/:id/events` | — | `text/event-stream`: `retry: 1000`, then `data: {"x":-0.7,"y":0.85,"held":["left","up"],"buttons":["a"]}` on connect and on every change (`x`, `y` -1 … 1; `held` of `left` `right` `up` `down`, with `up` also while `a` is held; everything let go after 1 s without a message), and `: keep-alive` every 5 s |
| `GET /api/controllers` | — | `[{ id, x, y, held, buttons, transport: "udp" \| "serial" \| "http", idleMs }]`, forgotten after a minute of silence |
| `WS /api/stage/:stage?role=source\|screen` | `:stage` is `[a-z0-9-]{1,32}`. Text messages, `<kind>` or `<kind>\n<json>`: a source says `board`, `laws`, `ink`, `note`, `frame`, `active` | A source hears `go` (a screen is watching: start over from the board) and `rest`; a screen hears what the live source shows, verbatim, and `offstage`. The server never reads a body; it drops frames for a screen that is behind and nothing else (`docs/screen.md`). `400` for another role, `404` for a bad stage name; in shared mode `401` without a session and `403` unless the stage is named after a board the credential may open |

The board feed (`server/sync/`) is in-memory and per process: sequence numbers restart with the server, so a
client resuming from a cursor the log does not hold gets `resync` and reloads through `GET /api/boards/:board`.
In `shared` access mode both routes are board routes and need a credential that grants the board id
(`docs/access.md`).

The controller routes are the HTTP face of `server/controllers/` (UDP `:8788` and USB serial feed the same
hub); the whole protocol, the Arduino sketch included, is `docs/controllers.md`.

**Live guessing.** `partial: true` marks a drawing still under the pen. The route is stateless on purpose:
post the strokes so far every ~150 ms and the whole prefix is re-read each time — at a few hundred points
that is far cheaper than keeping per-pen state on the server, and it survives dropped requests. With the
flag set the answer is **all-empty until the recogniser is sure**: the k-NN also searches half-finished
sketches and stays silent unless the leading category holds 0.6 of the vote; Kami's Eye is trained on
prefixes and reads a half-drawn sketch like any other. An empty answer to a partial look means "nothing to
say yet" — keep the last guess on screen. The client for all of this is `src/recognition`
(`LiveRecognizer.sight(strokes, { partial })` → `Sighting[]`).
Strokes returned by `beautify` are in the same world space as the request.

**Summons.** "Summon a rabbit" / "draw me a bridge here" / "a forest with a river": Kami inks a picture
himself. The game asks `GET /api/exemplar?word=…` once per thing (`src/summoning` hears counts, plurals and
scene words from the `/api/exemplars` catalogue) and gets back one clean Quick, Draw! drawing of the closest category
(`server/exemplar/`: articles dropped, plurals folded, the display name of an aliased category accepted, so
"cakes" is `cake` and "birthday cake" is too). The strokes come back untouched in the 256 px dataset frame;
the client scales them to the size of a drawing, stands them over the words that asked and inks them in over
1.8 s while they are already solid, then names the drawing by `word` through the ordinary naming path, so a
summoned rabbit hops like a drawn one. Vector strokes only: whatever Kami draws stays erasable, chewable and
tidyable ink like the player's own. A model that can draw things the dataset lacks can answer the same route
with the same shape.

**Scenes.** "Teleport us to the moon" / "let's go underwater" / "welcome to Candy Land": one sentence becomes a
bundle of laws and a few props Kami draws. The client (`src/rules/scenes/`) recognises the travel phrase and
answers from its own atlas of ~25 places first (the Moon is 0.165 g, thin air and a dim sky, with a moon and
stars sketched above the words). For a place the atlas lacks it asks `POST /api/scene` with the sentence;
`server/scene/llmSceneCompiler.ts` puts it to the same model as `/api/compile` with the law vocabulary plus
the category table, and validates the answer into the `Scene` shape above: the laws through the same
`rawRuleEffectSchema` and `clampEffect` as single laws, the props filtered to categories with drawings and
clamped into reach. Everything in a scene then travels the ordinary paths: the laws are enacted as one
group under the travel note (erasing it repeals the whole scene), and each prop is fetched through
`GET /api/exemplar` and inked like a summons.

**Naming without asking.** When Kami is sure what a drawing is, the game names it instead of offering three
guesses. The server decides, because only it knows which recogniser answered and how far that one's
confidence can be trusted: every answer in the chain is a `Reading { ranking, certainAbove }`
(`recognition/types.ts`), where `certainAbove` is the leader confidence from which the answer may be taken
without asking, or `null` for never. `certain` is true only when, **after** aliases are folded together,
there is a leader whose summed, unrounded confidence reaches the `certainAbove` of the recogniser that
answered; an all-empty answer is never certain. The floors are the points of 95 % precision on held-out
drawings:

| Recogniser | Finished | Still under the pen | Measured in |
|---|---|---|---|
| Kami's Eye (the sidecar), calibrated confidence | ≥ 0.80 — right 95 % of the time, 65 % of drawings | ≥ 0.90 — right 95 % of the time on drawings at least half done, 36 % of them; below half the ink no threshold reaches 95 % | [`docs/reports/kami-eye-results.md`](../docs/reports/kami-eye-results.md), Figure 3, test split |
| k-NN, leading vote share | ≥ 0.8 — right 95.5 % of the time, 25 % of drawings | never: a share ≥ 0.8 is right only 48.5 % of the time at 20 % of the ink and 66.7 % at 40 %, and the k-NN cannot tell how much of the drawing it sees | [`docs/reports/prefix-knn.md`](../docs/reports/prefix-knn.md) |

The k-NN's pair is `certainAbove` in `DEFAULT_RECOGNIZER_OPTIONS`; the sidecar's is
`DEFAULT_CERTAINTY_FLOORS` in `recognition/remoteRecognizer.ts`, used until the sidecar states its own: a
`certainAbove` in its `/recognize` answer (a number in 0–1, or `null`) replaces the default, and anything
else there is ignored. The browser reads the flag as `Sighting.certain`, true at most on the first
sighting; an older server without the field reads as `false` everywhere.

**From a noun to physics.** Every guess arrives already ruled on, from the reviewed table
`server/natures/quickdrawNatures.json` (all 345 Quick, Draw! categories, validated against `NATURES` at
start-up, compiled once — no model is asked at play time). Index `i` of each array describes `guesses[i]`:

| Field | |
|---|---|
| `names[i]` | the display name as Kami writes it, article included: `"a mushroom"`, `"an anvil"`, `"stairs"`, `"The Eiffel Tower"` |
| `natures[i]` | one of `NATURES` in `src/cat/types.ts` (`"bouncy"`, `"grow"`, `"ink"`, …) |
| `strengths[i]` | within `STRENGTH_RANGE` (0.5–2); 1 unless the thing is notably more or less so (a whale 2, a feather 0.6) |
| `lines[i]` | Kami's one-line reaction, twelve words or fewer |

Categories that are one thing for the game are folded together before the best three are chosen, their
confidence summed: `birthday cake` → `cake`, `coffee cup` and `mug` → `cup`, `ceiling fan` → `fan`,
`school bus` → `bus`, `pickup truck` → `truck`, `police car` → `car`, `goatee` → `beard`, `smiley face` →
`face`. So `guesses` only ever holds the canonical word, and a client that reads just `guesses` and
`confidence` keeps working unchanged. A word the table has never met is `"ink"`, strength 1.

The game accepts these structured rulings directly through `Cat.accept`; it does not reinterpret a
guess's name with the typed-name lexicon. Room restrictions still apply. `NoteAction.ruling` is an
optional additive field using the existing `Ruling` schema; old name-only actions remain valid.
Guess notes stay transient. The contract test in `server/natures/recognitionContract.test.ts` compares
all 345 categories, including aliases, through the HTTP adapter and acceptance path. Its only
exclusion allowlist is the eight bare shapes, which remain unnamed.

## Running everything in one place

```
iPad ──LAN──►  Kami (:8787, or :8080 in the image):  game + API ─► MongoDB (embedded, or MONGODB_URI)
                                                                 ├► a language model (KAMI_LLM_URL), optional
                                                                 └► Kami's Eye (KAMI_RECOGNIZER_URL), optional, else the k-NN
```

The server serves the built game itself (`KAMI_WEB_DIR`, `server/http/staticSite.ts`), so one process
is the product; [docs/hosting.md](../docs/hosting.md) packages it as a container image with the
Quick, Draw! corpus and its feature index baked in. The game asks the language model **last** — the
offline grammar and known names are instant — and the server warms it at start.

Kami's Eye is a separate sidecar serving a trained model (`ml/README.md`, `ml/CONTRACT.md`). With no
model, or a sidecar that does not come up, the k-NN answers, and the start-up log says which.
