# syntax=docker/dockerfile:1
#
# THE BACKEND CONTAINER — Task 15.1.
#
# Built for Railway, which is where OD-3 puts the API. Railway can also build
# from Nixpacks with no Dockerfile at all; this exists because Nixpacks would
# have to *infer* the Node version, the build command and the start command,
# and every one of those has a wrong answer that fails at runtime rather than
# at build time. `railway.json` points at this file explicitly.
#
# ── WHY MULTI-STAGE ─────────────────────────────────────────────────────────
#
# The builder needs `typescript`, `drizzle-kit`, `vitest` and the rest of
# devDependencies. The runtime needs none of them, and shipping them means
# shipping a compiler and a test runner into a container that holds a live
# database credential. The runtime stage installs production dependencies only.
#
# ── WHAT IS DELIBERATELY *NOT* HERE ─────────────────────────────────────────
#
# **No migration on start.** `CMD` runs the server and nothing else. Migrations
# are a release step against `DIRECT_DATABASE_URL` (D-090); running them from
# `CMD` means every replica races to apply the same DDL on every restart, which
# is how a partially-applied migration happens.
#
# **No `NODE_ENV` default.** `env.ts` requires it explicitly and refuses to
# guess, because it alone decides the refresh cookie's `Secure` and `SameSite`
# flags (SEC-028). Defaulting it here would reintroduce exactly the silent
# wrong answer that finding is about. It is set in the Railway variables.

# ─────────────────────────────────────────────────────────── builder ────────
FROM node:22-alpine AS builder
WORKDIR /app

# Dependencies are copied and installed before the source, so an edit that does
# not touch the manifests reuses the cached layer.
COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ─────────────────────────────────────────────────────────── runtime ────────
FROM node:22-alpine AS runtime
WORKDIR /app

# `dumb-init` gives PID 1 correct signal handling. Without it SIGTERM never
# reaches Node, so `server.ts`'s graceful drain never runs and Railway kills
# the container mid-request on every deploy.
RUN apk add --no-cache dumb-init

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# The migration files themselves, needed by `db:migrate:prod`. They are data,
# not code, and `tsc` does not emit them.
COPY drizzle ./drizzle

# `node` is the image's own unprivileged user. The application writes nothing to
# disk in production — storage is S3 (D-071) — so it needs no writable volume.
USER node

ENV PORT=8080
EXPOSE 8080

# Liveness only. `/api/health` never touches the database, so a Neon blip
# cannot make Railway restart-loop a healthy container; `/api/health/ready` is
# the one that tests the connection and is polled separately.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
