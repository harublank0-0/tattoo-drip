# Single-Server Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tattoo Drip deployable on one Ubuntu server behind Cloudflare: photos on R2, container images, a production compose stack with nginx and a tunnel, nightly backups to R2, a deploy command and the owner's runbooks.

**Architecture:** The platform's two drive disks switch from local folders to R2 (S3 driver) when six `R2_*` settings are present, and production refuses to boot without them. One Dockerfile builds a platform image (web, worker, ace) and a storefront image. `deploy/compose.yml` runs postgres, web, worker, storefront, nginx and cloudflared on one internal network with fixed addresses. nginx applies `deploy.md`'s proxy rules and replaces `X-Forwarded-For` with Cloudflare's visitor address. A backup image (postgres 18 + rclone) dumps nightly to R2 from a systemd timer. Everything else is shell scripts and docs under `deploy/`.

**Tech Stack:** AdonisJS 7 drive (flydrive 2.1 S3 driver) + `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner`, Japa, Docker / Compose (verified locally with podman 4.9 + podman-compose), nginx, cloudflared, PostgreSQL 18, rclone, systemd.

**Spec:** `docs/superpowers/specs/2026-10-31-single-server-deploy-design.md` (read it first; this plan argues from it).

## Global Constraints

- Node `24.3.0` in every image (`node:24.3.0-bookworm-slim`); pnpm `12.8.1` (root `package.json`); PostgreSQL `18`.
- Pin every image to an exact version tag (postgres `18.<minor>`, nginx stable, cloudflared), current at build time; never `latest`.
- Hostnames: `tattoodrip.app` (dashboard + API), `media.tattoodrip.app` (R2 public bucket), `tattoodrip.page` and `*.tattoodrip.page` (storefront).
- Stored `Cache-Control`: public objects `no-cache`; private objects `private, no-store` (`PRIVATE_CACHE_CONTROL`). Private signed URLs stay 5 minutes.
- Internal network `tattoo_drip`, subnet `172.30.42.0/24`; nginx `172.30.42.10`, cloudflared `172.30.42.20`. Platform `TRUST_PROXY=172.30.42.10`. No service publishes a port in `deploy/compose.yml`.
- nginx values (from `apps/platform/docs/deploy.md`): `proxy_request_buffering on`, `client_max_body_size 21m`, `client_header_timeout 15s`, `client_body_timeout 30s`, `send_timeout 30s`, `proxy_read_timeout 130s`, upstream keep-alive timeout below 5 s; no access log for `^/api/v1/tenants/[^/]+/deposits/` and `^/(reset-password|verify-email|invitations)/`.
- Server paths: repo at `/srv/tattoo-drip/app`, env files in `/srv/tattoo-drip/env/` (mode 600), overridable as `TD_ENV_DIR`.
- Backups: `pg_dump --format=custom`, daily at `02:00 Asia/Kathmandu`, keep 30 days, heartbeat URL optional.
- Secrets: never in git, images, logs or Claude's view. Never read any `.env*` other than `.env.example`, `.env.test` and this plan's `*.env.example` templates. Generated passwords are `openssl rand -hex 32` (no `$`, no quoting problems).
- Tests never touch the user's dev DB `tattoo_drip` or anything on Neon. Use the throwaway DB from Task 0.
- Commits: Conventional Commits with area scopes (`platform`, `storefront`, `deploy`, `docs`), lower case after the colon, subject under 100 characters, body lines ≤ 100, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Biome for TS/JSON (`pnpm check`).
- Run commands with Node 24.3.0 on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH`.
- Platform test runs from this worktree: `ENV_PATH=/home/blank/Coding/tattoo-drip/apps/platform DB_DATABASE=tattoo_drip_deploy PORT=3402`, with `TURNSTILE_SECRET_KEY STOREFRONT_SERVER_KEYS TRUST_PROXY ALERT_EMAILS DATABASE_URL DATABASE_MIGRATION_URL` and every `R2_*` unset. RED runs wrapped in `timeout 90` (Japa hangs after an import error). The full suite runs under `flock /home/blank/Coding/tattoo-drip-wt/td-platform-suite.lock` with `queue_jobs` emptied first.
- No push, PR or merge without the owner's word. Codex review (codex-review skill) before any PR.

## Review Focus

1. **A visitor-made `X-Forwarded-For` or `CF-Connecting-IP`.** Only the address Cloudflare gives may reach the apps; a request not from cloudflared's address must be seen as its own socket address. Pinned in Task 4's nginx checks (trusted and untrusted sender).
2. **A private image fetched through an R2 signed URL arriving without `private, no-store`.** The S3 driver drops the fs driver's signed `cacheControl` option, so the header must be stored on the object. Pinned in Task 2 (every private `put` carries it) and re-checked by hand on deploy day.
3. **Production started with the R2 settings missing or half set**, which would quietly write photos to the container's disk. Pinned in Task 1.
4. **A backup that fails silently:** a dump or an upload error must exit non-zero and never ping the heartbeat's success URL. Pinned in Task 5's failure case.
5. **Tokens in logs:** deposit, reset, verify and invitation paths must not appear in nginx's access log, while ordinary paths do. Pinned in Task 4.

---

### Task 0: Setup

**Files:** none changed besides committing the spec and this plan.

- [ ] **Step 1: Commit the spec and plan**

```bash
git add docs/superpowers/specs/2026-10-31-single-server-deploy-design.md docs/superpowers/plans/2026-10-31-single-server-deploy.md
git commit -m "docs: design and plan for the single-server deploy"
```

- [ ] **Step 2: Install dependencies in the worktree**: `pnpm install --frozen-lockfile`. Expected: exit 0.

- [ ] **Step 3: Create the throwaway DB `tattoo_drip_deploy`** in `tattoo-drip_postgres_1`, grants only: `CREATE DATABASE tattoo_drip_deploy` as `postgres`, then pipe `apps/platform/database/setup_roles.sql` with its `ALTER ROLE :"app_user" LOGIN ... PASSWORD` line removed (`-v app_user=tattoo_drip_app -v owner_user=postgres`). Migrate it as the owner with the Global Constraints env, then `git checkout -- apps/platform/database/schema.ts` if the generator rewrote it.
Expected: `node ace migration:status --connection=owner` shows no pending migration.

- [ ] **Step 4: Baseline**: run `tests/unit/services/app_origin.spec.ts` and `tests/functional/media/image_service.spec.ts`. Expected: all pass.

---

### Task 1: R2 settings and the production rule

**Files:**
- Create: `apps/platform/app/services/storage_settings.ts`
- Modify: `apps/platform/start/env.ts` (declare six settings; check after `Env.create`, next to `checkAppOrigin`)
- Modify: `apps/platform/.env.example` (the six settings, commented, with one line on what they are)
- Test: `apps/platform/tests/unit/services/storage_settings.spec.ts`

**Interfaces:**
- Produces:
  - `export const R2_SETTINGS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BUCKET", "R2_PRIVATE_BUCKET", "R2_PUBLIC_URL"] as const`
  - `export type R2Settings = { accountId: string; accessKeyId: string; secretAccessKey: string; publicBucket: string; privateBucket: string; publicUrl: string }`
  - `export type StorageSettings = { kind: "local" } | ({ kind: "r2" } & R2Settings)`
  - `export function checkStorageSettings(values: Partial<Record<(typeof R2_SETTINGS)[number], string | undefined>>, production: boolean): StorageSettings`. Imports nothing from the app, like `trust_proxy.ts`.

- [ ] **Step 1: Write the failing tests** (group `"R2 settings at boot (TAT-27)"`):
  - `"no R2 setting outside production means local folders"`: `checkStorageSettings({}, false)` deep-equals `{ kind: "local" }`; same with every value `""` or `"  "`.
  - `"production refuses local folders"`: `checkStorageSettings({}, true)` throws `/are required in production: photos are never stored on the server's disk/`.
  - `"some settings without the others name the missing ones"`: only `R2_ACCOUNT_ID` and `R2_PUBLIC_BUCKET` set, `production` false → throws `/Missing R2 settings: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PRIVATE_BUCKET, R2_PUBLIC_URL \(set all six or none\)/`.
  - `"all six give the R2 settings, trimmed, the public URL as an origin with a slash"`: valid values (`accountId` = 32 lowercase hex chars, buckets `tattoo-drip-public` / `tattoo-drip-private`, `R2_PUBLIC_URL` `" https://media.tattoodrip.app "`) → `{ kind: "r2", ..., publicUrl: "https://media.tattoodrip.app/" }`.
  - `"refuses an account ID that is not 32 hex characters"` → `/R2_ACCOUNT_ID must be the 32-character account ID/` (try 31 chars, uppercase hex, a URL).
  - `"refuses a bad bucket name"` for `R2_PUBLIC_BUCKET` `"Tattoo_Drip"`, `"ab"`, `"-abc"` → `/R2_PUBLIC_BUCKET must be an R2 bucket name/`; same rule for the private one.
  - `"refuses one bucket for both"` → `/R2_PUBLIC_BUCKET and R2_PRIVATE_BUCKET must be different buckets/`.
  - `"refuses a public URL that is not an https origin"`: `http://media.tattoodrip.app`, `https://media.tattoodrip.app/photos`, `https://media.tattoodrip.app/?a=1`, `media.tattoodrip.app` → `/R2_PUBLIC_URL must be an https origin with no path, e.g. https:\/\/media.tattoodrip.app/`.
  - `"an error never prints the secret"`: a failing check whose `R2_SECRET_ACCESS_KEY` is `"secret-canary-123"` → the thrown message does not include `secret-canary-123`.

- [ ] **Step 2: Run it to verify it fails** (`timeout 90 pnpm test unit --files=storage_settings.spec.ts`). Expected: "Cannot find module" for `#services/storage_settings`, exit 124.

- [ ] **Step 3: Implement `checkStorageSettings`.** Rules in the order the tests list them: trim each value (blank = unset), all unset → local or the production refusal, partial → the missing list in `R2_SETTINGS` order, account `/^[0-9a-f]{32}$/`, bucket `/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/`, buckets differ, public URL parsed with `new URL`, protocol `https:`, `pathname === "/"`, no search or hash → `` `${url.origin}/` ``.

- [ ] **Step 4: Wire `start/env.ts`.** Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_URL` as `Env.schema.string.optional()` and `R2_SECRET_ACCESS_KEY` as `Env.schema.secret.optional()`, with a comment in the file's style (production: both disks on R2, TAT-27; unset in development and tests: local folders). After `Env.create`, call `checkStorageSettings` with the six values (the secret `.release()`d) and `env.get("NODE_ENV") === "production"`.

- [ ] **Step 5: Run the tests**: the new spec plus `app_origin.spec.ts`. Expected: PASS. `pnpm typecheck` in `apps/platform`: exit 0.

- [ ] **Step 6: Commit**: `feat(platform): R2 settings, required in production (TAT-27)`.

---

### Task 2: R2 disks and stored Cache-Control

**Files:**
- Modify: `apps/platform/package.json` and `pnpm-lock.yaml`: add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, same exact version (`--save-exact`), the newest release satisfying flydrive's `^3.577.0` peer range that pnpm's release-age rule accepts. Review the lockfile diff: only the AWS SDK tree is added. If auto mode refuses the install, stop and ask the owner to run the exact `pnpm --filter @tattoo-drip/platform add --save-exact ...` command with `!`.
- Modify: `apps/platform/app/services/storage_settings.ts` (add `r2DiskOptions`)
- Modify: `apps/platform/config/drive.ts` (pick the disks from `checkStorageSettings`; update its comment)
- Modify: `apps/platform/app/modules/media/services/image_service.ts` (both `put` calls pass the stored Cache-Control)
- Modify: `apps/platform/tests/helpers/storage_failures.ts` (add `recordPuts`)
- Test: `apps/platform/tests/unit/services/storage_settings.spec.ts` (new group), `apps/platform/tests/functional/media/image_service.spec.ts`

**Interfaces:**
- Consumes: `checkStorageSettings`, `R2Settings` (Task 1).
- Produces:
  - `export function r2DiskOptions(settings: R2Settings, visibility: "public" | "private")` returning flydrive `S3DriverOptions`: `{ credentials: { accessKeyId, secretAccessKey }, region: "auto", endpoint: "https://<accountId>.r2.cloudflarestorage.com", bucket: <public or private bucket>, visibility, supportsACL: false }`, plus `cdnUrl: publicUrl` for `"public"` only. R2 has no ACLs, so `supportsACL` must be false.
  - `export const STORED_CACHE_CONTROL = { public: "no-cache", private: PRIVATE_CACHE_CONTROL } as const` in `image_service.ts`.
  - `export function recordPuts(visibility: "public" | "private"): { puts: { key: string; options: unknown }[]; restore(): void }`, written for real like `failPuts`.

- [ ] **Step 1: Write the failing tests**
  - Unit group `"R2 disks (TAT-27)"`:
    - `"public disk: the bucket, R2's endpoint, no ACLs and the media origin"`: `r2DiskOptions(valid, "public")` deep-equals the object above with the public bucket and `cdnUrl: "https://media.tattoodrip.app/"`.
    - `"private disk: the private bucket and no public URL"`: no `cdnUrl` key at all.
    - `"a public URL is on the media origin"`: `new S3Driver(r2DiskOptions(valid, "public")).getUrl("tenants/t1/artist_work_photo/a.jpg")` equals `"https://media.tattoodrip.app/tenants/t1/artist_work_photo/a.jpg"` (no network).
    - `"a private signed URL is R2's, for 5 minutes"`: `getSignedUrl(key, { expiresIn: "5 minutes" })` on the private driver → host `<accountId>.r2.cloudflarestorage.com`, path contains the bucket and key, `X-Amz-Expires=300` (presigning is local).
  - Functional, in `image_service.spec.ts`:
    - `"a public image and its copies are stored with Cache-Control no-cache (TAT-27)"`: `recordPuts("public")`, store a work photo large enough to get copies → every recorded put's options include `cacheControl: "no-cache"`; `restore()` in `finally`.
    - `"a private image and its copies are stored with Cache-Control private, no-store (TAT-27)"`: the same for `reference_image` on `"private"`, expecting `"private, no-store"`.

- [ ] **Step 2: Run them to verify they fail.** Expected: `r2DiskOptions` is not exported (unit), and the options lack `cacheControl` (functional).

- [ ] **Step 3: Add the dependencies** (see Files), then implement `r2DiskOptions`, `STORED_CACHE_CONTROL` and the two `put` calls (`cacheControl: STORED_CACHE_CONTROL[IMAGE_PURPOSES[purpose].visibility]`). Then `config/drive.ts`: call `checkStorageSettings` (same values as `env.ts`) and use `services.s3(r2DiskOptions(settings, "public" | "private"))` for `kind: "r2"`, else today's two `services.fs` disks unchanged. The `link()` call keeps passing `cacheControl` (the fs disk signs it; the S3 driver ignores it, so the stored header carries it there).

- [ ] **Step 4: Run the tests**: both specs, plus `file_serving.spec.ts`, `artist_photo.spec.ts` and `intake_service.spec.ts` (other drive users). Expected: PASS. `pnpm typecheck`: exit 0.

- [ ] **Step 4b: Check for code the R2 switch would miss.**
  - `rg -n "/uploads|/files/|makePath\(\"storage|tmpPath\(\"storage" apps/platform/app apps/platform/inertia apps/platform/start apps/storefront/src`: expected matches are only `config/drive.ts`, test-only paths and comments.
  - `rg -n "crossOrigin|getImageData|toBlob|fetch\(" apps/platform/inertia apps/storefront/src`: look for script that fetches an image URL (which would need CORS on a bucket).
  - Record both findings in the commit body. If a script fetch exists, add the bucket CORS rule to Task 7's Cloudflare runbook.

- [ ] **Step 5: Commit**: `feat(platform): store photos on R2 in production, cache headers on every object (TAT-27)`.

---

### Task 3: Container images

**Files:**
- Create: `Dockerfile` (repo root, multi-stage, final targets `platform` and `storefront`)
- Create: `.dockerignore`

**Interfaces:**
- Produces: image target `platform`, working dir `/app` = the platform's `node ace build` output with production `node_modules`; default command `node bin/server.js`; worker `node ace.js queue:work`; migrations `node ace.js migration:run --connection=owner --force`. Image target `storefront`, working dir `/app` = the storefront's `.output` plus the production `node_modules` its server needs (Nitro keeps `@sentry/*` external); command `node --import ./.output/server/instrument.server.mjs .output/server/index.mjs`, listening on `PORT` 3000. Both run as the `node` user with `NODE_ENV=production`.

- [ ] **Step 1: Write `.dockerignore`.** Exclude `.git`, every `node_modules`, `apps/platform/build`, `apps/storefront/.output`, `tmp`, `storage`, `.superpowers`, `.claude`, `apps/platform/.neon`, and **every `.env*` file** (`**/.env*`): no settings enter the build context.

- [ ] **Step 2: Write the `Dockerfile`.** Base `node:24.3.0-bookworm-slim`; `corepack enable` + pnpm `12.8.1`; dependencies with `pnpm fetch` / `pnpm install --frozen-lockfile --offline` (layer cache on the lockfile); `pnpm --filter @tattoo-drip/platform build` and `pnpm --filter @tattoo-drip/storefront build`; production `node_modules` per app with `pnpm deploy --prod` (or the builder's equivalent); final stages copy only build output and production modules. Build-time memory: `NODE_OPTIONS=--max-old-space-size=2048`.

- [ ] **Step 3: Build both images within 3 GB** (stand-in for the 4 GB server):
`podman build --memory=3g --target platform -t td-platform:test .` and the same for `storefront`.
Expected: both succeed. Report the build time and the image sizes.

- [ ] **Step 4: Check the images**
  - `podman run --rm td-platform:test node --version` → `v24.3.0`; the same for `td-storefront:test`.
  - `podman run --rm td-platform:test id -u` → not `0`; the same for storefront.
  - `podman run --rm td-platform:test node -e "import('@japa/runner').then(()=>process.exit(1),()=>process.exit(0))"` → exit 0 (no dev dependencies).
  - `podman run --rm td-platform:test sh -c 'ls -a; find / -name ".env*" -not -path "/proc/*" 2>/dev/null'`: `bin/`, `ace.js`, `node_modules/` present; no `.env` file anywhere.
  - Storefront serves: run it with `NODE_ENV=production API_URL=https://tattoodrip.app STOREFRONT_URL=https://{tenant}.tattoodrip.page TURNSTILE_SITE_KEY=1x00000000000000000000AA STOREFRONT_SERVER_KEY=<any 32+ chars>` and `-p 127.0.0.1:3999:3000`, then `curl -s -o /dev/null -w '%{http_code}' -H 'Host: nosuch.tattoodrip.page' http://127.0.0.1:3999/` → an HTTP status (the API is unreachable, so 503 is fine), not a refused connection. Stop the container.

- [ ] **Step 5: Commit**: `build(deploy): container images for the platform and the storefront`.

---

### Task 4: Production compose, postgres init and nginx

**Files:**
- Create: `deploy/compose.yml`
- Create: `deploy/postgres/20-app-role-timeout.sh`
- Create: `deploy/nginx/nginx.conf`, `deploy/nginx/proxy.conf` (the shared `proxy_*` lines, included by every location)
- Create: `deploy/env/platform.env.example`, `migrate.env.example`, `storefront.env.example`, `postgres.env.example`, `backup.env.example`, `tunnel.env.example`: every setting with a placeholder and one comment line each; no real values
- Create: `deploy/test/nginx/compose.yml`, `deploy/test/nginx/echo.mjs`, `deploy/test/nginx/check.mjs`, `deploy/test/nginx/run.sh`

**Interfaces:**
- Consumes: the image targets (Task 3).
- Produces (later tasks rely on these names):
  - Compose services `postgres`, `web`, `worker`, `storefront`, `nginx`, `cloudflared`, plus `migrate` and `backup` under profile `tools` (`backup` is added in Task 5).
  - `env_file`s read from `${TD_ENV_DIR:-/srv/tattoo-drip/env}/<name>.env`: `postgres.env` (postgres), `platform.env` (web, worker), `platform.env` + `migrate.env` (migrate), `storefront.env`, `tunnel.env` (cloudflared), `backup.env` (Task 5).
  - Network `tattoo_drip`, subnet `172.30.42.0/24`, nginx `172.30.42.10`, cloudflared `172.30.42.20`.
  - Postgres data volume `postgres_data`.

- [ ] **Step 1: Write `deploy/compose.yml`.**
  - **postgres:** the pinned `postgres:18.x` image, the `postgres.env` file (`POSTGRES_USER=postgres`, `POSTGRES_DB=tattoo_drip`, `POSTGRES_PASSWORD`, `APP_DB_USER=tattoo_drip_app`, `APP_DB_PASSWORD`), a `pg_isready` healthcheck. It mounts `../docker/postgres/init/10-setup-roles.sh`, `./postgres/20-app-role-timeout.sh` and `../apps/platform/database/setup_roles.sql` (at `/opt/setup_roles.sql`) the way the root `docker-compose.yml` does.
  - **web**, **worker**, **migrate:** built from `..` with `target: platform`, sharing one `image:` name.
  - **storefront:** `target: storefront`.
  - **nginx:** the pinned nginx image, config mounted read-only.
  - **cloudflared:** the pinned `cloudflare/cloudflared` image, `tunnel --no-autoupdate run`, with `TUNNEL_TOKEN` from `tunnel.env`.
  - **Every service:** `restart: unless-stopped` (the tools excepted), and a shared `json-file` logging anchor with `max-size: 10m`, `max-file: "3"`.
  - **Healthchecks:** web and storefront check with a `node -e "fetch(...)"` one-liner that passes on any HTTP status below 500.
  - **Start order:** web, worker and migrate depend on postgres being healthy.

- [ ] **Step 2: Write `20-app-role-timeout.sh`**: `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"` running `ALTER ROLE` for `$APP_DB_USER` `SET idle_in_transaction_session_timeout = '3min'` (quoted as an identifier with `:"app_user"`, like `10-setup-roles.sh`).

- [ ] **Step 3: Write the nginx test harness first** (`deploy/test/nginx/`).
  - **`compose.yml`:** runs the real `deploy/nginx` config with two stand-in upstreams named `web` and `storefront`. Each is a `node:24.3.0-bookworm-slim` container running `echo.mjs`, which answers JSON `{ upstream, headers, remote }` and reads the whole body. Two client containers also run on the subnet: `trusted` at `172.30.42.20` and `outsider` at `172.30.42.99`.
  - **`run.sh`:** brings it up (`COMPOSE` env, default `docker compose`; `podman-compose` locally), runs `check.mjs` from each client, then greps nginx's logs, tears down, and prints `nginx: all checks passed` or exits non-zero.
  - **Checks:**
    1. `Host: tattoodrip.app` → `upstream: "web"`; `Host: drip-tattoo.tattoodrip.page` and `Host: tattoodrip.page` → `"storefront"`; `Host: evil.example` → the connection closes with no response.
    2. From `trusted` with `CF-Connecting-IP: 203.0.113.7` and `X-Forwarded-For: 1.2.3.4, 5.6.7.8` → the upstream sees `x-forwarded-for` exactly `203.0.113.7`, `x-forwarded-proto` `https`, and `host` unchanged.
    3. From `outsider` with the same headers → `x-forwarded-for` exactly `172.30.42.99`.
    4. A 22 MB POST → 413; a 20 MB POST → 200.
    5. Requests to `/api/v1/tenants/x/deposits/tok-canary-1`, `/reset-password/tok-canary-2`, `/verify-email/tok-canary-3` and `/invitations/tok-canary-4` reach the upstream (200), and nginx's access log has none of the `tok-canary-` strings, while a `/login` request is logged.

- [ ] **Step 4: Run `bash deploy/test/nginx/run.sh`** with `COMPOSE=podman-compose`. Expected: it fails (no `deploy/nginx` config yet).

- [ ] **Step 5: Write `deploy/nginx/nginx.conf` and `proxy.conf`.**
  - The Global Constraints values.
  - `set_real_ip_from 172.30.42.20; real_ip_header CF-Connecting-IP;`
  - `proxy.conf` sets `X-Forwarded-For $remote_addr` (replacing it, not `$proxy_add_x_forwarded_for`), `X-Forwarded-Proto https`, `Host $host` and `X-Real-IP $remote_addr`.
  - Upstreams `web:3333` and `storefront:3000` with `keepalive_timeout 4s`.
  - Server blocks for `tattoodrip.app` → web, `tattoodrip.page *.tattoodrip.page` → storefront, and a `default_server` returning 444.
  - The two token regex locations with `access_log off` and the same proxy settings.
  - Access and error logs to stdout and stderr.

- [ ] **Step 6: Run the harness again.** Expected: `nginx: all checks passed`.

- [ ] **Step 7: Validate the production file**: `TD_ENV_DIR=deploy/env-check podman-compose -f deploy/compose.yml config`. Here `deploy/env-check` is a temporary copy of the examples renamed to `*.env`, created in the session scratchpad, never committed. Expected: exit 0 and no published `ports`.

- [ ] **Step 8: Commit**: `feat(deploy): production compose stack and nginx with Cloudflare's visitor address`.

---

### Task 5: Nightly backup

**Files:**
- Create: `deploy/backup/Dockerfile` (FROM the same pinned `postgres:18.x` as compose, plus `rclone`, `curl` and `ca-certificates` from Debian apt)
- Create: `deploy/backup/backup.sh`
- Modify: `deploy/compose.yml` (service `backup`, profile `tools`, build `./backup`, env file `backup.env`, depends on postgres)
- Create: `deploy/systemd/tattoo-drip-backup.service`, `deploy/systemd/tattoo-drip-backup.timer`
- Create: `deploy/test/backup/run.sh`

**Interfaces:**
- Consumes: services `postgres` and network (Task 4).
- Produces: `backup.sh`, configured only by env:
  - **Connection:** `PGHOST` (default `postgres`), `PGUSER`, `PGPASSWORD`, `PGDATABASE`.
  - **Destination:** `BACKUP_DEST`, an rclone path, default `r2:tattoo-drip-backups/db`. The `r2` remote is defined by `RCLONE_CONFIG_R2_TYPE=s3`, `RCLONE_CONFIG_R2_PROVIDER=Cloudflare`, `..._ACCESS_KEY_ID`, `..._SECRET_ACCESS_KEY` and `..._ENDPOINT`.
  - **Retention and alert:** `BACKUP_KEEP_DAYS` (default `30`) and an optional `HEARTBEAT_URL`.
  - **Output:** one line per step, ending in `backup: ok <file name> <size>`.

- [ ] **Step 1: Write the test `deploy/test/backup/run.sh`.**
  - **Setup:** start a throwaway `postgres:18.x` container on a private network, create two tables with a few rows, and build the backup image.
  - **Success case:** run the backup with `BACKUP_DEST=/backups/db` (a local path, which rclone accepts) on a mounted temp dir. Expect exit 0, one `.dump` file, and `pg_restore --list` reading it.
  - **Restore case:** restore into a new database `restore_check` and compare `count(*)` per table between the two databases (they must be equal).
  - **Retention case:** create an old file with `touch -d '40 days ago'`, run the backup again, and check the old file is gone while the new ones stay.
  - **Failure case:** `BACKUP_DEST=nosuchremote:x` and `HEARTBEAT_URL=http://127.0.0.1:9/hb` → exit non-zero, and the output has no `heartbeat: ok` line.
  - **Finish:** tear down, then print `backup: all checks passed`.

- [ ] **Step 2: Run it.** Expected: it fails (no image yet).

- [ ] **Step 3: Write `backup.sh` and its Dockerfile.**
  - `set -euo pipefail`; the file name is `tattoo_drip-$(date -u +%Y%m%dT%H%M%SZ).dump`.
  - `pg_dump --format=custom` to a temp file, then `pg_restore --list` on it (catches a truncated dump).
  - `rclone copyto` to `$BACKUP_DEST/<name>`, then `rclone delete --min-age ${BACKUP_KEEP_DAYS}d $BACKUP_DEST`.
  - Remove the temp file.
  - **Heartbeat on success:** with `HEARTBEAT_URL` set, `curl -fsS --retry 3 "$HEARTBEAT_URL"` and print `heartbeat: ok`.
  - **Heartbeat on failure:** an `ERR` trap pings `"$HEARTBEAT_URL/fail"` (best effort) before exiting non-zero.
  - Never print an env value.

- [ ] **Step 4: Write the systemd units.**
  - **Service:** `Type=oneshot`, `WorkingDirectory=/srv/tattoo-drip/app`, running `docker compose -f deploy/compose.yml --profile tools run --rm backup`.
  - **Timer:** `OnCalendar=*-*-* 02:00:00 Asia/Kathmandu`, `Persistent=true`, `RandomizedDelaySec=5m`.
  - **Check:** `systemd-analyze verify deploy/systemd/*.service deploy/systemd/*.timer` → no errors beyond the absent paths.

- [ ] **Step 5: Run the test.** Expected: `backup: all checks passed`.

- [ ] **Step 6: Commit**: `feat(deploy): nightly database backup to R2 with a heartbeat`.

---

### Task 6: The deploy command

**Files:**
- Create: `deploy/deploy.sh`

**Interfaces:**
- Consumes: compose services and profile names (Tasks 4–5).
- Produces: `deploy/deploy.sh [git-ref]` (default `origin/main`). It honours `COMPOSE` (default `docker compose`), `TD_ENV_DIR` and `TD_COMPOSE_FILES`, a colon-separated list of compose files (default `deploy/compose.yml`), used by Task 8's smoke run.

- [ ] **Step 1: Write `deploy.sh`.** It runs from the repo root with `set -euo pipefail`:
  1. Refuse with a clear message when `git status --porcelain` is not empty.
  2. `git fetch origin`, then `git checkout --detach <ref>`, and print the commit.
  3. Build the `web`, `storefront` and `backup` images.
  4. `up -d postgres` and wait for it to be healthy, giving up after 60 s.
  5. `--profile tools run --rm migrate`. If it fails, stop here and print that the old containers are still serving.
  6. `up -d --remove-orphans web worker storefront nginx cloudflared`.
  7. Wait up to 120 s for web and storefront to be healthy.
  8. Print the services' status and `deployed <short sha>`.

- [ ] **Step 2: Check it**: `bash -n deploy/deploy.sh`, plus a run with local changes present, which must refuse (`echo x >> README.md; deploy/deploy.sh; git checkout README.md`). Expected: the refusal message and exit 1. Its full run is Task 8.

- [ ] **Step 3: Commit**: `feat(deploy): one command to build, migrate and restart`.

---

### Task 7: Runbooks and docs

**Files:**
- Create: `deploy/README.md`: the owner's runbooks, copy-paste commands, no secrets.
- Modify: `apps/platform/docs/deploy.md`
- Modify: `apps/platform/docs/backend.md` (the media bullets that name TAT-27)
- Modify: `apps/storefront/src/tenancy/visitor.ts` (comment only)
- Modify: `docs/README.md` (index entry for `deploy/README.md`)

- [ ] **Step 1: Write `deploy/README.md`** with these sections, each a numbered list the owner follows:
  1. **Server:** Ubuntu 24.04; sudo user; SSH keys only (`PasswordAuthentication no`, `PermitRootLogin no`); `ufw` allowing only SSH; `unattended-upgrades`; Docker Engine from Docker's apt repository; 2 GB swap; timezone left at UTC; a read-only GitHub deploy key; clone to `/srv/tattoo-drip/app`; `/srv/tattoo-drip/env` owned by the sudo user, mode 700, files 600.
  2. **Cloudflare:**
     - The tunnel (remote-managed) with public hostnames `tattoodrip.app`, `tattoodrip.page` and `*.tattoodrip.page`, all pointing to `http://172.30.42.10:80`.
     - SSL/TLS "Always Use HTTPS".
     - R2 buckets `tattoo-drip-public` (custom domain `media.tattoodrip.app`), `tattoo-drip-private` (no public access) and `tattoo-drip-backups`. Each bucket's location hint is Asia-Pacific.
     - Two R2 API tokens: one for the image buckets with object read and write, one for the backups bucket only.
     - A Turnstile widget for `tattoodrip.page`.
     - Optionally one rate-limiting rule.
  3. **Settings:** copy each `deploy/env/*.env.example` to `/srv/tattoo-drip/env/<name>.env` and fill it in.
     - Every generated secret uses `openssl rand -hex 32`, except `APP_KEY`, which needs a command that prints a valid key without the env files existing yet (they don't, on first setup). Check what format `config/app.ts` and the encryption config accept, pick the command, and prove the key boots in Task 8.
     - The production values listed in the spec's "Production settings" table.
  4. **First start:** `deploy/deploy.sh`, then the deploy-day checks from the spec. Confirm the pilot owner's account with `docker compose -f deploy/compose.yml --profile tools run --rm migrate node ace.js account:verify <email>`.
  5. **Updates:** `deploy/deploy.sh`, best at quiet hours. Going back is `deploy/deploy.sh <previous sha>`.
  6. **Backups:** install the systemd units (`sudo cp deploy/systemd/* /etc/systemd/system/ && sudo systemctl enable --now tattoo-drip-backup.timer`), create the healthchecks.io check (daily, 2 h grace), and run one backup by hand.
  7. **Restore:** list the backups with `rclone lsf`, download one, stop web and worker, `pg_restore --clean --if-exists` as the owner into `tattoo_drip`, start them again. Also a practice restore into a scratch database with row counts, done once on deploy day.
  8. **When something is wrong:** `docker compose ps` and `logs <service>`; a disk-full check; the server rebooted.

- [ ] **Step 2: Update `apps/platform/docs/deploy.md`.**
  - A short "This deploy: one server" section near the top, pointing to `deploy/README.md`.
  - The reverse-proxy bullet about `$proxy_add_x_forwarded_for` now says this setup replaces the header with Cloudflare's address. Keep the general rule for other setups.
  - `TRUST_PROXY` here is nginx's address, not Cloudflare's ranges, because the tunnel connects from inside the network.
  - The Vercel mentions now read "the storefront's host". The two-domains rule stays.
  - "Still required before any public deploy: object storage (TAT-27)" becomes done.

- [ ] **Step 3: Update `backend.md`.**
  - Production disks are R2.
  - The stored Cache-Control values and why: removed photos stop at once, TAT-116.
  - The "keys never change, so `max-age, immutable` is safe once TAT-27 or a CDN serves them" note becomes: not used, because of TAT-116's promise; purge-on-delete is the later option.
  - The orphan sweep now points to the follow-up ticket. The orchestrator gives its number; until then, write "follow-up to TAT-27".

- [ ] **Step 4: Update the comment in `visitor.ts`.** It should say the first `X-Forwarded-For` value is trustworthy because the edge replaces it: Vercel's edge, or this deploy's nginx (`deploy/nginx`). No code change.

- [ ] **Step 5: Add the index line in `docs/README.md`.** Then run `pnpm check`: exit 0.

- [ ] **Step 6: Commit**: `docs(deploy): runbooks for the server, Cloudflare, backups and restore`.

---

### Task 8: Production-mode smoke run and gates

**Files:**
- Create: `deploy/test/compose.smoke.yml`, an override that publishes nginx on `127.0.0.1:8088:80` and puts `cloudflared` under profile `disabled`.

- [ ] **Step 1: Make a scratch settings dir** in the session scratchpad (never in the repo), filled from the examples with throwaway values. `APP_KEY` comes from the command Task 7 documents, so this run proves it.
  - HTTPS URLs on the real hostnames, and Turnstile's published test secret `1x0000000000000000000000000000000AA`.
  - A generated server key and passwords.
  - Fake but well-formed `R2_*` values. Boot accepts them; uploads would fail, so none are tried.
  - `ALERT_EMAILS=false`, and placeholder `SMTP_*` values.

- [ ] **Step 2: Run the real deploy command locally**: `TD_ENV_DIR=<scratch> TD_COMPOSE_FILES=deploy/compose.yml:deploy/test/compose.smoke.yml COMPOSE=podman-compose deploy/deploy.sh HEAD`, then `git switch harublank00/deploy-single-server` to re-attach the worktree.
  Expected: migrations run on the empty database, ending in `deployed <sha>`, and web and storefront are healthy.

- [ ] **Step 3: Check through nginx**
  - `curl -s -o /dev/null -w '%{http_code}' -H 'Host: tattoodrip.app' http://127.0.0.1:8088/login` → `200`. The response sets `__Host-td-session` with `Secure`, `HttpOnly` and `SameSite=Lax`.
  - `curl -s -H 'Host: tattoodrip.app' http://127.0.0.1:8088/api/v1/tenants/nosuch` → the API's 404 JSON.
  - `curl -s -o /dev/null -w '%{http_code}' -H 'Host: nosuch.tattoodrip.page' http://127.0.0.1:8088/` → `404`.
  - `logs worker` shows it started and is polling; `logs web` has no error.
  - The app role has the 3-minute timeout: `psql` as postgres, `select rolconfig from pg_roles where rolname = 'tattoo_drip_app'` → contains `idle_in_transaction_session_timeout=3min`.
  - Restart: `podman-compose ... restart`, then web and storefront are healthy again.
  - Tear down with volumes.

- [ ] **Step 4: Storefront page check**: in `apps/storefront`, `pnpm build && pnpm check:page`. Expected: pass.

- [ ] **Step 5: Gates**: `pnpm check`, `pnpm typecheck`, `pnpm build`, the platform's full suite under the lock (Global Constraints), and `pnpm test` for storefront, sdk and react. Expected: all green. Report the counts.

- [ ] **Step 6: Commit** the smoke override: `test(deploy): production-mode smoke run behind nginx`.

- [ ] **Step 7: Tear down** the throwaway DB `tattoo_drip_deploy` only when the owner says the branch is done. Check `pgrep -af "bin/test.ts|ace test"` and kill your own leftovers by exact PID.
