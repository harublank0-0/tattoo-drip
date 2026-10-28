# Deploying the platform

Read before a deploy or when changing production settings. The hosting itself is TAT-14's; this page is what the platform needs from it. Nothing here is covered by the test suite: check it against your deploy.

## Public API production checklist

### Platform settings

- `NODE_ENV=production`. With it, the web server, the worker and every `ace` command refuse to start without `STOREFRONT_URL`, `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS` and `TRUST_PROXY` (`start/env.ts`).
- `APP_KEY` (`node ace generate:key`; rotating it ends every session, deposit link and rate-limit count). `APP_URL`: the platform's public https origin (public upload URLs and emails use it), on a domain of its own, apart from the studio pages' ([below](#dashboard-cookies-and-domains)).
- `STOREFRONT_URL`: the studio pages' origin with `{tenant}` for the slug, e.g. `https://{tenant}.example.com` (deposit links).
- `TURNSTILE_SECRET_KEY` (the bot challenge, TAT-55), with outbound HTTPS to `challenges.cloudflare.com` allowed.
- `STOREFRONT_SERVER_KEYS`: the storefront's key ([below](#the-storefronts-server-key)).
- `TRUST_PROXY`: the addresses of the reverse proxy in front of the app, as a list: `loopback` when it runs on the same host, its address or CIDR when it is a load balancer, plus Cloudflare's ranges if Cloudflare fronts the API. Never every address. Wrong, every visitor shares the proxy's address, and one person's attempts lock everyone out of login, signup, the intake and the deposit page.
- `DB_USER` / `DB_PASSWORD` are the app role. `DB_MIGRATION_PASSWORD` belongs only in the migration step's environment.
- Mail (TAT-52, TAT-88): new inquiries email the studio's owners and the asked-for artist, and deposit screenshots the owners and the project's artist, from the worker. `MAIL_FROM_ADDRESS` must be on the platform's own sending domain with SPF, DKIM and DMARC (TAT-20), and `SMTP_*` a provider allowed to send for it. Until then set `ALERT_EMAILS=false`: the alerts reach the dashboard only, and every process logs one warning at boot. With mail on and SMTP failing, each email fails after 3 retries with one "Sending email failed." log line; the dashboard alerts don't depend on it.

### Account email

- Signup, email confirmation and password reset (TAT-18) need working mail: `MAIL_FROM_ADDRESS` on the platform's sending domain with SPF, DKIM and DMARC (TAT-20), `SMTP_*` a provider allowed to send for it, `APP_URL` the dashboard's public https origin (the links point there), and a running worker. `ALERT_EMAILS=false` doesn't stop these emails.
- Until mail reaches inboxes, a new account can sign in but can't create a studio. Confirm a pilot's account by hand with `node build/ace.js account:verify <email>` once you have checked who is asking (in person or by phone: it skips the proof the link gives). It prints no token, id or link.
- Invitees need a confirmed address too (TAT-33): until mail reaches inboxes, an artist joins by signing up, being confirmed with `account:verify` after you checked who they are, then opening the owner's invitation link again. The owner sends the invitation link themselves (no invitation email).
- A send that fails retries 3 times, then logs one "Sending email failed." line with the recipient and the subject, never the link. The account is untouched; the person asks for a new link ("Send a new link", or a new reset request).
- Every signed-in session signs out once after this release: sessions now carry the account's session version.

### Storefront settings (Vercel, TAT-13)

- `API_URL`: the API's public https origin (browsers call it too). `STOREFRONT_URL`, `TURNSTILE_SITE_KEY`, and `STOREFRONT_SERVER_KEY`: one of the platform's keys. With `NODE_ENV=production` a missing key makes every page a 500 that names the variable.

### Processes

- Node 24.3.0 (`.nvmrc`) in the container: on Node 26.9 the multipart parser stalls on large text fields. Re-run `inquiry_refusals.spec.ts` before any Node upgrade.
- Before each release: `node build/ace.js migration:run --connection=owner --force` ([database conventions](../database/README.md#row-level-security)).
- Pilot numbers (TAT-70): `node build/ace.js metrics:pilot --days=42` from the migration step's environment (it lists the studios as the owner role, so it needs `DB_MIGRATION_USER` and `DB_MIGRATION_PASSWORD`, plus the app role's `DB_USER` and `DB_PASSWORD` for the numbers; like the web server and the worker, it refuses to start when `DB_USER` is a role that bypasses row-level security). It prints studio names, slugs and aggregates only.
- One web server (`node bin/server.js` in `build/`): it upserts the recurring schedules when it boots.
- At least one worker (`node ace.js queue:work` in `build/`, with the same environment): alerts, quote expiry and the expiry sweep run only there.

### Reverse proxy

Values for nginx; set the equivalent on the host's proxy.

- Keep request buffering on (`proxy_request_buffering on`, nginx's default): the proxy then receives a slow upload whole before the app holds anything for it.
- `client_max_body_size 21m` (the parser's 20 MB plus multipart overhead), `client_header_timeout 15s`, `client_body_timeout 30s` (between two reads), `send_timeout 30s`, `proxy_read_timeout 130s` (above the app's 120 s dashboard upload deadline, so its 408 reaches the client), and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`.
- Keep-alive: the app closes an idle connection after 5 s (Node's default). Keep the proxy's upstream keep-alive below that, or raise `keepAliveTimeout` in `config/app.ts` above the proxy's.
- No access log for the deposit paths, `/api/v1/tenants/<slug>/deposits/<token>` (GET and POST), and no APM URL capture there: the path holds a deposit link's token for 30 days. In nginx that is a regex location with the same `proxy_pass` and headers as the API's: `location ~ ^/api/v1/tenants/[^/]+/deposits/ { access_log off; ... }`. A prefix location written with a glob, `location /api/v1/tenants/*/deposits/*`, matches nothing (nginx reads the `*` literally), so the tokens would stay in the log; after changing it, send one request and check that it is not logged. Keep `/files` request URLs (signed) out of logs too.
- No access log for the account links either: `GET /reset-password/<token>`, `GET /verify-email/<token>` and `GET /invitations/<token>` carry a single-use token for up to an hour, a day or (an invitation link, TAT-33) 7 days. In nginx: `location ~ ^/(reset-password|verify-email|invitations)/ { access_log off; ... }` with the same `proxy_pass` and headers as the dashboard's. The pages they open have no token in their URL.
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

Known and accepted for the pilot. The owner gets no signal for any of them (429s and busy 503s are not logged on purpose, and the staff alerts cover new inquiries and deposit screenshots only, not a form at its limit: TAT-88 ruling 12), so look here first when a studio says its form "stopped working".

- 60 solved bot challenges in an hour, from 3 or more addresses, close one studio's intake form for the rest of that hour (TAT-55's per-studio limit).
- 10 solved challenges with a victim's phone number lock that number out of that studio's form for up to 24 hours (TAT-55's per-phone limit).
- A few slow uploads (4 per web process, from 2 or more addresses) make every upload answer 503 `service_busy` for up to about 100 s at a time; the pages and the dashboard keep working.
- A flood of one studio's pages from many addresses can spend its read budget (6000 storefront reads per 5 minutes) and show its pages' "try again" page for the rest of the window; other studios are untouched.
- Someone who knows an owner's sign-in email (a studio page that prints the same address makes it easy) can keep that account out of sign-in: 25 wrong passwords in 15 minutes from 3 or more addresses refuse even the right password until the window ends, and can be repeated every window (TAT-8's per-email limit counts before the password is checked). A completed password reset clears that count: "Forgot your password?", then sign in right away with the new password. Give the studio page a contact address other than the sign-in one.
- One visitor on a shared mobile address (carrier NAT: many Nepali customers share one IPv4 address) can, without solving a challenge, spend the intake's 20 tries per studio an hour and the platform's 60 public writes an hour for that address: everyone else on it gets "try again later" on the form and on the deposit page's screenshot upload for up to an hour. These count before Cloudflare is asked, on purpose (no Cloudflare call for a refused address). All of these count the right address only when `TRUST_PROXY` is right.

### After the first deploy

- Sign up with an address you own: "Confirm your email address" arrives (spam folder included), its link opens the confirmation page, and confirming lets you set up a studio. "Forgot your password?" sends "Choose a new password"; finishing the reset signs out your other browser.
- Open a studio page, then check the API log: no "server key this API does not accept" and no "no usable X-Visitor-IP" warning (either means the key or the visitor's address isn't reaching the API).
- `curl -sI https://<api>/api/v1/tenants/<slug>` answers 200 with `Cache-Control: public…` and no `X-RateLimit-*` header.
- Open a deposit link (a project's "Copy link") on a phone, sent by WhatsApp or Viber (Instagram and Facebook rewrite outgoing links through their own redirect, which carries the whole URL, fragment included, to Meta), then check the storefront's and the CDN's request logs: `/deposit` appears without its `#` fragment, and the API proxy's access log has no `/deposits/` line.
- With `ALERT_EMAILS` on, send one inquiry to your own studio and check the owner's mailbox, spam folder included, for "New inquiry for …"; its button opens the inquiry.
- With `ALERT_EMAILS` on, send one deposit screenshot to your own studio's deposit link and check the owner's mailbox for "Deposit screenshot for …"; its button opens the project at the Payments card.
- Run the storefront's `pnpm check:page` against the production build before the first deploy (TAT-13).
- Still required before any public deploy: object storage (TAT-27: the local disks must never deploy). The intake form (TAT-57) and the deposit page (TAT-65b) must be merged too.

## Dashboard cookies and domains

The dashboard's session cookie is `__Host-td-session`: host-only, `Secure`, `HttpOnly` and `SameSite=Lax` (TAT-9), so no studio page can read, set or replace it. These settings keep it that way.

- Two registrable domains, bought separately: one for the platform (the dashboard on `app.<platform>`, the API on `api.<platform>` or the same host) and one for the studio pages (the storefront's apex and `*.<studios>`). Never the dashboard or the API under the studio domain, the studio pages under the platform's, or both under one parent you own (`app.example.com` with `{tenant}.sites.example.com` passes the boot check but shares `example.com`). Two names under a public suffix such as `com.np` are separate; check a doubtful parent at publicsuffix.org.
- `APP_URL` is the dashboard's https origin. With `NODE_ENV=production` the web server, the worker and every `ace` command that boots the app refuse to start when it is http, or on, under or above `STOREFRONT_URL`'s domain.
- `SESSION_DRIVER=cookie`: `memory` loses every session on restart and between processes, and `database` needs a `sessions` table this app doesn't have. `APP_KEY` signs and encrypts the session and CSRF cookies: rotating it signs everyone out.
- The storefront's `API_URL` is on the platform's domain (`api.<platform>` or `APP_URL`'s host), never on a studio domain.
- The proxy terminates TLS for the platform's hosts and redirects http to https: the app never redirects, and over plain http the browser drops the `Secure` cookie, so every sign-in would end on "Invalid or expired CSRF token". Shield sends HSTS (180 days). The cookies need no `TRUST_PROXY`: the app writes `Secure` whatever protocol it sees.
- DNS: the studio domain's apex and wildcard go to Vercel only (TAT-13); the platform's names go to the platform. No wildcard on the platform's domain.
- Custom studio domains (TAT-79) are never the platform's hosts or on its domain.
- After the first deploy: sign in at `https://app.<platform>`; in DevTools, Application, Cookies, `__Host-td-session` shows Secure, HttpOnly, SameSite Lax and no Domain; `curl -sI http://app.<platform>/login` answers a redirect to https.
