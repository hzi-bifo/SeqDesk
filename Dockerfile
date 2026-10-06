# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
# Build-only URL for Prisma generation; no live database is supplied.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    DIRECT_URL=postgresql://build:build@127.0.0.1:5432/build \
    SEQDESK_DISABLE_WORKER_AUTOSTART=1 NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY src ./src
COPY public ./public
COPY data ./data
COPY scripts/generate-font-mocks.cjs scripts/run-prisma.mjs ./scripts/
COPY scripts/lib ./scripts/lib
COPY next.config.ts postcss.config.mjs tsconfig.json tsconfig.production.json ./
# Same offline font fallback as the release installer build; no Google request.
RUN node scripts/generate-font-mocks.cjs /tmp/font-mocks.json \
    && NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/tmp/font-mocks.json \
       NODE_OPTIONS=--max-old-space-size=6144 npm run build -- --webpack
RUN npm prune --omit=dev

FROM base AS runtime
ARG SEQDESK_IMAGE_VERSION=development
ARG SEQDESK_IMAGE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/hzi-bifo/SeqDesk" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.description="SeqDesk local reviewer application; pipelines are not included" \
      org.opencontainers.image.version=$SEQDESK_IMAGE_VERSION \
      org.opencontainers.image.revision=$SEQDESK_IMAGE_REVISION
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
# Keep the Prisma CLI and seed dependencies, which standalone tracing omits.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/data ./data
COPY --from=build --chown=node:node /app/scripts/run-prisma.mjs ./scripts/run-prisma.mjs
COPY --chown=node:node LICENSE ./LICENSE
COPY --chown=node:node docker ./docker
RUN mkdir -p /storage && chown node:node /storage /app
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "docker/entrypoint.sh"]
CMD ["node", "server.js"]
