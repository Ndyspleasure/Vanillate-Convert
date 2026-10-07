# Vanillate Convert worker: Node.js + every conversion engine + bubblewrap.
#
#   docker build -f workers/Dockerfile -t vanillate-worker .
#
# Engines come from Ubuntu 24.04 packages (the same versions CI tests against); their licenses
# and sources are available from Ubuntu (see docs/ENGINE-MAPPING.md#licensing). The container
# runs as root only to start engines as an unprivileged user (VANILLATE_ENGINE_USER=auto →
# nobody), inside a bubblewrap sandbox when the container runtime allows namespaces.

FROM node:22-bookworm-slim AS node

# ---------------------------------------------------------------- dependencies
FROM node AS deps
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@vanillate/worker..."

# ---------------------------------------------------------------- runtime
FROM ubuntu:24.04 AS runtime
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      imagemagick ffmpeg \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui libreoffice-draw-nogui \
      poppler-utils ghostscript qpdf pandoc 7zip librsvg2-bin assimp-utils \
      libimage-exiftool-perl python3 python3-fonttools python3-brotli \
      bubblewrap util-linux \
      fonts-dejavu-core fonts-liberation fonts-noto-core fonts-noto-cjk \
      ca-certificates tini libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node

# The ImageMagick policy the engine adapter also writes per job (kept identical by a test).
COPY packages/engines/config/imagemagick/policy.xml /etc/ImageMagick-6/policy.xml

WORKDIR /app
COPY --from=deps /app /app

ENV NODE_ENV=production \
    WORKER_WORK_DIR=/var/lib/vanillate/work \
    VANILLATE_SANDBOX=auto \
    VANILLATE_ENGINE_USER=auto
RUN mkdir -p /var/lib/vanillate/work && chmod 0711 /var/lib/vanillate/work

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "workers/runtime/src/main.ts"]
