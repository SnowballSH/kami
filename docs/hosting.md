# Hosting Kami

One container holds everything the game needs: the API server, the built game, an embedded MongoDB
(`mongod`, started by the server), the Quick, Draw! sketches its built-in recogniser learns from, and
the sidecar that reads handwriting on the CPU ([ml/HANDWRITING.md](../ml/HANDWRITING.md)), which the
server starts and looks after itself. Nothing else is required; a language model, a trained Kami's
Eye and an external MongoDB are optional and switched on with environment variables or a volume. Images are published for `linux/amd64` and
`linux/arm64` from [`.github/workflows/container.yml`](../.github/workflows/container.yml).

| Image | From | What |
|---|---|---|
| `ghcr.io/snowballsh/kami` | [`Containerfile`](../Containerfile) | the game: server, web build, embedded mongod, sketches |
| `ghcr.io/snowballsh/kami-eye` | [`ml/Containerfile`](../ml/Containerfile) | the same sidecar on its own (handwriting, and Kami's Eye when a model is mounted), for another host |

Tags: `latest` follows `main`, `1.2.3` and `1.2` follow `v*` releases, `sha-<short>` every build.

## One command

```bash
podman run -d --name kami -p 8080:8080 -v kami-data:/data \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop=ALL --security-opt no-new-privileges \
  ghcr.io/snowballsh/kami:latest
```

Open <http://localhost:8080>. The sketches and their precomputed features are baked into the
image, so the server listens about a second after the container starts (`podman logs -f kami`
shows it) and `GET /api/health` then answers `{"ok":true}`. The handwriting reader is ready a second
or two later: the log says `handwriting reader is ready: local reader (http://127.0.0.1:8790)`, and
the sidecar's own lines are prefixed `sidecar:`. Boards live in the `kami-data`
volume; nothing else is written, which is why `--read-only` works (mongod keeps a socket in `/tmp`,
hence the tmpfs). A volume from an older image still holds a `quickdraw` collection; the first start
drops it and logs that it did.

The image runs as uid/gid 10001 and needs no capability. Rootless podman maps that user onto your
own with `--userns=keep-id:uid=10001,gid=10001`, which also keeps bind-mounted secret files
owner-readable. `docker run` takes the same flags.

Build it yourself with `podman build -t kami .` (about ten minutes: it builds the game, fetches
mongod, downloads 300 drawings for each of the 42 Quick, Draw! categories the k-NN knows and
precomputes their features, and installs the sidecar's Python with the handwriting model, 73 MB
fetched from pinned revisions and checked against pinned SHA-256s). `--build-arg
QUICKDRAW_SAMPLES_PER_CATEGORY=100` makes a smaller, quicker image. The sidecar adds about 400 MB
(uncompressed) to the image: Python 102 MB, numpy, OpenCV and ONNX Runtime 223 MB, the models 76 MB.

## Compose

[`compose.yaml`](../compose.yaml) runs the same container, with an optional MongoDB profile. It works
with `podman compose`, `podman-compose` and `docker compose`.

```bash
cp .env.example .env               # fill in what you use; every line is optional
podman compose up -d               # the game, with its embedded MongoDB and handwriting sidecar
podman compose --profile mongo up -d   # + MongoDB 8 instead of the embedded one: MONGODB_URI=mongodb://mongo:27017
```

A trained Kami's Eye needs no second service: uncomment the `/models/kami-eye` volume in
`compose.yaml` (`KAMI_EYE_ARTIFACTS` names the directory) and the kami container's own sidecar serves it.

[`.env.example`](../.env.example) lists every variable with a line of explanation. `KAMI_PUBLISH`
chooses where compose publishes the game; `127.0.0.1:8080` keeps it behind a reverse proxy.

## Configuration

Everything is an environment variable ([server/README.md](../server/README.md) has the details).
Any secret (`*_API_KEY`, `MONGODB_URI`, `KAMI_CREDENTIALS`, `KAMI_PASSWORD`) may be given as a file instead:
`KAMI_LLM_API_KEY_FILE=/run/secrets/llm-key`.

### Models

| Variable | Default | What |
|---|---|---|
| `KAMI_LLM_URL`, `KAMI_LLM_MODEL` | off | Any OpenAI-compatible chat endpoint for the laws the offline grammar cannot read, and the model name it serves. Unset: the grammar alone, which still plays. |
| `KAMI_LLM_API_KEY` | none | Sent as a bearer token. |
| `KAMI_LLM_REASONING_EFFORT` | `none` | Sent as `reasoning_effort`: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `off` to never send it. A server that rejects the field is asked again without it. |
| `KAMI_SIDECAR` | `auto` | The image starts `ml/sidecar.py` on `127.0.0.1:8790` beside the server, restarts it if it dies and stops it on shutdown. `off` does without: handwriting then needs another reader. |
| `KAMI_HANDWRITING_URL`, `KAMI_HANDWRITING_API_KEY` | the image's sidecar | Where handwriting is read (`POST /read`, [ml/CONTRACT.md](../ml/CONTRACT.md)): another sidecar, e.g. the `kami-eye` image on another host, or `off` to leave it to the vision model. |
| `KAMI_TRANSCRIBE_URL`, `KAMI_TRANSCRIBE_MODEL`, `KAMI_TRANSCRIBE_API_KEY` | the LLM settings | A vision-capable model that reads handwriting, used only when no sidecar reader passes its start-up check. A text-only model fails that check and is simply not used. |
| `KAMI_EYE_MODEL` | `/models/kami-eye` | Kami's Eye for the image's sidecar ([ml/CONTRACT.md](../ml/CONTRACT.md)). Mount a trained model there and the sidecar recognises sketches and finishes drawings; without one, the built-in k-NN recognises alone. |
| `KAMI_RECOGNIZER_URL`, `KAMI_RECOGNIZER_API_KEY` | the image's sidecar, when it has an Eye | Kami's Eye elsewhere. `off`: the k-NN alone. |
| `KAMI_SKETCHES` | Quick, Draw! | The Eye's exemplar set, whose drawings are summoned by name. |
| `KAMI_BEAUTIFY_URL`, `KAMI_BEAUTIFY_API_KEY` | off | A sketch beautifier, if you have one. |
| `KAMI_MODEL_REQUESTS_PER_MINUTE`, `KAMI_MODEL_CONCURRENCY` | server defaults | Caps on what the game may spend at the model endpoints. |

Point `KAMI_LLM_URL` at whatever speaks the OpenAI chat-completions API:

| Endpoint | `KAMI_LLM_URL` | `KAMI_LLM_MODEL` |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4.1-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openai/gpt-4.1-mini` |
| A gateway of your own (modelgate, LiteLLM) | `https://llm.example.org/v1` | whatever it routes |
| vLLM | `http://vllm:8000/v1` | the served model name |
| Ollama | `http://ollama:11434/v1` | `qwen3:8b` |

A small, fast model is the right choice: Kami asks for short JSON and asks often. Keep the key out
of the command line with `KAMI_LLM_API_KEY_FILE`.

**An OpenAI reasoning model behind a gateway.** Any OpenAI-compatible gateway (modelgate, LiteLLM,
a hosted router) works the same way. Ask for the lowest effort, so a law comes back in about the
time a non-reasoning model takes:

```text
KAMI_LLM_URL=https://llm.example.org/v1
KAMI_LLM_MODEL=<the model name the gateway routes, e.g. an OpenAI reasoning model>
KAMI_LLM_API_KEY_FILE=/run/secrets/llm-key
KAMI_LLM_REASONING_EFFORT=none
```

`none` is also the default, and it is sent as `"reasoning_effort": "none"` on every chat request;
a model or gateway that rejects the field (or that value) is asked once more without it, and Kami
remembers that for the rest of the run. Set a higher effort only if laws come back wrong, and
`off` for a server that must never see the field. The gateway may bill each request, so cap the
spend with `KAMI_MODEL_REQUESTS_PER_MINUTE` and `KAMI_MODEL_CONCURRENCY` (docs/access.md suggests
`600` and `4` for a small public host).

Handwriting is not sent to that model. The image's own sidecar reads it on the CPU, and a local
reader always comes first: the vision model (`KAMI_TRANSCRIBE_*`, which defaults to the LLM
settings) is only tried when no sidecar reader passes its start-up check. A text-only or
reasoning-only model fails the vision check and is simply not used, so pointing `KAMI_LLM_URL` at a
gateway changes how laws are read and nothing about handwriting.

### Storage

| Variable | Default | What |
|---|---|---|
| `KAMI_DATA_DIR` | `/data` | Where the embedded mongod keeps boards. Mount a volume here. |
| `KAMI_MONGO_CACHE_GB` | `0.25` | The embedded mongod's WiredTiger cache; its main use of memory. |
| `MONGODB_URI` | unset | Use this MongoDB instead of starting one; `/data` is then unused. |
| `KAMI_QUICKDRAW_SNAPSHOT` | baked into the image | The Quick, Draw! corpus: a read-only gzipped NDJSON file, which `bun run quickdraw:ingest` writes. Features for another corpus are computed at start (a few seconds) and cached beside it, or in `/data` if that is read-only. |

### Access

| Variable | Default | What |
|---|---|---|
| `PORT` | `8080` | The HTTP port inside the container. |
| `KAMI_BIND_HOST` | `0.0.0.0` | What the server binds inside the container. |
| `KAMI_ACCESS_MODE` | `demo`, or `shared` when a password is set | `demo` trusts every peer that can reach it; `shared` for anything on the internet. |
| `KAMI_PASSWORD` | none | One password for everyone, granting every board; setting it makes the server `shared`. Prefer `KAMI_PASSWORD_FILE`. |
| `KAMI_ALLOWED_ORIGINS` | none | Exact browser origins allowed besides the game's own, e.g. `https://kami.example.org`. |
| `KAMI_CREDENTIALS` | none | Scoped participants, a JSON array of tokens, instead of or beside the password; prefer `KAMI_CREDENTIALS_FILE`. |
| `KAMI_TRUSTED_PROXIES` | loopback | Proxy addresses whose `X-Forwarded-For` names the visitor, for counting failed sign-ins. |
| `KAMI_WEB_DIR` | `/app/dist` | The built game the server serves at `/`. |
| `KAMI_CONTROLLER_UDP_PORT`, `KAMI_CONTROLLER_SERIAL` | `off` | Physical controllers; a container has neither. |

**Anything reachable from the public internet runs in `shared` mode**, behind TLS, with a password
or credentials: in `demo` mode every visitor can read, overwrite and delete every board and spend
your model budget. [docs/access.md](access.md) explains the trust model, how to mint credentials and
what the API answers; "Put it on the internet" below is the short version.

```text
KAMI_PASSWORD_FILE=/run/secrets/kami-password
KAMI_ALLOWED_ORIGINS=https://kami.example.org
```

### Performance

| Variable | Default | What |
|---|---|---|
| `KAMI_MONGO_CACHE_GB` | `0.25` | Lower to `0.1` on a very small host; boards are tiny. |
| `KAMI_MODEL_CONCURRENCY` | server default | How many model calls may be in flight; match your endpoint. |
| `BUN_OPTIONS` | none | Flags for Bun itself. `--smol` made no measurable difference to Kami's idle memory. |
| `KAMI_EYE_THREADS` | `1` | The sidecar's ONNX Runtime threads (handwriting and the Eye). `1` on a shared host; more only if you have idle cores. |

**Small shared CPU hosts.** Measured idle, freshly started with an empty volume (rootless podman,
arm64): the Bun server about 180–200 MB resident, of which 65 MB is the k-NN's feature matrix and
45 MB Bun's own executable; the embedded mongod about 140 MB, of which some 115 MB are pages of its
executable (file-backed, so the kernel can reclaim them) and under 30 MB its own memory; and 15 MB for
the watchdog `mongodb-memory-server` keeps beside it. That is about 350 MB of resident memory, and
`podman stats` reports a little more because it also counts the page cache of files the container
has read. Boards are tiny, so mongod's WiredTiger cache (`KAMI_MONGO_CACHE_GB`, already at its
0.25 GB minimum) stays nearly empty. The handwriting sidecar adds about 210 MB resident idle
(Python, numpy, OpenCV, ONNX Runtime and both models), settling near 260 MB after hundreds of reads,
for about 800–850 MB in `podman stats` in all. A `MemoryMax` of 1 GB leaves room for the static
site's compressed-file cache and bursts of drawings; check with `podman stats --no-stream`. A mounted
Eye adds its own model to the sidecar (its RSS alone was measured at about 180–210 MB with an
exemplar set, [ml/README.md](../ml/README.md)). One CPU is enough for a table of players: a line of
handwriting costs 40–330 ms of one core (p50; at most 0.85 s for the messiest), a drawing ~7 ms,
recognition milliseconds, and reads go one at a time. No container needs a GPU.

## Kami's Eye and the sidecar

The kami image's sidecar reads handwriting from the start and serves Kami's Eye too once trained
artefacts, which are not in the repository, are mounted read-only at `/models/kami-eye`:

```bash
podman run -d --name kami -p 8080:8080 -v kami-data:/data \
  -v /srv/kami/artifacts/kami-eye:/models/kami-eye:ro \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop=ALL --security-opt no-new-privileges \
  ghcr.io/snowballsh/kami:latest
```

The server then recognises sketches with the Eye (the k-NN still answers whenever it does not) and
finishes drawings with its exemplar set. An artefact directory that is there but incomplete stops
the sidecar ([ml/CONTRACT.md](../ml/CONTRACT.md) says which file is missing); the server logs its
exits and keeps restarting it, less often each time, while the game plays on with the k-NN and
without handwriting. The sidecar's lines in the server log are prefixed `sidecar:`.

The `kami-eye` image is the same sidecar alone, for a separate host:

```bash
podman run -d --name kami-eye -p 127.0.0.1:8790:8790 \
  -v /srv/kami/artifacts/kami-eye:/models/kami-eye:ro \
  --read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges \
  ghcr.io/snowballsh/kami-eye:latest
```

`GET /health` on it says what it can do (`capabilities`), the Eye's model and classes and whether an
exemplar set is loaded. Give the game `KAMI_RECOGNIZER_URL=http://kami-eye:8790` for the Eye and, to
read handwriting there instead of in the game's own container, `KAMI_HANDWRITING_URL` likewise with
`KAMI_SIDECAR=off`. `KAMI_EYE_MODEL` names another directory under the mount; `KAMI_EYE_HOST` and
`KAMI_EYE_PORT` move the listener.

## Behind a reverse proxy

Terminate TLS in front and publish the container on loopback only (`-p 127.0.0.1:8080:8080`).
Kami uses two long-lived connection kinds the proxy must not buffer or time out:

- `/api/boards/*/events` and `/api/controllers/*/events` are **server-sent events**: streaming
  responses that stay open. Disable response buffering and any short idle timeout for them.
- `/api/stage/*` is a **websocket** (the big screen, [docs/screen.md](screen.md)). The proxy must
  pass the `Upgrade` handshake.

Caddy does both by default, so the whole configuration is:

```caddyfile
kami.example.org {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1
    }
}
```

`flush_interval -1` streams SSE bodies as they come. For nginx, set `proxy_buffering off;`,
`proxy_read_timeout 1h;` and the usual `Upgrade`/`Connection` headers on `/api/stage/`. Whatever the
proxy, the game and `/api` must share **one origin**, and that origin goes in `KAMI_ALLOWED_ORIGINS`.

## Put it on the internet

The recommended public setup is three pieces, each one line of configuration:

1. **A password gate.** `KAMI_PASSWORD_FILE` names a file holding one password; setting it makes the
   server `shared`, and the game opens with a password prompt instead of the board. Everyone who
   knows the password can play every board ([access.md](access.md), "One password").
2. **HTTPS in front.** A reverse proxy terminates TLS (Caddy, above, gets a certificate by itself)
   and the container is published on loopback only, so nothing reaches Kami except through it.
3. **The public origin.** `KAMI_ALLOWED_ORIGINS` is the exact address people open.

```bash
openssl rand -base64 18 > /srv/kami/password && chmod 400 /srv/kami/password
podman run -d --name kami -p 127.0.0.1:8080:8080 -v kami-data:/data \
  -v /srv/kami/password:/run/secrets/kami-password:ro \
  -e KAMI_PASSWORD_FILE=/run/secrets/kami-password \
  -e KAMI_ALLOWED_ORIGINS=https://kami.example.org \
  -e KAMI_TRUSTED_PROXIES=10.88.0.1 \
  --userns=keep-id:uid=10001,gid=10001 \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --cap-drop=ALL --security-opt no-new-privileges \
  ghcr.io/snowballsh/kami:latest
```

With compose, put the same variables in `.env` (leave `KAMI_ACCESS_MODE` empty or `shared`), mount
the password file, and set `KAMI_PUBLISH=127.0.0.1:8080`. `KAMI_TRUSTED_PROXIES` names the address
the proxy's connections arrive from, so failed sign-ins are counted per visitor rather than for
everyone at once; left out, it is safe but coarser. The address depends on the container network
(the gateway, or with rootless podman sometimes the container's own address): one wrong password
through the proxy logs `sign-in refused: connection from <address>`, and that is the one to use
([access.md](access.md)). `GET
/api/health` stays open for health checks and says nothing but `{"ok":true}`.

Sessions last eight hours in an `HttpOnly`, `Secure` cookie. To lock everyone out, change the
password and restart. For people with different rights — one board each, a scoped kiosk — use
`KAMI_CREDENTIALS` tokens instead of, or beside, the password.

