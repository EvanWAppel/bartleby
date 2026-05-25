# syntax=docker/dockerfile:1.7

# ----- deps -----
# Install ALL deps (including dev) so we can run tsc. Native bindings
# (better-sqlite3) get compiled here for the runtime architecture.
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ----- build -----
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ----- runtime -----
# Slim runtime: only production deps + compiled dist/. Non-root user.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=1234
# Bind every interface in container; Caddy fronts in production.
ENV BARTLEBY_BIND_ADDRESS=0.0.0.0
# better-sqlite3's prebuilt binary works without g++, but if a node-gyp
# rebuild is ever needed at runtime, install those tools manually.

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Persist the SQLite file outside the image layer (compose mounts a
# volume at /data and BARTLEBY_DB_PATH defaults there).
ENV BARTLEBY_DB_PATH=/data/bartleby.db
RUN mkdir -p /data && chown -R node:node /data

USER node
EXPOSE 1234

# Use exec form so SIGTERM reaches node directly (clean shutdown).
CMD ["node", "dist/index.js"]

# Healthcheck: poll /health every 30s. Compose can read this too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||1234)+'/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"
