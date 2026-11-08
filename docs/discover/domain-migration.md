# Discover: domain migration

How Tattoo Drip moves from one platform host to three: Discover on `tattoodrip.app`, Studio OS on `app.tattoodrip.app`, the API on `api.tattoodrip.app`.
- **D01 (done):** prepared the configuration, routing and tests, and rehearsed the layout locally. It changed nothing in production.
- **D11 (prepared):** the server key, `/healthz`, Discover in `deploy.sh`, the launch smoke test, the release plan (G) and rollback (H), rehearsed in production mode (J2). The cutover itself (G, stage D) waits for the product owner's approval.

Plan and decisions: [implementation blueprint](implementation-blueprint.md). Server operations: [server runbook](../../deploy/README.md). Platform settings: [platform deploy](../../apps/platform/docs/deploy.md).

## A. Current architecture (live)

```text
visitor ─TLS─► Cloudflare (Always Use HTTPS, edge certificate)
          └─ tunnel public hostnames: tattoodrip.app, tattoodrip.page, *.tattoodrip.page
               └─► cloudflared (172.30.42.20) ─► nginx (.10, deploy/nginx/nginx.conf → hosts.current.conf)
                     tattoodrip.app                 → web (.11:3333): dashboard, sign-in, account links, /api/v1
                     tattoodrip.page, *.tattoodrip.page → storefront (.12:3000)
                     any other Host                 → 444 (closed)
media.tattoodrip.app → R2 public bucket (Cloudflare, not through the server)
```

- **Platform:** `APP_URL=https://tattoodrip.app`; `API_URL` and `DISCOVER_URL` unset. Every host answers as before.
- **Storefront:** `API_URL=https://tattoodrip.app`, used by its server and dehydrated for browsers.
- **Cookies:** the dashboard's are host-only on `tattoodrip.app`: `__Host-td-session`, `XSRF-TOKEN` and `app_theme`.
- **The API:** cookieless; CORS never allows credentials.
- **The installed dashboard app:** its manifest has `start_url /dashboard`, and its service worker `/sw.js` is registered on `tattoodrip.app`.

## B. Target architecture (after D11)

| Host | nginx (`hosts.split.conf`) | Serves |
|---|---|---|
| `tattoodrip.app` | `discover` upstream (172.30.42.13:3000, reserved for D05) | Discover. Legacy dashboard and account paths get a 307 to `app.`; `/api/` is proxied to web; `/sw.js` unregisters the old worker |
| `app.tattoodrip.app` | web | Studio OS: dashboard, sign-in, account links. The platform still answers `/api` there, but nothing calls it |
| `api.tattoodrip.app` | web, `/api/` only; everything else is nginx's 404 | The public API `/api/v1`. The platform also refuses non-`/api` paths on this host |
| `tattoodrip.page`, `*.tattoodrip.page` | storefront | Studio pages (unchanged) |
| `media.tattoodrip.app` | not on the server | R2 photos (unchanged) |

`www.tattoodrip.app` is not routed (444). Add it later as a Cloudflare redirect if wanted.

## C. Configuration reference

| Setting | Where | Live value | D11 value | Purpose |
|---|---|---|---|---|
| `APP_URL` | platform | `https://tattoodrip.app` | `https://app.tattoodrip.app` | Studio OS origin. Email links (confirmation, reset, invitation, alerts) are built from it. There are no OAuth callbacks; auth redirects are relative paths |
| `API_URL` (new, optional) | platform | unset | `https://api.tattoodrip.app` | The API's origin. When its host differs from `APP_URL`'s, that host serves `/api` only (`ApiHostMiddleware`) |
| `DISCOVER_URL` (new, optional) | platform | unset | `https://tattoodrip.app` | Discover's origin: allowed by CORS, and served `/api` only by the platform (the legacy proxy). It must not be `APP_URL`'s or `API_URL`'s host |
| `STOREFRONT_URL` | platform + storefront | `https://{tenant}.tattoodrip.page` | unchanged | Studio page links, and the studio page origins CORS allows |
| `API_URL` | storefront | `https://tattoodrip.app` | `https://api.tattoodrip.app` | The API for SSR and, dehydrated, for browsers. The platform's `API_URL` (or `APP_URL` while that is unset) |
| `MEDIA_URL` / `R2_PUBLIC_URL` | storefront / platform | `https://media.tattoodrip.app` | unchanged | Photos |
| `TRUST_PROXY` | platform | `172.30.42.10` | unchanged | nginx; its `X-Forwarded-Host` decides the host the platform sees |
| nginx layout | `deploy/nginx/nginx.conf` | `include hosts.current.conf` | `include hosts.split.conf` | Host routing (`common.conf` and `hosts.studio.conf` are shared) |
| Tunnel public hostnames | Cloudflare | apex, `.page`, `*.page` | add `app.tattoodrip.app` and `api.tattoodrip.app` → `http://nginx:80` | Reach nginx |

**Validation at boot** (`start/env.ts`, `#services/platform_origins`):
- `API_URL` and `DISCOVER_URL` must be bare http(s) origins (no path, query or credentials).
- `DISCOVER_URL`'s host must differ from the dashboard's and the API's.
- With `NODE_ENV=production`, both must be https and must not be on, under or above the studio pages' domain (the `APP_URL` rule). A loopback origin skips only the domain comparison.

**CORS** (`config/cors.ts`, `#services/browser_origins`):
- The API echoes `Access-Control-Allow-Origin` only for:
  - a studio page (`STOREFRONT_URL` with any slug-shaped label, `www` included);
  - `APP_URL`;
  - `DISCOVER_URL`.
- Every API answer carries `Vary: Origin`.
- There is no wildcard, no `null`, never credentials. Methods and headers are unchanged: `GET, HEAD, POST`; `accept, content-type, x-challenge-token`; `Retry-After` exposed.
- Server-side callers send no `Origin` and need no CORS.
- Custom studio domains (TAT-79) are not served yet. When they are, their verified hosts must join this list.

**The SDK:** `createTattooClient({ baseUrl })` already takes any origin. Moving the API is a configuration change only, with no contract change. `packages/sdk/test` covers the live host and the split host.

## D. Rehearsal

**Proxy layouts.** Both layouts are checked against stand-in apps:
- 174 checks, covering host routing, visitor address, body limits, tokens kept out of logs, legacy redirects and the API-only host.
- It needs Docker or Podman, and the production subnet free.

```bash
bash deploy/test/nginx/run.sh                          # both layouts
LAYOUTS=nginx.split.conf bash deploy/test/nginx/run.sh # one
```

**The apps on split hosts, locally.** Chromium resolves `*.localhost` itself. The storefront's server needs the names in `/etc/hosts`:

```text
127.0.0.1 app.localhost api.localhost <your-studio-slug>.localhost
```

1. Use a throwaway database: run `setup_roles.sql`, then `pnpm migrate`.
2. Platform (`apps/platform`): `APP_URL=http://app.localhost:3333 API_URL=http://api.localhost:3333 DISCOVER_URL=http://localhost:3100 pnpm dev`, plus `pnpm worker` (emails go through the queue). Mailpit from the root `docker-compose.yml`.
3. Storefront (`apps/storefront`): `PORT=3000 API_URL=http://api.localhost:3333 STOREFRONT_URL=http://{tenant}.localhost:3000 pnpm dev`. Set `PORT` explicitly: an exported `PORT=3333` makes it take the platform's port.
4. Run `node deploy/test/split-hosts/rehearse.cjs`. It needs Playwright resolvable through `NODE_PATH` (it is not a repo dependency) and the platform's environment in the shell. It checks each of these:
   - Sign up, confirm (`node ace account:verify <email>`), sign in and onboard at `http://app.localhost:3333`, making CSRF-protected writes along the way.
   - The cookies are host-only on `app.localhost`.
   - `http://api.localhost:3333/login` is the API's 404 and sets no cookie.
   - `http://api.localhost:3333/api/v1/tenants/<slug>` is 200.
   - `http://<slug>.localhost:3000` renders from the API.
   - From that page, a cross-origin read and a preflighted inquiry POST to `api.localhost` succeed.
   - From an unlisted origin, the read is blocked.
   - Sign out returns to `/login`, and a signed-out tenant page sends the guest there.
   - A password reset email links to `http://app.localhost:3333/reset-password/…`.

This rehearsal was run for D01; see "J. D01 verification" below.

**Production-mode rehearsal.** The smoke run in `deploy/test/compose.smoke.yml` with scratch settings: `deploy.sh` with the live values (stage B), then a local commit switching `nginx.conf` to the split layout with the D11 values (stage D), then the previous commit again (rollback). Curl `127.0.0.1:8088` with each `Host`, or put a TLS stand-in for Cloudflare at cloudflared's address so the apps' own `https://api.tattoodrip.app` reads work and `deploy/test/launch-smoke.mjs` runs with `SMOKE_CONNECT`. Run in D11: see J2.

## E. Authentication and browser state at cutover

- **One sign-in for everyone.**
  - `__Host-td-session` is host-only: browsers never send the `tattoodrip.app` cookie to `app.tattoodrip.app`, so open sessions end. Sessions last 2 hours of inactivity anyway, and remember-me is off.
  - There is no session handoff, and no cookie is widened to `Domain=tattoodrip.app`. That would expose sessions to Discover and every subdomain.
  - Announce the sign-in in advance.
- **CSRF.** The `XSRF-TOKEN` cookie and the session are per host. A dashboard tab opened before the cutover:
  - its next write is redirected by the 307 to `app.` without the session, and fails with "Invalid or expired CSRF token", then the sign-in page;
  - its Inertia navigations become cross-origin redirects, which fail until the tab is reloaded.
  - Expected; covered by the announcement.
- **Email links already sent:**
  - Confirmation (24 h), reset (60 min) and invitation (7 days) links point at `tattoodrip.app/...`.
  - The apex 307 sends them, token included, to the same path on `app.`, which stages the token in its own session as today.
  - The token is never logged: the `$loggable` map in `common.conf` covers every host.
- **Installed app (PWA).**
  - Its `start_url` `/dashboard` on the apex is redirected to `app.`, which is outside the installed scope, so it opens with browser chrome.
  - Owners should reinstall from `app.tattoodrip.app`.
  - The apex `/sw.js` (nginx) replaces the old worker: it deletes its caches and unregisters on the next visit, so it never answers for Discover.
  - Discover must not register a worker at `/sw.js` or use the legacy paths in F.
- **Saved passwords** are keyed by origin in most browsers. Users may need to pick the `tattoodrip.app` entry once, or the browser offers it as a related site.
- **HSTS** is sent for the apex only (no `includeSubDomains`); the new hosts are https-only through Cloudflare anyway.

## F. Legacy URLs

| Old address (`tattoodrip.app`) | After D11 | Why |
|---|---|---|
| `/login`, `/logout`, `/signup[/…]`, `/forgot-password[/…]`, `/reset-password[/…]`, `/verify-email[/…]`, `/confirm-email`, `/invitations[/…]`, `/dashboard`, `/onboarding`, `/account[/…]`, `/t/*` | **307** to `https://app.tattoodrip.app` + same path and query | Bookmarks, emailed links, the installed app. 307 keeps the method and body and is not cached for good, so a rollback is not stuck behind it. Switch to 308 when the rollback window closes |
| `/api`, `/api/*` | **Proxied** to web (Host `tattoodrip.app`, which the platform answers as an API-only host) | Pages cached with the old dehydrated `apiUrl`, and any SDK user. A redirected multipart POST or preflight is not reliably followed. **Retire** after ≥30 days without traffic in the nginx log |
| `/sw.js` | Unregistering worker (nginx) | Removes the dashboard's worker from the apex |
| `/assets/*`, `/uploads/*`, `/files/*`, `/manifest.webmanifest`, `/icons/*`, `/offline.html` | **Discover's** (not redirected) | Vite serves Discover's build at `/assets/`; R2 serves photos in production; the old shell files only matter to the retired worker |
| Everything else | Discover | Discover routes (`/`, `/tattoos`, `/artists`, `/studios`, `/styles`, `/places`, `/for-studios`, `/pricing`, `/terms`, `/privacy`, sitemaps) do not collide with the list above |

The legacy redirects and the proxy are prepared in `deploy/nginx/hosts.split.conf` and are not active. The live layout stays `hosts.current.conf` until D11.

## G. D11 release plan

The launch runs in five stages. A and B change nothing visitors see. C adds two hostnames that answer nothing yet. **D (the cutover) and everything after it need the product owner's explicit approval on the day.** Commands run on the server, in `/srv/tattoo-drip/app`, unless they say otherwise. Write `dc` for `docker compose -f /srv/tattoo-drip/app/deploy/compose.yml`.

### Release gates

Any one of these stops the launch (stage D) or triggers the rollback (H):

| Blocker | How it shows |
|---|---|
| Private data on a public host | The smoke test's "private fields" check, or anything beyond the views' public columns in an API answer |
| An unlisted, hidden or taken-down studio, artist or photo on Discover | `SMOKE_HIDDEN` checks, the studio's `node ace.js discover:status <slug>` |
| Studio OS sign-in or a dashboard write fails | G.D step 5 |
| A studio page or its booking request fails | G.D step 6 |
| API errors (5xx) beyond the cutover's few seconds | nginx log (G.E), Discover's "API read failed" lines |
| A redirect loop, broken HTTPS or a 502 on any host | The smoke test, `curl -sI` |
| Discover's server rendering failing (500 pages) | The smoke test, `dc --profile discover logs discover` |
| No fresh backup, or an untested restore | G.A step 2 |

### A. Preflight (no change visible)

1. **The release commit is on `main` with CI green.** It includes D11 (`deploy.sh` deploys Discover when `discover.env` exists; `/healthz`; the server key).
2. **Backup and practice restore:** run one by hand (runbook 6.4), then restore it into a scratch database and compare (7.3). Note the dump's name: it is the recovery point if the database ever has to go back.
3. **The discovery role exists** (runbook 5, "Once, before deploying the Discover database"). Check:
   ```bash
   dc exec -T postgres sh -c 'psql -XtA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select rolname from pg_roles where rolname = '"'"'tattoo_drip_discovery'"'"'"'
   ```
   Prints `tattoo_drip_discovery`; if it prints nothing, run that section's command first.
4. **The Discover key.** Make one (`openssl rand -hex 32`, never the storefront's). Add `DISCOVER_SERVER_KEYS=<key>` to `platform.env`.
5. **`discover.env`** from `deploy/env/discover.env.example` (mode 600):
   - `DISCOVER_SERVER_KEY=<the same key>`;
   - **`API_URL=https://tattoodrip.app` for now**: the API is still on the apex until D;
   - `DISCOVER_URL=https://tattoodrip.app`, `APP_URL=https://app.tattoodrip.app`, `MEDIA_URL=https://media.tattoodrip.app`;
   - `DISCOVER_INDEXING=off`, `DISCOVER_GEO_HEADER=` (empty) and the markets.
6. **Content.** Discover lists a business only after its owner turns the listing on in Studio OS (consent; [publication controls](publication-controls.md)). No migration lists anyone, so on launch day Discover shows only the businesses that have listed themselves by then. Ask the pilot studios to list themselves (Studio OS, Settings, Discover) and check each with `dc --profile tools run --rm migrate node ace.js discover:status <slug>`. Launching with an empty Discover is a product decision, not a technical blocker.
7. **Tell dashboard users** about the one sign-in at the cutover (E) and pick a quiet hour (not around 02:00 Nepal time: the backup).

### B. Deploy Discover without a public cutover

1. `deploy/deploy.sh` (it sees `discover.env`): it builds the platform and storefront images, then Discover's on its own, migrates, and starts `discover` beside the others. nginx still serves the live layout: nobody can reach Discover yet. **You should see:** `waiting for web storefront discover`, then `deployed <commit>`.
2. Discover from inside the stack (nginx's container reaches it; its port is published nowhere):
   ```bash
   dc exec -T nginx wget -qO- http://172.30.42.13:3000/healthz
   dc exec -T nginx wget -S -O /dev/null --header 'X-Forwarded-For: 203.0.113.9' http://172.30.42.13:3000/explore/studios 2>&1 | grep -E 'HTTP/|cache-control'
   ```
   **You should see:** `ok`, then `HTTP/1.1 200` and `cache-control: private, no-store`. A listed studio's profile (`/studios/<slug>`) answers 200 the same way.
3. Logs:
   ```bash
   dc --profile discover logs --tail 20 discover
   dc logs --since 10m web | grep -E 'server key this API does not accept|no usable X-Visitor-IP' || echo none
   ```
   **You should see:** one `Discover started: site https://tattoodrip.app, API https://tattoodrip.app, … server key set` line and no `Discover API read failed`; then `none`.
4. Everything else is unchanged: run the deploy checks you always run (runbook 4.7), and open a studio page.

### C. Prepare `app.` and `api.` (no change visible)

1. Cloudflare, tunnel `tattoo-drip` (runbook 3.6): add two public hostnames, both service type **HTTP**, URL `172.30.42.10:80`:

   | Subdomain | Domain |
   |---|---|
   | `app` | `tattoodrip.app` |
   | `api` | `tattoodrip.app` |

   Cloudflare adds a proxied CNAME for each (`app` and `api` → `<tunnel id>.cfargotunnel.com`). Leave the apex, `tattoodrip.page`, `*.tattoodrip.page` and `media` exactly as they are.
2. Certificates: Universal SSL covers `tattoodrip.app` and `*.tattoodrip.app`, so `app.` and `api.` need nothing (SSL/TLS, Edge Certificates lists the wildcard). TLS ends at Cloudflare; the tunnel carries the rest, so there is no origin certificate to install (SSL/TLS mode doesn't apply to tunnel traffic).
3. From your computer: `curl -sI https://app.tattoodrip.app/login` and the same for `api.` end with no answer (curl: "Empty reply from server", or Cloudflare's 502). The live layout closes unknown hosts (444), which proves the tunnel reaches nginx and nothing is served there yet.
4. Security rules (runbook 3.7, 3.8):
   - No challenge (Bot Fight Mode, Under Attack, a challenge rule) on `app.` or `api.`: Discover's and the studio pages' servers read `https://api.tattoodrip.app` from the server's own address and cannot solve one.
   - Add `app.tattoodrip.app` to the optional sign-in rate-limiting rule (3.8) beside the apex; never aim a rule at `/api/`.
   - No cache rule on any host (I, "Edge caching of `/api`"): Cloudflare's defaults cache only the hashed `/assets/*` and the brand files, never Discover's HTML, the API's JSON, robots or sitemaps.
5. The functional switch itself happens in one step (D). There is no useful half state: Studio OS on `app.` with the API still on the apex would split sessions and CORS. The full split layout was rehearsed in production mode instead (J2).

### D. Cutover (approval required)

1. `platform.env`: `APP_URL=https://app.tattoodrip.app`, `API_URL=https://api.tattoodrip.app`, `DISCOVER_URL=https://tattoodrip.app`.
2. `storefront.env` and `discover.env`: `API_URL=https://api.tattoodrip.app`.
3. Merge a commit that changes `deploy/nginx/nginx.conf`'s include to `include /etc/nginx/td/hosts.split.conf;`, then run `deploy/deploy.sh`. It refuses that commit if `discover.env` is missing. **You should see:** `deployed <commit>` and `to go back to the release before: deploy/deploy.sh <previous>`: **write that line down**.
4. Cloudflare, Caching, Configuration, **Custom Purge**: purge `https://tattoodrip.app/sw.js` and `https://tattoodrip.app/manifest.webmanifest`, so no edge copy of the old dashboard's files answers for Discover.
5. Studio OS (a browser): `https://app.tattoodrip.app/login`, sign in. The cookie is `__Host-td-session` with Secure, HttpOnly, SameSite Lax and no Domain. Make one dashboard write (CSRF), then sign out.
6. A studio page: it renders; its HTML names `https://api.tattoodrip.app`; send a test inquiry (Turnstile); a deposit link opens.
7. From your computer (Node 22+, any checkout of the repo):
   ```bash
   SMOKE_STUDIOS=<two or three real studio slugs> SMOKE_HIDDEN=<an unlisted studio's slug> \
     node deploy/test/launch-smoke.mjs
   ```
   **You should see:** `… passed, 0 failed`. `SKIP` lines only where Discover lists nothing yet. Any `FAIL` is a release gate.
8. Discover's caching and country: `curl -sI https://tattoodrip.app/` shows `cache-control: private, no-store` and `cf-cache-status: DYNAMIC` (never `HIT`). `dc port discover 3000` prints nothing.

### E. After the cutover

1. **Watch for an hour:**
   ```bash
   dc logs -f --since 5m nginx | grep -E '" 5[0-9]{2} '              # 5xx answers, any host
   dc --profile discover logs -f discover | grep -v '^$'            # "API read failed", restarts
   dc logs -f web | grep -E '"level":(50|60)|server key|X-Visitor-IP'
   docker inspect -f '{{.Name}} restarts={{.RestartCount}}' $(dc --profile discover ps -q)
   ```
   Expected: sign-ins and a few "Invalid or expired CSRF token" (open tabs, E above); `/api` traffic on the apex from cached pages (it is proxied); no 5xx beyond the restart's seconds, no "API read failed", no restarts.
2. **A new password reset email** links to `https://app.tattoodrip.app/…`; an old link opened on the apex still works (307).
3. **The visitor's address** on the new hosts is real (runbook 4.8, with `app.tattoodrip.app`).
4. **Discover is launched** when 1–3 hold. Indexing stays off until the product owner decides (blueprint J). Then set `DISCOVER_INDEXING=on` in `discover.env`, recreate it (`dc --profile discover up -d --force-recreate discover`), rerun the smoke test with `SMOKE_INDEXING=on`, and submit `https://tattoodrip.app/sitemap.xml` in Search Console. Each of those is its own decision.
5. **Geolocation** stays off until a request with a made-up `CF-IPCountry: IN` from outside Nepal reaches Discover with Cloudflare's own value (`curl -H 'CF-IPCountry: IN' https://tattoodrip.app/` and the country it shows). Then set `DISCOVER_GEO_HEADER=X-Discover-Country` and recreate Discover.
6. **Later:** legacy 307 → 308 when the rollback window closes (14 days); remove the apex `/api` proxy and `hosts.current.conf` after 30 days with no apex `/api` traffic.

## H. Rollback

**When:** any release gate (G) that a small fix can't clear within the hour: Studio OS sign-in or writes failing, studio pages or bookings failing, private or hidden data visible, repeated 5xx or a redirect loop.

**Database:** the cutover runs no migration (B already ran them; every Discover migration only adds columns, tables, views and indexes, and the older code ignores them). Going back is a code and routing change only: never roll the database back. Restoring the A.2 dump is for data loss only (runbook 7.5).

**Settings first, always.** The release before the cutover already has the API-only host rule (D01): with `DISCOVER_URL=https://tattoodrip.app` still in `platform.env`, the platform answers every non-`/api` path on the apex with the API's 404, so once nginx sends the apex to `web` again nobody can sign in until the settings are fixed.

1. **Settings:** `platform.env`: `APP_URL=https://tattoodrip.app`, delete `API_URL` and `DISCOVER_URL`; `storefront.env`: `API_URL=https://tattoodrip.app`. Keep `discover.env` (Discover keeps running unseen) or, to stop it after step 2, `dc --profile discover stop discover` and move `discover.env` away. Nothing reads the files until step 2 recreates the services.
2. **Routing and code**, one command: the release before the cutover, which D.3's last line named (or `git -C /srv/tattoo-drip/app log --oneline` lists):
   ```bash
   /srv/tattoo-drip/app/deploy/deploy.sh <previous commit>
   ```
   It recreates `web`, `worker` and `storefront` with the step 1 values and reloads nginx on the live layout.

   **In an emergency** (the deploy's image build would take too long): after step 1, `dc up -d --force-recreate web worker storefront`; only then edit the include in `/srv/tattoo-drip/app/deploy/nginx/nginx.conf` back to `hosts.current.conf` and run `dc exec -T nginx nginx -c /etc/nginx/td/nginx.conf -s reload`. Then discard that edit (`git -C /srv/tattoo-drip/app checkout -- deploy/nginx/nginx.conf`: `deploy.sh` refuses a checkout with local changes) and run step 2 as soon as you can, so the server is on a recorded release again.
3. **Verify:** `https://tattoodrip.app/login` is the dashboard's sign-in page; sign in and make one write; a studio page renders and names `https://tattoodrip.app`; `https://app.tattoodrip.app` closes again (444).
4. **People:**
   - Users sign in again, on the apex.
   - The 307s were never permanent, so browsers don't stick to them.
   - The tunnel hostnames `app.` and `api.` can stay: the live layout closes them.
5. **Emails sent during the cutover** link to `app.tattoodrip.app` (invitations live 7 days). Keep them working with a temporary server block in `hosts.current.conf`, merged and deployed:

   ```nginx
   server {
   	listen 80;
   	server_name app.tattoodrip.app;
   	location / { return 307 https://tattoodrip.app$request_uri; }
   }
   ```

The rollback was rehearsed (J2): one `deploy.sh <previous>` with the live values restored the apex dashboard, closed `app.` and `api.` again and kept studio pages working.

## I. Risks and limits

| Risk | Status / mitigation |
|---|---|
| CORS is now an allowlist (was `*`) | Studio pages, `APP_URL` and `DISCOVER_URL` only. Live today: every legitimate browser caller is a studio page. A future custom storefront (V2 agencies) or custom domain (TAT-79) needs its origin added. **Ships with D01's next deploy, before the cutover**: watch for CORS errors on studio pages after it |
| Errors before routing (a malformed URL's 400) | They carry no allow-origin header now, so a browser cannot read their body. The SDK never sends such URLs |
| Host checks depend on `X-Forwarded-Host` | nginx overwrites it with the routed Host and is the only trusted proxy (`TRUST_PROXY`); the harness checks that a visitor's value is replaced |
| `deploy.sh` tests and reloads `nginx.conf` | The include switch makes `nginx.conf` the split layout, so the existing deploy path works. `nginx.split.conf` exists only for rehearsals |
| Discover upstream missing | `hosts.split.conf` must not go live before Discover's container exists (apex paths would be 502) |
| Production-mode rehearsal | Run in D11 (J2): stage B, the cutover, the rollback and the cutover again, with production images, `NODE_ENV=production`, a TLS edge stand-in and the launch smoke test |
| Discover's API budget | D11: Discover's server key (`DISCOVER_SERVER_KEYS`) counts each visitor apart. A missing or mismatched key still works but counts Discover as one client (300 reads per 5 minutes) and logs "server key this API does not accept" |
| Discover's reads go through Cloudflare | Discover and the studio pages read `https://api.tattoodrip.app` from the server's own address, through Cloudflare and the tunnel. Any Cloudflare challenge, or a rate rule counting by address, on `api.` would count or block all their visitors as one (G.C step 4) |
| Discover lists nothing at first | Listing is opt-in (consent); no migration lists anyone. Discover shows only businesses that listed themselves before launch (G.A step 6) |
| Old dashboard files at Cloudflare's edge | `/sw.js` and the manifest on the apex: purged at the cutover (G.D step 4) |
| HSTS | `.app` and `.page` are on browsers' HSTS preload list as whole TLDs: https only, whatever a response says, so Discover sending no HSTS header changes nothing |
| Cloudflare settings | Tunnel hostnames, certificate coverage and any WAF or rate-limit rule (runbook §3.8 targets `tattoodrip.app` sign-in paths: move it to `app.`) are manual. None changed in D01 |
| Turnstile | Bound to the studio pages' hostname: unaffected |
| Discover's country header (D06.5) | nginx sets `X-Discover-Country` from `CF-IPCountry` only for connections from cloudflared (`172.30.42.20`, as for the visitor's address) and always replaces a visitor's own; the harness checks both. Unverified until D11: that Cloudflare overwrites a visitor's own `CF-IPCountry`. Geolocation is off until then (`DISCOVER_GEO_HEADER` unset); it is a relevance hint only, so a spoofed country changes nothing but the visitor's own listings |
| Edge caching of `/api` | Before D01 every answer carried `Access-Control-Allow-Origin: *`, so an edge copy worked for any studio page. Now the header names one origin, and Cloudflare ignores `Vary: Origin` for JSON. Cloudflare does not cache `/api` today (runbook §4.7 checks `DYNAMIC`/`BYPASS`). **Never add a cache rule for `/api`** on the apex or `api.`: it would serve one studio's allow-origin to another studio's browser |
| `/api/../file` tricks | The platform decides "API path" on the dot-segment-resolved path, so `/api/../sw.js` on an API-only host is the 404, not the static file (tested); nginx matches on the normalised `$uri` too |
| Installed PWAs and open tabs | One-time disruption, documented in E |

## J. D01 verification (2026-11-06)

Run in a cloud workspace with Node 24.3.0, PostgreSQL 18.6 (Docker), nginx 1.30.6 (Docker) and Chromium (Playwright).

| Check | Result |
|---|---|
| Platform suite (`node ace test`) | 3482 passed, including the new `api_host`, `cors`, `platform_origins`, `browser_origins` and production-boot cases. The baseline before D01 was 3449 tests, 3 failing only because the shell's `APP_URL` port differed from the test port |
| SDK / React / storefront tests | 51 / 23 / 1574 passed |
| `pnpm check`, `pnpm typecheck`, `pnpm build` | Pass. Biome's remaining warnings are in files D01 did not touch |
| `deploy/test/nginx/run.sh` | Both layouts pass (174 checks) |
| `deploy/test/split-hosts/rehearse.cjs` | 18/18 against the real platform and storefront on `app.` / `api.localhost` |
| Production-mode rehearsal (smoke run + `compose.split.yml`) | **Not run** (needs built images and scratch secrets): the first D11 step |
| Live DNS, Cloudflare, production env or deploy | **Unchanged** |

## J2. D11 verification (2026-11-08)

Run in a cloud workspace: Docker 29 with Compose 5, the production images built from the repo's Dockerfile (`platform`, `storefront`, `discover`), Postgres 18.6, nginx 1.30.6, Node 24.3.0, Chromium (Playwright). A TLS stand-in for Cloudflare at cloudflared's address (`172.30.42.20`, nginx in front of nginx with a scratch CA, adding `CF-Connecting-IP` and `CF-IPCountry`) let the apps' own `https://api.tattoodrip.app` reads work inside the stack. Scratch settings and keys only; nothing outside the workspace was touched.

| Check | Result |
|---|---|
| Stage B: `deploy.sh` with the live values and `discover.env` | Pass: fresh database, every migration (`Migrated in` under 1 s), Discover healthy beside web and storefront, apex still the dashboard, `app.`/`api.` closed, Discover rendering inside the stack with the key |
| Guard: split-layout commit without `discover.env` | Refused before any change; release record unchanged |
| Stage D: the split-layout commit with the D11 values | Pass: all healthy; `deploy/test/launch-smoke.mjs` 31/31 (indexing off) and 31/31 (indexing on) |
| Browser journeys through the edge | 20/20: home → directory → studio → booking form with `ref`; gallery → artwork → artist → `/book?artist=`; Sign in → Studio OS; sign up, `account:verify`, sign in, host-only `__Host-td-session` (Secure, HttpOnly, Lax) on `app.` only, onboarding write (CSRF), the new studio's `*.tattoodrip.page`, sign out; an old apex `/forgot-password` → `app.`; no console errors, no request to an internal address |
| Database boundary on the production image, as the app role | No superuser or BYPASSRLS on either role; the discovery role can't log in; with no tenant context the app role sees 0 tenants, artists, inquiries and users; a private column through a view is "does not exist"; writes to a view are refused; `SET ROLE tattoo_drip_discovery` is refused; only the listed studio and its photos come through the views (unlisted and taken-down studios never) |
| Upgrade from the last release before Discover (`e3d3114`, its own image and migrations, 40 businesses, 120 artists, 480 photos) | Without `setup_roles.sql` the views migration refuses (old release keeps running); after it, the rest apply in 162 ms; rows preserved; no business listed, nothing on Discover until consent; the pre-Discover code serves sign-in and the studio API on the upgraded schema (rollback-safe) |
| Rollback: `deploy.sh <previous>` with the live values | Pass: apex dashboard again, `app.`/`api.` closed, studio pages and the apex API working |
| Operations | Discover restarts after its process is killed (healthy in ~8 s); `SIGTERM` stops it gracefully (~1 s, exit 0); no service publishes a port but the rehearsal's own; containers run as `node`; failed API reads log one line each |
| `deploy/test/nginx/run.sh` | Both layouts: 183 checks pass |
| Platform suite (Postgres 18) | 3645 passed |
| Discover / SDK / React / storefront tests | 246 / 70 / 32 / 1579 passed |
| `pnpm check`, `pnpm typecheck`, `pnpm build` | Pass (Biome's 3 warnings and 1 info are pre-existing, in apps/platform) |
| Live DNS, Cloudflare, production env or deploy | **Unchanged.** Stage C onward needs the product owner's approval |
