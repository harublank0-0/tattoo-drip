# Deploying the platform

Read before a deploy or when changing production settings. The hosting itself is TAT-14's; this page is what the platform needs from it. Nothing here is covered by the test suite: check it against your deploy.

## Public API production checklist

### Platform settings

- `NODE_ENV=production`. With it, the web server, the worker and every `ace` command refuse to start without `STOREFRONT_URL`, `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS` and `TRUST_PROXY` (`start/env.ts`).
- `APP_KEY` (`node ace generate:key`; rotating it ends every session, deposit link and rate-limit count). `APP_URL`: the platform's public https origin (public upload URLs and emails use it).
- `STOREFRONT_URL`: the studio pages' origin with `{tenant}` for the slug, e.g. `https://{tenant}.example.com` (deposit links).
- `TURNSTILE_SECRET_KEY` (the bot challenge, TAT-55), with outbound HTTPS to `challenges.cloudflare.com` allowed.
- `STOREFRONT_SERVER_KEYS`: the storefront's key ([below](#the-storefronts-server-key)).
- `TRUST_PROXY`: the addresses of the reverse proxy in front of the app, as a list: `loopback` when it runs on the same host, its address or CIDR when it is a load balancer, plus Cloudflare's ranges if Cloudflare fronts the API. Never every address. Wrong, every visitor shares the proxy's address, and one person's attempts lock everyone out of login, signup, the intake and the deposit page.
- `DB_USER` / `DB_PASSWORD` are the app role. `DB_MIGRATION_PASSWORD` belongs only in the migration step's environment.

### Storefront settings (Vercel, TAT-13)

- `API_URL`: the API's public https origin (browsers call it too). `STOREFRONT_URL`, `TURNSTILE_SITE_KEY`, and `STOREFRONT_SERVER_KEY`: one of the platform's keys. With `NODE_ENV=production` a missing key makes every page a 500 that names the variable.

### Processes

- Node 24.3.0 (`.nvmrc`) in the container: on Node 26.9 the multipart parser stalls on large text fields. Re-run `inquiry_refusals.spec.ts` before any Node upgrade.
- Before each release: `node build/ace.js migration:run --connection=owner --force` ([database conventions](../database/README.md#row-level-security)).
- One web server (`node bin/server.js` in `build/`): it upserts the recurring schedules when it boots.
- At least one worker (`node ace.js queue:work` in `build/`, with the same environment): alerts, quote expiry and the expiry sweep run only there.

### Reverse proxy

Values for nginx; set the equivalent on the host's proxy.

- Keep request buffering on (`proxy_request_buffering on`, nginx's default): the proxy then receives a slow upload whole before the app holds anything for it.
- `client_max_body_size 21m` (the parser's 20 MB plus multipart overhead), `client_header_timeout 15s`, `client_body_timeout 30s` (between two reads), `send_timeout 30s`, `proxy_read_timeout 130s` (above the app's 120 s dashboard upload deadline, so its 408 reaches the client), and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`.
- Keep-alive: the app closes an idle connection after 5 s (Node's default). Keep the proxy's upstream keep-alive below that, or raise `keepAliveTimeout` in `config/app.ts` above the proxy's.
- No access log for the deposit paths, `/api/v1/tenants/<slug>/deposits/<token>` (GET and POST), and no APM URL capture there: the path holds a deposit link's token for 30 days. In nginx that is a regex location with the same `proxy_pass` and headers as the API's: `location ~ ^/api/v1/tenants/[^/]+/deposits/ { access_log off; ... }`. A prefix location written with a glob, `location /api/v1/tenants/*/deposits/*`, matches nothing (nginx reads the `*` literally), so the tokens would stay in the log; after changing it, send one request and check that it is not logged. Keep `/files` request URLs (signed) out of logs too.
- What the app does itself (TAT-38): every API request counts per caller before its body is read, reads per studio too; at most 4 API writes at once per process (2 per address); an upload must arrive within 90 s (120 s on the dashboard); Node drops a request not fully received after 120 s, but it checks only every 30 s (`connectionsCheckingInterval`), so the drop lands between 120 and about 150 s; the 90 s and 120 s upload deadlines are the app's own timers and are exact.

### Database

- Connections: a web server's pool holds up to 10 (`pgPoolFor`, `#services/db_pool`) plus the limiter's 4; a worker's up to 6. A public request holds one of the 10 for its whole length, the intake's up-to-3-second Cloudflare check and a slow upload included, because `publicTenant` opens its transaction before them. One web server and one worker need about 20, plus migrations and your own `psql`: keep `max_connections` above that with headroom, and add 14 for each extra web server.
- `ALTER ROLE tattoo_drip_app SET idle_in_transaction_session_timeout = '3min';` (`setup_roles.sql` doesn't set it): above the slowest request, since an upload holds its transaction for up to about 100 s, and the intake's bot-challenge call to Cloudflare (up to 3 s) runs inside that same pooled transaction.
- A request that waits 10 s for a connection fails; on the API it answers 503 `service_busy` and is logged. If that shows in the log, raise the pool and `max_connections` together.
- Roles, migrations and seeders: [database conventions](../database/README.md#row-level-security).

### The storefront's server key

- Make one with `openssl rand -base64 32`, and set it as the storefront's `STOREFRONT_SERVER_KEY` and the platform's `STOREFRONT_SERVER_KEYS`.
- It only lets the storefront's server-side calls count per visitor (`X-Visitor-IP`) instead of as one client; it opens no data. Never put it in a `VITE_` variable, a log or a browser.
- Rotate without downtime: (1) set the platform's `STOREFRONT_SERVER_KEYS=old,new` and restart it; (2) set the storefront's `STOREFRONT_SERVER_KEY=new` and redeploy it, and retire or redeploy any other storefront deployment that can still serve traffic (a pinned or preview deployment keeps the key it was given); (3) set `STOREFRONT_SERVER_KEYS=new` and restart the platform. While both keys are listed, the API cannot tell which one a request used and logs nothing about the old one, so the log tells you nothing before step 3. After step 3, watch it for 10 minutes: the warning "server key this API does not accept" (at most one every 10 minutes per process) means a deployment still sends the old key, so put `old,new` back, fix that deployment and repeat step 3. A mistyped key looks the same: that warning right after a deploy, and nothing else breaks, because the call counts as an anonymous client (the storefront's own address, 300 reads per 5 minutes for every visitor) and the pages slow down or show "try again" under load. The API never answers 401.

### Recommended, not required

- Cloudflare in front of the API: add its IP ranges (cloudflare.com/ips) to `TRUST_PROXY`, let only Cloudflare reach the origin, and add a coarse rate-limiting rule as an outer layer. Without that `TRUST_PROXY` entry every visitor shares a Cloudflare address.
- Vercel's firewall rate limiting for the storefront: each random studio subdomain or query string costs a function run before the API sees it.

### Accepted denial costs

Known and accepted for the pilot. The owner gets no signal for any of them (429s and busy 503s are not logged on purpose; alerts are TAT-52), so look here first when a studio says its form "stopped working".

- 60 solved bot challenges in an hour, from 3 or more addresses, close one studio's intake form for the rest of that hour (TAT-55's per-studio limit).
- 10 solved challenges with a victim's phone number lock that number out of that studio's form for up to 24 hours (TAT-55's per-phone limit).
- A few slow uploads (4 per web process, from 2 or more addresses) make every upload answer 503 `service_busy` for up to about 100 s at a time; the pages and the dashboard keep working.
- A flood of one studio's pages from many addresses can spend its read budget (6000 storefront reads per 5 minutes) and show its pages' "try again" page for the rest of the window; other studios are untouched.
- One carrier-NAT address shared by many customers shares 60 writes an hour across the platform, and the intake's 20 per studio per hour, which counts before Cloudflare is asked. All of these count the right address only when `TRUST_PROXY` is right.

### After the first deploy

- Open a studio page, then check the API log: no "server key this API does not accept" and no "no usable X-Visitor-IP" warning (either means the key or the visitor's address isn't reaching the API).
- `curl -sI https://<api>/api/v1/tenants/<slug>` answers 200 with `Cache-Control: public…` and no `X-RateLimit-*` header.
- Run the storefront's `pnpm check:page` against the production build before the first deploy (TAT-13).
- Still required before any public deploy: object storage (TAT-27: the local disks must never deploy) and the storefront deposit page (TAT-65b). The intake form (TAT-57) must be merged too.
