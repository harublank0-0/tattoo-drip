# Discover: domain migration

How Tattoo Drip moves from one platform host to three: Discover on `tattoodrip.app`, Studio OS on `app.tattoodrip.app`, the API on `api.tattoodrip.app`.
- **D01 (done):** prepared the configuration, routing and tests, and rehearsed the layout locally. It changed nothing in production.
- **D11:** runs the cutover with the checklist below, once Discover has passed end-to-end testing.

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
- 171 checks, covering host routing, visitor address, body limits, tokens kept out of logs, legacy redirects and the API-only host.
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

**Production-mode rehearsal, before D11.** This is the smoke run in `deploy/test/compose.smoke.yml`, plus `deploy/test/compose.split.yml` (nginx on `nginx.split.conf`). Use scratch settings with the D11 values from C, then curl `127.0.0.1:8088` with each `Host`. It needs the production images built, and checks `__Host-` cookies and the https rules under `NODE_ENV=production`. It was not run in D01; it is the first D11 step.

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
| `/api/*` | **Proxied** to web (Host `tattoodrip.app`, which the platform answers as an API-only host) | Pages cached with the old dehydrated `apiUrl`, and any SDK user. A redirected multipart POST or preflight is not reliably followed. **Retire** after ≥30 days without traffic in the nginx log |
| `/sw.js` | Unregistering worker (nginx) | Removes the dashboard's worker from the apex |
| `/assets/*`, `/uploads/*`, `/files/*`, `/manifest.webmanifest`, `/icons/*`, `/offline.html` | **Discover's** (not redirected) | Vite serves Discover's build at `/assets/`; R2 serves photos in production; the old shell files only matter to the retired worker |
| Everything else | Discover | Discover routes (`/`, `/tattoos`, `/artists`, `/studios`, `/styles`, `/places`, `/for-studios`, `/pricing`, `/terms`, `/privacy`, sitemaps) do not collide with the list above |

The legacy redirects and the proxy are prepared in `deploy/nginx/hosts.split.conf` and are not active. The live layout stays `hosts.current.conf` until D11.

## G. Cutover checklist (D11)

**Before the day:**
1. Discover is deployed (its compose service at `172.30.42.13`, D05), and its end-to-end tests pass.
2. The production-mode rehearsal (D) passes.
3. A fresh backup and a practice restore exist (runbook §6–7).
4. Dashboard users have been told about the one sign-in. Pick a low-traffic time.
5. In Cloudflare, add tunnel public hostnames `app.tattoodrip.app` and `api.tattoodrip.app` → `http://nginx:80`. Check that the edge certificate covers them (Universal SSL covers `*.tattoodrip.app`).
   - Then `curl -sI https://app.tattoodrip.app` should be closed without an answer: the live layout's 444 proves the tunnel reaches nginx and nothing is served yet.
   - Do not touch the apex hostname.

**Cutover** (one deploy):

6. `platform.env`:
   - `APP_URL=https://app.tattoodrip.app`
   - `API_URL=https://api.tattoodrip.app`
   - `DISCOVER_URL=https://tattoodrip.app`
7. `storefront.env`: `API_URL=https://api.tattoodrip.app`.
8. Commit `deploy/nginx/nginx.conf` with `include /etc/nginx/td/hosts.split.conf;` in place of `hosts.current.conf`. Deploy (`deploy/deploy.sh`): it recreates web, worker, storefront and nginx and reloads nginx.

**Verify** (from outside):

9. `https://app.tattoodrip.app/login` loads. Sign in: the cookie is `__Host-td-session` with Secure, HttpOnly, SameSite Lax and no Domain. Make one dashboard write (CSRF). Sign out.
10. `https://api.tattoodrip.app/api/v1/tenants/<slug>`: 200, `cache-control: public…`. `https://api.tattoodrip.app/login`: 404, no `set-cookie`.
11. On a studio page:
    - the page renders;
    - its HTML names `https://api.tattoodrip.app`;
    - a test inquiry with Turnstile goes through;
    - DevTools shows `access-control-allow-origin: https://<slug>.tattoodrip.page` on API calls;
    - a deposit link opens.
12. `https://tattoodrip.app` is Discover.
    - `https://tattoodrip.app/login` → 307 to `app.`.
    - `https://tattoodrip.app/api/v1/tenants/<slug>` → 200 (proxy).
    - `https://tattoodrip.app/sw.js` → the unregistering worker.
13. A new password reset email links to `https://app.tattoodrip.app/...`. An old link opened from the apex still works.
14. Runbook §4.8: the visitor address on the new hosts is still the real one.
15. Watch the logs for an hour: 5xx, CSRF failures beyond the expected sign-ins, `/api` traffic on the apex.

**After:**

16. When the rollback window closes (suggested 14 days): legacy 307 → 308.
17. After ≥30 days with no apex `/api` traffic: remove the apex `/api` proxy, `hosts.current.conf`, and this document's live-layout notes.

## H. Rollback

1. Revert the `nginx.conf` include to `hosts.current.conf`.
2. Restore the live values: `APP_URL=https://tattoodrip.app`, unset `API_URL` and `DISCOVER_URL`, storefront `API_URL=https://tattoodrip.app`.
3. Deploy. In an emergency, edit the include on the server, run `nginx -c /etc/nginx/td/nginx.conf -s reload`, then fix the env files and recreate web and storefront.
4. Effects:
   - Users sign in again, on the apex.
   - The 307s were never permanent, so browsers don't stick to them.
   - Tunnel hostnames for `app.` and `api.` can stay: the live layout closes them (444).
5. Emails sent during the cutover link to `app.tattoodrip.app`. If any were sent (invitations live 7 days), keep them working during the rollback with a temporary server block in `hosts.current.conf`:

   ```nginx
   server {
   	listen 80;
   	server_name app.tattoodrip.app;
   	location / { return 307 https://tattoodrip.app$request_uri; }
   }
   ```

## I. Risks and limits

| Risk | Status / mitigation |
|---|---|
| CORS is now an allowlist (was `*`) | Studio pages, `APP_URL` and `DISCOVER_URL` only. Live today: every legitimate browser caller is a studio page. A future custom storefront (V2 agencies) or custom domain (TAT-79) needs its origin added. **Ships with D01's next deploy, before the cutover**: watch for CORS errors on studio pages after it |
| Errors before routing (a malformed URL's 400) | They carry no allow-origin header now, so a browser cannot read their body. The SDK never sends such URLs |
| Host checks depend on `X-Forwarded-Host` | nginx overwrites it with the routed Host and is the only trusted proxy (`TRUST_PROXY`); the harness checks that a visitor's value is replaced |
| `deploy.sh` tests and reloads `nginx.conf` | The include switch makes `nginx.conf` the split layout, so the existing deploy path works. `nginx.split.conf` exists only for rehearsals |
| Discover upstream missing | `hosts.split.conf` must not go live before Discover's container exists (apex paths would be 502) |
| Production-mode rehearsal not run in D01 | It needs built images and scratch secrets. It is D11's first step; local rehearsal and the proxy harness passed |
| Cloudflare settings | Tunnel hostnames, certificate coverage and any WAF or rate-limit rule (runbook §3.8 targets `tattoodrip.app` sign-in paths: move it to `app.`) are manual. None changed in D01 |
| Turnstile | Bound to the studio pages' hostname: unaffected |
| Installed PWAs and open tabs | One-time disruption, documented in E |

## J. D01 verification (2026-11-06)

Run in a cloud workspace with Node 24.3.0, PostgreSQL 18.6 (Docker), nginx 1.30.6 (Docker) and Chromium (Playwright).

| Check | Result |
|---|---|
| Platform suite (`node ace test`) | 3479 passed, including the new `api_host`, `cors`, `platform_origins`, `browser_origins` and production-boot cases. The baseline before D01 was 3449 tests, 3 failing only because the shell's `APP_URL` port differed from the test port |
| SDK / React / storefront tests | 51 / 23 / 1574 passed |
| `pnpm check`, `pnpm typecheck`, `pnpm build` | Pass. Biome's remaining warnings are in files D01 did not touch |
| `deploy/test/nginx/run.sh` | Both layouts pass (171 checks) |
| `deploy/test/split-hosts/rehearse.cjs` | 18/18 against the real platform and storefront on `app.` / `api.localhost` |
| Production-mode rehearsal (smoke run + `compose.split.yml`) | **Not run** (needs built images and scratch secrets): the first D11 step |
| Live DNS, Cloudflare, production env or deploy | **Unchanged** |
