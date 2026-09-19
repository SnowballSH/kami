# Kami server

Kami's memory and his eyes: a small Bun HTTP API over MongoDB. It remembers every board
(drawings, notes, rules), recognises sketches against Google's Quick, Draw! dataset, and can ask a
model on the GX10 to compile physics notes the offline grammar did not understand.

Nothing in `src/` imports this directory. The browser reaches it through the thin clients in
`src/persistence` and `src/recognition`, on the same origin (`/api`, proxied by Vite in dev). If the
server is down the game still plays; it just is not remembered and Kami guesses from geometry.

## Run

```sh
bun run dev                 # web + server together
bun run server              # server alone, http://localhost:8787, restarts on edits
PORT=8799 bun server/index.ts
```

With no configuration the server starts a real `mongod` (via `mongodb-memory-server`, binary cached
in `node_modules/.cache`) on `127.0.0.1:27117` with its data in `.kami-data/` (gitignored), so
boards survive restarts with zero setup. `Ctrl-C` / `SIGTERM` shuts the `mongod` down cleanly.

| Env | |
|---|---|
| `PORT` | HTTP port, default `8787` (what `vite.config.ts` proxies `/api` to) |
| `MONGODB_URI` | Use this MongoDB instead of the embedded one, e.g. the Atlas `mongodb+srv://…` string. Database `kami`. |
| `KAMI_LLM_URL` | An OpenAI-compatible server for `/api/compile`: a root (`http://gx10.local:8000`), a `/v1` base, or the full `/v1/chat/completions` URL. vLLM and Ollama both work. |
| `KAMI_LLM_MODEL` | Model name to request. Model compile is **off** unless both URL and model are set. |
| `KAMI_LLM_API_KEY` | Optional bearer token. |

## Routes

| Route | Answer |
|---|---|
| `GET /api/boards` | `{ boards: BoardSummary[] }` |
| `GET /api/boards/:board` | `{ drawings: StoredDrawing[], notes: Note[], rules: Rule[] }`, oldest first; an unknown board is empty |
| `PUT /api/boards/:board/{drawings,notes,rules}/:id` | upsert; the body is the client's object and its id must match the path |
| `DELETE /api/boards/:board/{drawings,notes,rules}/:id` | remove one (idempotent) |
| `DELETE /api/boards/:board` | clear the board |
| `POST /api/recognize` `{ strokes: {x,y}[][] }` | `{ guesses: string[] }`, best first, at most three, `[]` when unsure or not ingested |
| `POST /api/compile` `{ text }` | `{ rule: CompiledRule \| null }` |

Every body is validated with zod (`schemas.ts`, which mirrors `src/*/types.ts` and is checked
against them at compile time). A bad payload is a `400` with `{ error, issues }`; nothing throws
past the router. Entities are loose objects: fields the server does not know are stored and
returned untouched. CORS is wide open, for development.

Collections `drawings`, `notes`, `rules` hold the client's objects as they are plus `boardId`
(and, for drawings, a top-level `id` copied from `drawing.id`), with a unique `{ boardId, id }`
index. `_id` and `boardId` never leave the server.

## Quick, Draw!

```sh
bun run quickdraw:ingest        # 300 drawings per category (default)
bun run quickdraw:ingest 600    # or another N
bun server/quickdraw/evaluate.ts
```

`ingest` range-fetches the first 1.5 MB of
`https://storage.googleapis.com/quickdraw_dataset/full/simplified/<category>.ndjson` for the 42
categories in `quickdraw/categories.ts` (chosen because the Cat's lexicon can use them: mushroom,
ladder, stairs, cloud, hot air balloon, cake, wine bottle, key, door, …, plus the plain shapes),
keeps `recognized: true` drawings, drops the line the byte range cut short, takes the first N and
upserts them into the `quickdraw` collection with their feature. It is repeatable; a smaller N or a
shorter category list prunes what is no longer wanted. About 25 s and 46 MB on disk for N = 300.
**Restart the server afterwards** — features are loaded into memory once, at startup. Ingest and
evaluate may run while the server is up (they share its `mongod`).

The feature (`quickdraw/feature.ts`, shared by ingest and `/api/recognize`): strokes are fitted to
a 24×24 grid by their bounding box (aspect kept, centred, 1.5-cell margin), rasterised with
bilinear line drawing, blurred once with a 3×3 binomial kernel and L2-normalised, so a dot product
is cosine similarity. Player strokes in world px and the dataset's 0–255 grid go through the same
code, which makes recognition independent of where and how large something was drawn.

The recogniser (`quickdraw/recognizer.ts`) keeps every feature in one flat `Float32Array` and does
brute-force cosine k-NN: k = 15, each neighbour votes for its category with weight similarity⁸,
categories are ranked by vote share, and up to three with a share of at least 0.08 are returned.
If the single best neighbour is below 0.35 similarity the answer is `[]`. About 5 ms per sketch
over 12 600 samples.

### Measured accuracy

`evaluate.ts` fetches, for each category, the next 50 recognised drawings that are **not** in the
collection and asks the recogniser exactly as the route would (floors included).

| Index | Held out | Top-1 | Top-3 |
|---|---|---|---|
| 42 categories × 300 | 42 × 50 = 2100 | **65.1 %** | **82.9 %** |

Best: line 92/96, door 88/98, fence 88/92, circle 86/90, stairs 82/88, triangle 82/88, wine bottle
80/90, ladder 76/84, hot air balloon 76/94, mushroom 68/88. Worst: zigzag 20/40 and bird 22/32
(drawn too many ways for a raster match), birthday cake 44/74 and cake 52/88 (they steal each
other's votes; the Cat maps both to "a cake"). N = 600 only bought +2 points for twice the memory
and query time, so 300 is the default. k from 5 to 25 and the vote exponent from 1 to 16 move the
numbers by about a point. The GX10 can replace the k-NN with a trained classifier behind the same
route without the client noticing.

## Model-backed compile

`compile/llmCompiler.ts` posts the note to `<KAMI_LLM_URL>/v1/chat/completions` with a system
prompt (`compile/prompt.ts`) that lists every `RuleEffect` variant with its unit and range and asks
for `{"effect": …, "explanation": …}` or `{"effect": null}`. The reply may be wrapped in prose or
code fences; the outermost JSON object is parsed, validated with the same zod schema the board
routes use, and clamped (`compile/effectRanges.ts`): gravity ±30 g per axis, wind ±3 g, timeScale
0.1–3, airDrag and friction 0–10, bounciness 0–1. A missing gloss is written for it. Timeouts
(8 s), HTTP errors, garbage and unknown settings all become `null`, which the client treats as
"not a rule". It has been tested with an injected fetch and end to end against a fake
OpenAI-compatible server, not yet against the real GX10.

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

## Running everything on the ASUS Ascent GX10

The goal: all computation on the box, nothing on a laptop during the demo.

```
iPad ──Wi-Fi "gx10-4d82"──►  GX10 (10.13.37.1):  game + API (:8787) ─► MongoDB (:27017, local)
                                                                    └► Ollama  (:11434, local) qwen3.8
```

The box (`gx10-d8fb`, GB10, 121 GB, Ubuntu 24.04) serves its own Wi-Fi, has **no internet**, no
passwordless sudo, and already has Ollama with `qwen3.8` and `nemotron-3.5-lightning`. So the Mac
carries everything to it and installs under `~/kami` — nothing system-wide, nothing needing sudo.

```bash
bun run gx10:bootstrap   # once, on the box's Wi-Fi: installs an SSH key (you type the password once)
bun run gx10:prepare     # with internet: build, bundle the server to one file, export the Quick, Draw!
                         #   snapshot, fetch Bun + MongoDB for Linux arm64 into .gx10/cache (156 MB, once)
bun run gx10:deploy      # on the box's Wi-Fi: ship, install, (re)start, health-check → .gx10/deploy.log
                         #   add --autostart to bring Kami back whenever the box boots
```

Then on the iPad: join `gx10-4d82`, open `http://10.13.37.1:8787`. On the box, `~/kami/box/status.sh`
shows what is running and `stop.sh` / `start.sh` do what they say.

How it fits: the server serves the built game itself (`KAMI_WEB_DIR`, `server/http/staticSite.ts`), so one
process is the product. `bun build` bundles it to a single `server.js`, so the box needs no
`node_modules`. The box can't run the Quick, Draw! ingest, so `server/quickdraw/snapshot.ts` exports the
drawings on the Mac and imports them there, recomputing features on arrival. The game asks the model
**last** — the offline grammar and known names are instant — and the server warms the model at start.

For development on the Mac instead, `bun run gx10:tunnel` forwards the box's Ollama to `localhost:11434`
(what `.env.local` points at). The Mac has one Wi-Fi radio, so staying online while on the box's Wi-Fi
needs internet on another interface (iPhone USB tethering, or Ethernet to the box with a USB-C adapter).

**Not yet run on the box:** `install.sh` / `start.sh`. Known unknowns the first deploy will answer:
whether MongoDB 8.2 is happy with the kernel's page size, and whether the box's firewall lets the
Wi-Fi reach port 8787 (if not: `sudo ufw allow 8787/tcp` on the box).
