# One Dockerfile for the pnpm workspace, two images:
#
#   docker build --target platform   -t td-platform .
#   docker build --target storefront -t td-storefront .
#
# platform   /app is the output of `node ace build` plus production modules.
#            One image, three jobs, chosen by the command:
#              node bin/server.js                                      (web, default)
#              node ace.js queue:work                                  (worker)
#              node ace.js migration:run --connection=owner --force    (migrations)
# storefront /app holds .output plus the production modules its server needs
#            (Nitro keeps @sentry/* external). Listens on PORT, 3000 by default.
#
# Built on the production server (4 GB of memory plus swap), so the compiling
# stage runs its steps one after the other and caps the Node heap at 2 GB.
# Settings are runtime-only: no .env file enters the context (.dockerignore) and
# the build needs none.

ARG NODE_VERSION=24.3.0

# ---------------------------------------------------------------------------
# base: Node and pnpm, as pinned by .nvmrc and the root package.json
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
# Keep PNPM_VERSION equal to "packageManager" in the root package.json
ARG PNPM_VERSION=12.8.1
ENV CI=true
# From npm, not Corepack: Corepack 0.33 (bundled with Node 24.3.0) cannot run
# pnpm 12 ("Cannot find module .../pnpm/12.8.1/bin/pnpm.cjs")
RUN npm install --global pnpm@${PNPM_VERSION} && pnpm --version
WORKDIR /repo

# ---------------------------------------------------------------------------
# fetch: every dependency into the pnpm store. Depends on the lockfile and the
# workspace settings only (allowBuilds, overrides, ...), so a source change
# does not download again.
# ---------------------------------------------------------------------------
FROM base AS fetch
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

# ---------------------------------------------------------------------------
# build: install from the store, compile both apps, make each app's production
# node_modules. The two builds run in this one stage, one after the other: two
# stages would let BuildKit run them together (both targets built at once) and
# two 2 GB heaps do not fit a 4 GB server.
# ---------------------------------------------------------------------------
FROM fetch AS build
# husky (root `prepare`) has no .git here and nothing to install
ENV HUSKY=0
COPY . .
RUN pnpm install --frozen-lockfile --offline

# Raised from Node's default, capped below the server's memory
ENV NODE_OPTIONS=--max-old-space-size=2048

# `node ace build` and `vite build` read none of the app's settings (they are
# runtime-only, checked when the server or a command starts), so the build needs
# no environment variables and none are set here.
RUN pnpm --filter @tattoo-drip/platform build

# vite build (TanStack Start + Nitro); the storefront reads its settings at run time
RUN pnpm --filter @tattoo-drip/storefront build

# Production node_modules per app, self-contained (no link to the workspace store)
RUN pnpm --filter @tattoo-drip/platform deploy --prod /out/platform
RUN pnpm --filter @tattoo-drip/storefront deploy --prod /out/storefront

# ---------------------------------------------------------------------------
# platform
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS platform
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/platform/build ./
COPY --from=build /out/platform/node_modules ./node_modules
USER node
EXPOSE 3333
CMD ["node", "bin/server.js"]

# ---------------------------------------------------------------------------
# storefront
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS storefront
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/storefront/.output ./.output
COPY --from=build /out/storefront/node_modules ./node_modules
USER node
EXPOSE 3000
CMD ["node", "--import", "./.output/server/instrument.server.mjs", ".output/server/index.mjs"]
