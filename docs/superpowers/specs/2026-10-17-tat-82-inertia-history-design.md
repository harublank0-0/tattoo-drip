# Encrypted page history, cleared on the guest pages (TAT-82)

Date: 2026-10-17
Refs: TAT-82 (Encrypt Inertia page history and clear it on logout), found by the Codex security review on PR #18 (TAT-64). Designed unattended: every open question is decided in the Rulings below.

## Goal

After someone logs out on a shared browser (the studio front desk), pressing **Back** never shows the previous user's pages. The browser goes back to the server, which sends the visitor to the login page. The same holds after a different user signs in. Plain-HTTP development from a phone on the LAN keeps working.

No migration, route, page, API, SDK or OpenAPI change.

## What the installed packages do

- `@adonisjs/inertia` 5.0.1: `defineConfig({ encryptHistory: true })` turns encryption on for every response (the constructor reads `config.encryptHistory`; the `history: { encrypt }` key in `defineConfig`'s defaults is unused). `ctx.inertia.encryptHistory(bool)` and `ctx.inertia.clearHistory()` set flags on **this request's** Inertia instance. The flags are written only into a rendered page object (`encryptHistory: true` / `clearHistory: true`, left out when false). A redirect response carries neither flag, and the next request starts with `clearHistory` false.
- `@inertiajs/core` 3.8.0 (client): with `encryptHistory`, each page is AES-GCM encrypted with a key kept in the tab's `sessionStorage`. `clearHistory` removes the key and IV before the new page is stored. On Back, decryption of an older entry then fails, and the client re-visits that URL from the server (`missingHistoryItem` → `router.visit(location, { replace: true })`). The auth middleware then redirects to `/login`. bfcache restores are re-checked the same way (`pageshow`).
- Plain HTTP on a non-loopback host (e.g. `http://192.168.1.20:3401` from a phone) is not a secure context, so `crypto.subtle` is missing. `encryptHistory()` then throws ("Unable to encrypt history"), and `History.getPageData` wraps it in a promise that never settles. The history queue stalls: the first page renders (React mounts the initial component directly), but every later visit hangs. This is read from `dist/index.js`, not observed; the browser pass confirms it.

## Changes

| File | Change |
|---|---|
| `apps/platform/config/inertia.ts` | `encryptHistory: true`, with a short why-comment |
| `apps/platform/app/services/history_encryption.ts` | New, pure: `encryptsHistory(request, inProduction)` is true in production, or over `https`, or when `request.hostname()` (lower-cased) is `localhost`, ends in `.localhost`, matches `^127(\.\d{1,3}){3}$`, or is `[::1]`; false otherwise, including no host |
| `apps/platform/app/middleware/inertia_middleware.ts` | In `handle`, after `init`: `if (!encryptsHistory(ctx.request, app.inProduction)) ctx.inertia.encryptHistory(false)` |
| `apps/platform/app/middleware/guest_middleware.ts` | Before `return next()` (the visitor is a guest): `ctx.inertia.clearHistory()`, with a comment saying why it lives here and not in logout |
| `apps/platform/tests/functional/auth/page_history.spec.ts`, `apps/platform/tests/unit/services/history_encryption.spec.ts` | New (Tests below) |
| `apps/platform/docs/backend.md` | A "Page history" bullet in "Tenancy and route access" |

## Rulings

1. **Encrypt every page, in the config.** Why: almost every dashboard page shows client or studio data, and a per-page opt-in is a step that new pages would forget. Rejected: per-response `ctx.inertia.encryptHistory()` on the sensitive pages only.
2. **Clear history on every guest-page render (guest middleware), not in `SessionController.destroy`.** Why: in 5.0.1 the flag only rides on a rendered page, and logout, login and signup all answer with redirects (login passes through three of them), so a `clearHistory()` call there does nothing. Every signed-out visitor lands on a guest page: logout redirects to `/login`, and so does an expired session. A different user can only sign in from `/login` or `/signup`. Rejected: (a) calling it in `destroy` / `store`, as the ticket worded it, which does nothing on a redirect; (b) a Laravel-style session flag set on logout/login and pulled by the next render, which survives redirects but adds session state and misses the expired-session bounce; (c) `router.clearHistory()` in the logout form, which runs on the client only and misses a change of user.
3. **No separate "switch account" handling.** The tenant switcher keeps the same user, and changing user means logging out, so Ruling 2 covers it.
4. **Plain-HTTP fallback in development only.** In development, a request that isn't HTTPS and whose host isn't loopback gets no encryption, so phone testing over the LAN works. History stays readable there, which is acceptable for a development device. Production always encrypts. Its session cookies are `secure`, so it is HTTPS-only anyway. Without a `trustProxy` setting, `request.protocol()` reads `http` behind a non-loopback TLS proxy, so a host check in production could silently turn encryption off. Rejected: an env flag (one more setting to remember); no encryption anywhere outside production (local development would never run the real path, and the Back check couldn't be done locally); only documenting "use localhost" (LAN visits would hang).
5. **What the tests pin.** The ticket's "logout response carries the clear-history flag" can't hold: the response is a 302 with no page object. The tests check that logout redirects to `/login`, that `/login` and `/signup` send `clearHistory: true`, that a signed-in page sends `encryptHistory: true` and no `clearHistory`, and that a development request from a LAN host sends no `encryptHistory`. Rejected: following the redirect inside one test request, which depends on how superagent carries headers across redirects.
6. **Other tabs keep their key.** `sessionStorage` is per tab, so a second tab of the same user keeps its history until that tab reaches a guest page. Accepted: that tab is still showing its current page anyway, and Inertia offers nothing across tabs.

## Tests

`encryptsHistory` (unit): production always true (LAN host, no host). In development: true over `https` and for `localhost`, `app.localhost`, `127.0.0.1`, `127.1.2.3` and `[::1]`; false over `http` for `192.168.1.20`, `0.0.0.0`, the lookalikes `127.0.0.1.nip.io`, `localhost.example.com` and `mylocalhost`, and no host.

HTTP (`tests/functional/auth/page_history.spec.ts`). Requests set `Host` explicitly, so the result doesn't depend on `HOST` in `.env`:

- `/login` (guest) and `/onboarding` (signed-in user without a tenant), `Host: localhost:3402`: `encryptHistory` is true.
- Development over plain HTTP: `Host: 192.168.1.20:3402` has no `encryptHistory`; `127.0.0.1:3402` keeps it.
- `/login` and `/signup` have `clearHistory: true`.
- `POST /logout` (signed in, CSRF): 302 to `/login`, and `/login` has `clearHistory: true`.
- `/onboarding` (signed in) has no `clearHistory`.
- Not automated: the Back button itself (browser pass).

## Browser pass (the user)

1. On `localhost`, open a project page, log out, press Back (several times): no client data appears and the login page shows.
2. Log in as a second user and press Back: the first user's pages never appear.
3. Open the dev server at its LAN IP (`http://<ip>:3401`, a phone or the same machine): `window.isSecureContext` is false, and links and forms navigate normally.

## Rules for other tickets

- A page where a new person may start (password reset, invitation, TAT-8 and later) goes in the `guest` route group, so it clears history. A flow that signs a user in without passing through a guest page must clear history on the first page it renders.
- Don't call `ctx.inertia.clearHistory()` before a redirect: the flag is dropped.

## Not in this ticket

Clearing history across tabs, the auth middleware, the HTTP cache headers for Back across full page loads, and SSR (off).

## Verification

`PORT=3402 node ace test` passes; `pnpm check`, `pnpm typecheck` and `pnpm build` are clean; `node ace codegen` changes nothing; the browser pass above.
