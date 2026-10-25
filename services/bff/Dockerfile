# syntax=docker/dockerfile:1.7
# BFF — imagen multi-stage sobre Node LTS (alpine), usuario no-root. Sin estado: sin BD ni Blob.

ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS base
RUN npm install -g pnpm@11.8.0 && npm cache clean --force
ENV PNPM_HOME=/pnpm \
    npm_config_fetch_timeout=600000 \
    npm_config_fetch_retries=5
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# Dependencias de producción a partir del store ya descargado (offline).
FROM build AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store rm -rf node_modules \
 && pnpm install --frozen-lockfile --prod --offline --store-dir /pnpm/store

FROM node:24-alpine AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
