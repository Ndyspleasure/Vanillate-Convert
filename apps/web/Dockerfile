# Vanillate Convert web app for self-hosting and docker compose (Vercel builds from source).
#
#   docker build -f apps/web/Dockerfile -t vanillate-web \
#     --build-arg VANILLATE_SERVER_PROCESSING=enabled --build-arg NEXT_PUBLIC_SITE_URL=https://… .

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@vanillate/web..."
# Static pages bake in whether server processing is enabled and the canonical URL.
ARG VANILLATE_SERVER_PROCESSING=disabled
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV VANILLATE_SERVER_PROCESSING=$VANILLATE_SERVER_PROCESSING \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN pnpm --filter @vanillate/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
