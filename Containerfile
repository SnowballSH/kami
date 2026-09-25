# syntax=docker/dockerfile:1
# Kami in one image: the API server, the built game, an embedded mongod and the Quick, Draw!
# sketches it recognises with, their features precomputed. docs/hosting.md explains how to run it.

ARG BUN_VERSION=1.4.2
ARG MONGOD_VERSION=8.2.6
ARG QUICKDRAW_SAMPLES_PER_CATEGORY=300

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


FROM docker.io/oven/bun:${BUN_VERSION}-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends libcurl4t64 libssl3t64 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 kami \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /app --shell /usr/sbin/nologin kami

WORKDIR /app
COPY --from=build /out/mongod/mongod /app/mongod/mongod
RUN ldd /app/mongod/mongod | { ! grep "not found"; } && /app/mongod/mongod --version | head -1

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
