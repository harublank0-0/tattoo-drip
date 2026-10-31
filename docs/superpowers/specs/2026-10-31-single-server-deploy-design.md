# Deploy on one server, at minimal cost

Date: 2026-10-31
Refs: TAT-14 (platform hosting), TAT-27 (object storage, R2), TAT-13 (storefront hosting; this design replaces its Vercel plan). Production rules this design must keep: `apps/platform/docs/deploy.md`.
Base: `main` at `b7c1c945`.

## Why

The owner asked to "deploy our project at minimal cost". Tattoo Drip launches in Nepal with one pilot studio, the owner's friend's shop, and has to prove that studios use it and pay for it before it is worth spending on. Running costs should stay small and flat until it does: one or two paying studios should cover them.

The owner builds and runs it alone, so the setup must also be simple enough for one person to keep alive: one place to look, one command to ship an update, and backups that are known to work.

## Decisions the owner made

- **One server for everything**, looked after by the owner ("one server is fine, go with it"). Not Vercel: its free plan forbids commercial use, and Pro is $20/month. Not Neon: its free plan gives 100 compute-hours a month, and the worker polls the job queue around the clock, so the database would never sleep (about $19/month on the paid plan). The Neon project can sit idle; branch `chore/neon-postgres` stays unmerged.
- **Domains:** `tattoodrip.app` for the dashboard and the API, and `tattoodrip.page` for the studio pages (`<slug>.tattoodrip.page`), both bought on Cloudflare Registrar ("keep tattoo drip, tattoodrip.app and tattoodrip.page"). Two separately registered names, as `deploy.md` (Dashboard cookies and domains) requires. Free `.com.np` names were ruled out: Mercantile only grants a name that matches the registrant, and Tattoo Drip is not a registered business yet.
- **Nightly database backups** to Cloudflare R2. Losing up to a day of changes is accepted for the pilot ("nightly backup is fine"); continuous backups come later, once studios pay.
- **Email stays off** for the pilot (`ALERT_EMAILS=false`). Accounts are confirmed by hand with `account:verify`, as `deploy.md` (Account email) describes. Resend comes with the sending domain (TAT-20).

## Goals

1. The pilot studio can be set up and used in production: the owner confirms its account, it builds its page, clients send requests with reference photos, and deposits work by screenshot.
2. Every rule in `deploy.md` holds: settings, processes, Node 24.3.0, the proxy rules, cookies and domains, the visitor's address.
3. Fixed monthly cost of about $8–17: the server plus the domains, with everything else on free plans.
4. One command ships an update: build, migrate, restart.
5. A nightly backup lands off the server, the owner hears about it when one fails, and restoring one is written down and has been done once.
6. The server survives a reboot without anyone touching it.

## Non-goals

- High availability, zero-downtime deploys, autoscaling, a staging server.
- Deploying on every push (CI/CD). The owner runs the deploy command.
- Continuous backups or point-in-time recovery (TAT-14 asked for PITR; deferred by the owner's choice).
- Email (TAT-20), custom studio domains (TAT-79), a marketing site on the apex domains.
- A monitoring stack. A free uptime check and the backup heartbeat are enough for the pilot.
- Moving development data to production. Production starts empty.

## Anti-goals

- Any charge that grows with traffic and can spike. Costs stay fixed or capped at free tiers.
- Secrets in git, in the image, in logs, or in front of Claude. The owner pastes them into env files on the server.
- Photos on the server's disk in production. `config/drive.ts` already says never to deploy the local disks.
- Postgres, the app or the storefront reachable from the internet except through Cloudflare.

## The shape

```
visitor ──https──> Cloudflare (DNS, TLS, Always Use HTTPS)
                      │  Cloudflare Tunnel (outbound from the server; no open web ports)
                      v
               ┌─ server (Docker) ─────────────────────────────────────────┐
               │ cloudflared ──> nginx ──┬─> platform web   (:3333)        │
               │                         └─> storefront     (:3000)        │
               │ platform worker                                            │
               │ postgres 18 (not published)                                │
               │ nightly backup job ──────────────> R2 bucket "backups"     │
               └────────────────────────────────────────────────────────────┘
platform web/worker ──> R2 "public" (media.tattoodrip.app) and R2 "private" (signed URLs)
```

**Hostnames**

| Host | Goes to | Notes |
| --- | --- | --- |
| `tattoodrip.app` | platform web | Dashboard and API (`/api/v1`) on one host. `APP_URL` and the storefront's `API_URL`. |
| `media.tattoodrip.app` | R2 public bucket (custom domain) | Public images: portfolio, flash, logos, covers, QR codes. Not cached at Cloudflare's edge for now (see 1, "Removed photos"). |
| `tattoodrip.page`, `*.tattoodrip.page` | storefront | Studio pages. `STOREFRONT_URL=https://{tenant}.tattoodrip.page`. The apex shows whatever the storefront shows today for a host with no studio. |

Both domains use Cloudflare's DNS (automatic when bought there). Cloudflare's free Universal SSL covers each apex and its first-level wildcard. `.app` and `.page` are HTTPS-only in browsers already.

**Why a tunnel (my call).** Cloudflare Tunnel is free, needs no open ports for the web (only SSH), needs no origin certificate, and no list of Cloudflare's addresses to keep up to date in a firewall. Visitors can't reach the server except through Cloudflare, which `deploy.md` (Recommended) asks for.

**Why nginx (my call; I said Caddy in chat).** Caddy's main advantage is automatic HTTPS, and here Cloudflare does the HTTPS. The proxy rules in `deploy.md` are written and reviewed for nginx (body limits, per-read timeouts, the regex locations that keep tokens out of the access log), so nginx takes them nearly as they are.

## The work

### 1. Photos on R2 (TAT-27)

Every image already goes through `ImageService` and the two drive disks (`public`, `private`) in `apps/platform/config/drive.ts`. Production points both disks at R2 through the drive's S3 driver. Development and tests keep the local folders.

- A setting picks the disks: local folders by default, R2 when configured. With `NODE_ENV=production` the web server, the worker and `ace` refuse to start on the local disks, like the other production checks in `start/env.ts`.
- Two buckets: `public` served at `https://media.tattoodrip.app` (the disk's public URL), and `private` with no public access. Private images keep today's contract: a signed URL valid for 5 minutes, and a response with `Cache-Control: private, no-store` that can't be stripped. The builder checks how the S3 driver's signed URL can carry that header (a response-header override in the signature, or the header stored on the object at upload) and that the browser receives it.
- Keys stay as they are (`tenants/<id>/<purpose>/…`); `assertKeyOf` and the purpose-to-disk rule don't change.
- One R2 token with read and write on the two image buckets only.
- CORS on a bucket only if something fetches images from script (an `<img>` needs none). The builder checks the dashboard and the storefront for such fetches.
- New dependencies: the AWS S3 client and request presigner that the S3 driver needs, at exact versions, with the lockfile change reviewed.
- Tests: the settings rule (production refuses local disks; R2 needs all its settings) and `ImageService` against an S3-compatible fake or a local S3 server, whichever the builder finds lighter. The real bucket is checked by hand on deploy day.
- Anything that reads a stored file from the local path or builds an `/uploads` or `/files` URL by hand must go through the drive instead. The builder searches for it.
- **Removed photos stop loading at once (my call).** `backend.md` promises that "a photo a client asked to take down is never reported removed while its URL still answers" (TAT-116), and flash designs are removed with their files too. R2 deletes take effect immediately, so the only risk is a cache. Every public object is stored with `Cache-Control: no-cache`, so Cloudflare and browsers check with R2 before each use (a cheap 304 while the file exists, a 404 once it is gone). This is how the local `/uploads` route behaves today (an ETag, revalidated every time). Each check is an R2 read, and the free 10 million reads a month cover about half a million studio page views. Longer caching with a purge on delete (it would need a Cloudflare token with cache-purge rights, and a rule for when a purge fails) is a later change, once traffic calls for it. The builder confirms on deploy day that a removed work photo's URL answers 404 right away.
- **The orphan sweep stays out of this build (my call).** `image_service.ts` and `backend.md` leave files that a failed best-effort delete or a crash left behind for "the orphan sweep of TAT-27". A sweep has to compare every studio's stored keys with the buckets: a cross-tenant read, which the database rules allow only through a new owner-role command or a new definer function, each needing its own security review. At pilot size such files are rare, and each one is already logged at error level with its purpose and key, so the operator can delete it by hand in R2. A follow-up ticket holds the sweep. It matters most for the private bucket, where an orphan can be a client's reference photo or payment screenshot.

### 2. Container images

- One Dockerfile for the pnpm workspace, building two images: **platform** (`node ace build` output; runs as web, as worker or as a one-off `ace` command, chosen by the command) and **storefront** (`pnpm build` output, run with its `start` script).
- Base image `node:24.3.0` (slim, Debian), matching `.nvmrc`; `deploy.md` explains why not 26.
- Runs as a non-root user. Production dependencies only in the final images.
- Images are built on the server by the deploy command, so no registry is needed. With 4 GB of memory plus 2 GB of swap the build must not get killed; the builder measures the peak and says if the server needs more.

### 3. Compose file for production

One compose file (separate from the development `docker-compose.yml` at the root) with: `postgres`, `web`, `worker`, `storefront`, `nginx`, `cloudflared`, plus a one-off `migrate` service and the `backup` job.

- **postgres:** `postgres:18`, data in a named volume, the existing init script (`docker/postgres/init`, `setup_roles.sql`) creates the app role on first start. Also on first start: `ALTER ROLE tattoo_drip_app SET idle_in_transaction_session_timeout = '3min'` (`deploy.md`, Database). Not published to the host.
- **web:** `node bin/server.js`; exactly one (it upserts the recurring schedules on boot).
- **worker:** `node ace.js queue:work`; same image and settings.
- **migrate:** `node ace.js migration:run --connection=owner --force`, the only service given the owner's password.
- One internal network with a fixed subnet, so `TRUST_PROXY` can name nginx's address. No service publishes a port.
- `restart: unless-stopped` everywhere, healthchecks, and log rotation (Docker's `max-size` and `max-file`) so logs can't fill the disk.
- Settings come from env files on the server (`/srv/tattoo-drip/env/*.env`, mode 600), one per role: platform, storefront, migrate, backup, tunnel.

### 4. nginx

The rules from `deploy.md` (Reverse proxy), adapted to the tunnel:

- Request buffering on, `client_max_body_size 21m`, `client_header_timeout 15s`, `client_body_timeout 30s`, `send_timeout 30s`, `proxy_read_timeout 130s`, upstream keep-alive below the app's 5 s.
- No access log for the deposit paths (`/api/v1/tenants/<slug>/deposits/…`) or the account links (`/reset-password/`, `/verify-email/`, `/invitations/`), using the regex locations that `deploy.md` gives.
- Hosts: `tattoodrip.app` to web; `tattoodrip.page` and `*.tattoodrip.page` to the storefront; anything else is closed without an answer.
- **The visitor's address.** nginx trusts only cloudflared's address, takes the visitor from `CF-Connecting-IP` (`real_ip_header`), and sends both apps an `X-Forwarded-For` holding that one address, replacing whatever the visitor sent. `X-Forwarded-Proto` is `https`. The platform's `TRUST_PROXY` is nginx's address only.

  This matters because the storefront takes the first `X-Forwarded-For` value as the visitor (`apps/storefront/src/tenancy/visitor.ts`), which was safe behind Vercel because Vercel replaces that header. Behind Cloudflare the header arrives with whatever the visitor put in it, so nginx must replace it, or anyone could pick the address that the rate limits count. No storefront code change is needed; its comment is updated to name this setup.

### 5. Nightly backup

- At about 02:00 Nepal time: `pg_dump --format=custom` of the database as the owner, uploaded to the private R2 bucket `backups` under a dated name, with a token that can reach that bucket only. Thirty days are kept (an R2 lifecycle rule, or the job deletes older files).
- On success the job pings a heartbeat URL (a free healthchecks.io check, my call), so the owner gets an email when a night is missed. With no URL set, it skips the ping.
- A restore page in the docs: list the backups, download one, restore it into a fresh database, point the app at it. On deploy day the owner restores one backup into a scratch database once and compares row counts.
- Not backed up: the photos in R2 (R2 itself is durable; a bug that deletes files can't be undone). Accepted for the pilot.

### 6. The deploy command

A script in the repo that the owner runs on the server:

1. Refuse to run with local changes in the server's checkout.
2. Fetch and check out the requested commit (default: `origin/main`).
3. Build both images.
4. Run migrations (`migrate`), and stop if they fail.
5. Restart web, worker and storefront, wait for their healthchecks, print what is running.

Downtime is a few seconds per deploy. Going back means running it with the previous commit; migrations are additive by convention, so the older code runs on the newer schema. The server pulls the repo with a read-only deploy key.

### 7. Runbooks for the owner (docs)

Step-by-step pages the owner follows with copy-paste commands. I can walk through them live.

- **Server:** Ubuntu 24.04; a sudo user; SSH keys only; firewall closed except SSH; automatic security updates; Docker Engine from Docker's repository; 2 GB swap; the repo in `/srv/tattoo-drip`; the env files.
- **Cloudflare:** the tunnel and its token; public hostnames `tattoodrip.app`, `tattoodrip.page`, `*.tattoodrip.page`; Always Use HTTPS; the three R2 buckets, the `media.tattoodrip.app` custom domain and the two scoped tokens; a Turnstile widget for `tattoodrip.page` and its subdomains; optionally one free rate-limiting rule.
- **Secrets to make:** `APP_KEY` (`node ace generate:key`), the storefront server key (`openssl rand -base64 32`), the database passwords, the R2 tokens, the tunnel token, the Turnstile keys.
- **`deploy.md`** gets a section for this setup and corrects the parts that assumed Vercel or a directly exposed proxy (`$proxy_add_x_forwarded_for`, Cloudflare's address ranges in `TRUST_PROXY`).

## Production settings

| Where | Settings |
| --- | --- |
| platform (web, worker) | `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3333`, `LOG_LEVEL=info`, `APP_KEY`, `APP_URL=https://tattoodrip.app`, `STOREFRONT_URL=https://{tenant}.tattoodrip.page`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY=<nginx's address>`, `TURNSTILE_SECRET_KEY`, `SESSION_DRIVER=cookie`, `DB_HOST=postgres`, `DB_PORT=5432`, `DB_DATABASE=tattoo_drip`, `DB_USER=tattoo_drip_app`, `DB_PASSWORD`, `DB_MIGRATION_USER` (name only), `ALERT_EMAILS=false`, the required `MAIL_*`/`SMTP_*` values (placeholders until TAT-20), the R2 settings |
| migrate | the platform's, plus `DB_MIGRATION_PASSWORD` |
| storefront | `NODE_ENV=production`, `API_URL=https://tattoodrip.app`, `STOREFRONT_URL`, `TURNSTILE_SITE_KEY`, `STOREFRONT_SERVER_KEY` |
| backup | the owner's password, the backups token, the heartbeat URL |
| cloudflared | the tunnel token |

## Cost

| Item | Cost |
| --- | --- |
| Server: 2 vCPU, 4 GB, 40+ GB SSD | about $6–15/month, by provider and region |
| `tattoodrip.app` | $8.20 the first year, then $14.20/year |
| `tattoodrip.page` | $10.20/year |
| Cloudflare DNS, proxy, Tunnel, Turnstile | free |
| R2 | free up to 10 GB stored, 1 million writes and 10 million reads a month (roughly 80–100 studios' photos) |
| healthchecks.io | free |

**The server (the owner buys it).** Ubuntu 24.04, x86-64 or ARM64, 2 vCPU, 4 GB of memory, 40 GB or more of SSD. Singapore or Mumbai are closest to Nepal. A European location is acceptable if it is much cheaper: it adds about 150 ms to each page's first byte, while photos come from Cloudflare's edge either way. Before the owner buys, I compare current prices from the providers' own pages.

## Deploy-day checks

- `deploy.md`, "After the first deploy", except the email checks (confirm the pilot account with `account:verify` instead).
- A request carrying a made-up `X-Forwarded-For` reaches both apps with the real address only. The builder writes the exact check.
- A work photo's URL is on `media.tattoodrip.app` and loads; after the photo is removed in the dashboard, the same URL answers 404 at once. A reference image sent with a request shows in the dashboard through a signed URL that stops working after 5 minutes, and its response says `private, no-store`.
- The backup job, run by hand, puts a file in R2; it restores into a scratch database with matching row counts; the heartbeat registers.
- After `sudo reboot`, every service comes back by itself.
- `curl` to the server's public address on ports 80, 443, 3333, 3000 and 5432 gets no answer.
- The storefront's `pnpm check:page` against the production build (`deploy.md`).

## Risks and known limits

- **One server is one point of failure.** If it dies: a new server, the runbook, and last night's backup. Up to a day of data lost, an hour or two to restore.
- **Cloudflare's free plan waits at most 100 s for an answer.** A dashboard upload slower than that gets Cloudflare's timeout page instead of the app's own 408 (the app allows 120 s). Rare on a 21 MB limit; accepted.
- **Building on the server** uses its memory and CPU for a few minutes per deploy; pages may slow down meanwhile. Deploy at quiet hours.
- **Cloudflare is in the path of everything:** DNS, TLS and the tunnel. If it is down, so is the site, as with any setup that uses it for DNS.
- **Data location:** clients' phone numbers and reference photos would be stored outside Nepal. The legal check (TAT-63) should cover the Individual Privacy Act 2075 on that.

## Left to the builder

- Dockerfile structure and how the workspace is pruned for each image.
- File layout of the compose file, the nginx config, the scripts and the runbooks.
- Names of the new R2 settings, and how the S3 fake or local server runs in tests.
- The backup tool (pg_dump plus rclone or the AWS CLI, in a container or from the host's cron).
- Healthcheck endpoints, if the apps need one.

## Tickets

- TAT-27 is built here, except the orphan sweep, which moves to a new follow-up ticket.
- TAT-14 is built here, with nightly backups in place of point-in-time recovery.
- TAT-13 changes from "Vercel deploy with wildcard domain" to the storefront on this server; its checks move into the deploy-day list.
