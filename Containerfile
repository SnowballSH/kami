# syntax=docker/dockerfile:1
# Kami in one image: the API server, the built game, an embedded mongod, the Quick, Draw!
# sketches it recognises with (their features precomputed) and the sidecar that reads handwriting
# on the CPU, which the server starts itself. docs/hosting.md explains how to run it.

ARG BUN_VERSION=1.4.2
ARG MONGOD_VERSION=8.2.6
ARG QUICKDRAW_SAMPLES_PER_CATEGORY=300
ARG UV_VERSION=0.12.13
ARG PYTHON_VERSION=3.12

FROM docker.io/oven/bun:${BUN_VERSION} AS build
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

ARG QUICKDRAW_SAMPLES_PER_CATEGORY
RUN KAMI_DATA_DIR=/out/data KAMI_QUICKDRAW_SNAPSHOT=/out/data/quickdraw.ndjson.gz \
    bun server/quickdraw/ingest.ts "${QUICKDRAW_SAMPLES_PER_CATEGORY}" \
    && test -s /out/data/quickdraw.features.bin

ARG MONGOD_VERSION
ENV MONGOMS_VERSION=${MONGOD_VERSION} \
    MONGOMS_DISTRO=ubuntu-24.04 \
    MONGOMS_DOWNLOAD_DIR=/out/mongod-download
RUN bun scripts/container/fetchMongod.ts /out/mongod/mongod


FROM docker.io/oven/bun:${BUN_VERSION} AS production-deps
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production


FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# The sidecar's serving dependencies only (numpy, OpenCV headless, ONNX Runtime; never torch) in a
# relocatable Python from uv, and the handwriting model, fetched from pinned revisions and checked
# against pinned SHA-256s (ml/handwriting/sources.py).
FROM docker.io/library/debian:trixie-slim AS sidecar
COPY --from=uv /uv /usr/local/bin/uv
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/*
ENV UV_PYTHON_INSTALL_DIR=/app/python \
    UV_PYTHON_PREFERENCE=only-managed \
    UV_PROJECT_ENVIRONMENT=/app/ml/.venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1
WORKDIR /app/ml
ARG PYTHON_VERSION
COPY ml/pyproject.toml ml/uv.lock ./
RUN uv python install "${PYTHON_VERSION}" \
    && uv sync --locked --no-default-groups --no-install-project --python "${PYTHON_VERSION}"
COPY ml/handwriting ./handwriting
RUN .venv/bin/python -m handwriting.fetch /app/models/handwriting
COPY ml/*.py ml/eye-release.json ./
RUN .venv/bin/python eye_release.py /app/models/kami-eye
RUN .venv/bin/python -m compileall -q -x '/\.venv/' . \
    && .venv/bin/python -c "import sidecar"


FROM docker.io/oven/bun:${BUN_VERSION}-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4t64 libssl3t64 libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 kami \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /app --shell /usr/sbin/nologin kami

WORKDIR /app
COPY --from=build /out/mongod/mongod /app/mongod/mongod
RUN ldd /app/mongod/mongod | { ! grep "not found"; } && /app/mongod/mongod --version | head -1

COPY --from=sidecar /app/python /app/python
COPY --from=sidecar /app/ml /app/ml
COPY --from=sidecar /app/models /app/models
RUN /app/ml/.venv/bin/python -c "import sys; sys.path.insert(0, '/app/ml'); import sidecar"

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
COPY --from=build /out/data/quickdraw.ndjson.gz /out/data/quickdraw.features.bin /app/data/

ARG MONGOD_VERSION
ENV NODE_ENV=production \
    PORT=8080 \
    KAMI_BIND_HOST=0.0.0.0 \
    KAMI_DATA_DIR=/data \
    KAMI_WEB_DIR=/app/dist \
    KAMI_QUICKDRAW_SNAPSHOT=/app/data/quickdraw.ndjson.gz \
    KAMI_CONTROLLER_UDP_PORT=off \
    KAMI_CONTROLLER_SERIAL=off \
    KAMI_SIDECAR=auto \
    KAMI_SIDECAR_PYTHON=/app/ml/.venv/bin/python \
    KAMI_HANDWRITING_MODEL=/app/models/handwriting \
    KAMI_EYE_MODEL=/app/models/kami-eye \
    KAMI_EYE_THREADS=1 \
    MONGOMS_SYSTEM_BINARY=/app/mongod/mongod \
    MONGOMS_VERSION=${MONGOD_VERSION} \
    MONGOMS_SYSTEM_BINARY_VERSION_CHECK=false \
    MONGOMS_RUNTIME_DOWNLOAD=false \
    MONGOMS_DISABLE_POSTINSTALL=1

VOLUME /data
EXPOSE 8080
USER 10001:10001
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD ["bun", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["bun", "server/index.ts"]
