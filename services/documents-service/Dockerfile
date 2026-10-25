# syntax=docker/dockerfile:1.7
# documents-service — imagen multi-stage sobre Node LTS (alpine), usuario no-root.

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
# openssl: requerido por los motores de Prisma en musl.
RUN apk add --no-cache openssl \
 && npm install -g pnpm@11.8.0 \
 && npm cache clean --force
ENV PNPM_HOME=/pnpm \
    npm_config_fetch_timeout=600000 \
    npm_config_fetch_retries=5 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Dependencias completas para compilar.
FROM base AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm build

# Solo dependencias de producción (incluye la CLI de Prisma para aplicar migraciones al arrancar).
# Se reutiliza el store del stage de build (offline) para no volver a descargar paquetes.
FROM build AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store rm -rf node_modules \
 && pnpm install --frozen-lockfile --prod --offline --store-dir /pnpm/store \
 && pnpm exec prisma generate

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    PORT=3100
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node package.json docker-entrypoint.sh ./
USER node
EXPOSE 3100
# tini reenvía SIGTERM a node para el apagado ordenado (enableShutdownHooks).
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
