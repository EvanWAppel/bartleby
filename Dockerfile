# syntax=docker/dockerfile:1.7

FROM node:22-slim AS server-deps
WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    python3 \
  && rm -rf /var/lib/apt/lists/*
COPY shared /app/shared
COPY server/package.json server/package-lock.json ./
RUN npm ci

FROM server-deps AS server-build
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM server-deps AS server-runtime-deps
RUN npm prune --omit=dev

FROM node:22-slim AS web-build
WORKDIR /app/web
COPY shared /app/shared
COPY web/package.json web/package-lock.json ./
COPY web/patches ./patches
RUN npm ci
COPY web ./
RUN npm run build

FROM web-build AS web-runtime-deps
RUN npm prune --omit=dev

FROM caddy:2.10.2 AS caddy

FROM node:22-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    gosu \
  && rm -rf /var/lib/apt/lists/*

COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

WORKDIR /app
COPY shared ./shared
COPY server/package.json server/package-lock.json ./server/
COPY --from=server-runtime-deps /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/dist ./server/dist

COPY web/package.json web/package-lock.json ./web/
COPY --from=web-runtime-deps /app/web/node_modules ./web/node_modules
COPY --from=web-build /app/web/build ./web/build

COPY ops/Caddyfile.railway ./ops/Caddyfile.railway
COPY ops/railway-entrypoint.sh ./ops/railway-entrypoint.sh
RUN chmod +x ./ops/railway-entrypoint.sh \
  && mkdir -p /data /tmp/caddy-config /tmp/caddy-data \
  && chown -R node:node /data /tmp/caddy-config /tmp/caddy-data

ENV NODE_ENV=production
ENV PORT=8080
ENV BARTLEBY_DB_PATH=/data/bartleby.db
EXPOSE 8080

STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/ops/railway-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"
