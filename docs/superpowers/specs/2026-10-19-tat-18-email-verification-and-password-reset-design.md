# Email verification and password reset (TAT-18)

Date: 2026-10-19
Refs: TAT-18 (Email verification and password reset). Builds on TAT-6 (`@adonisjs/mail`, `SendMailJob`, the shared email layout, the starter `VerifyEmailMail`), TAT-8 (`AUTH_LIMITS`, `throttleLogin`, `throttleSignup`, the "Too many attempts" toast), TAT-82 (the `guest` group clears page history), TAT-9 (cookie policy, `SESSION_DRIVER=cookie` in production), TAT-19 (onboarding creates the tenant), TAT-52 (`sendMailInTransaction`, the alert emails) and TAT-24 (slugs). Blocks TAT-33 (member invitations), which reuses the gate. Honours the carry-forwards (a) to (e) that TAT-8 and TAT-82 left on the ticket.
Size: **about 5 points** (the ticket says 2). Ruling 1 keeps it there by moving email change, "sign out everywhere", password policy changes and account pruning to carry-forwards.

## Goal

A new account confirms its email address with a single-use, expiring link before it can create a studio (or, with TAT-33, accept an invitation); everything an existing member already does keeps working. Anyone who forgot their password gets a single-use link that sets a new one, signs out every session and tells the account's mailbox. Signup and the reset request never reveal whether an address has an account, every new form is rate-limited with TAT-8's machinery, and email addresses become case-insensitive.

Three additive migrations (canonical emails, two columns on `users`, `account_tokens`), no new setting, one operator command (`account:verify`), twelve new routes (all outside `/t/:tenant`), no API, OpenAPI, SDK or storefront change. Written without the user (unattended run): every open question is a ruling below.

## Depends on the built chain

Designed on a5fa888, the tip of TAT-52's build (still in review, so its tip may move). It holds `sendMailInTransaction`, the `notifications` module and `ALERT_EMAILS`, which this ticket sits next to. The plan's Task 0 checks for the named code it edits, not a commit.

## Rulings

1. **About 5 points, the four boxes and carry-forwards (a) to (e), nothing more.** In: confirmation on signup with resend; password reset; the confirmed-email gate on tenant creation (and the mechanism TAT-33 calls); rate limits; canonical emails with the data cleanup; enumeration-safe signup; server-side sign-out on reset; an operator command for the pilot. Out, as carry-forwards: changing an account's email (ruling 15), a "sign out everywhere" button or a change-password page (ruling 14), the 32-character password maximum and breached-password checks (ruling 13), pruning unconfirmed accounts (ruling 18), 2FA. Why: each item in is needed for a box or a carry-forward the ticket names. Rejected: a 2-point slice without canonical emails or session sign-out (TAT-8's (c) and the reset's whole point would stay open).
2. **One token mechanism for both links, stored, not a signed URL.** `account_tokens` (not tenant-owned): `user_id`, `purpose` (`verify_email` or `reset_password`), `token_hash`, `email` (the address the link was sent to), `expires_at`, `created_at`. A token is 32 random bytes in base64url (43 characters, 256 bits); only its SHA-256 (hex) is stored. One row per account and purpose (unique `(user_id, purpose)`): a new link replaces the old one, which stops working at once. Using a link is one `delete … where token_hash = ? and purpose = ? and expires_at > now() returning user_id, email`, so two requests racing with one token get it once. A link is dead when the account's address is no longer the one it was sent to. "Signed" in the ticket means unforgeable: 256 random bits are. Rejected: `router.makeSignedUrl` (can't be single-use or replaced, carries the user id and expiry in the URL, can't tell "used" apart); an HMAC instead of SHA-256 (no low-entropy input to protect).
3. **Lookup by digest; that is the constant-time compare.** The secret is never compared: the database matches its SHA-256 through a unique index. Timing can reveal at most how much of a digest matched, which gives no way to build a token that hashes to it. Deposit links (TAT-65) use the same rule. Rejected: a selector and verifier split with `timingSafeEqual` (a two-part link for no gain at 256 bits).
4. **Expiry: confirmation links 24 hours, reset links 60 minutes, by the database's clock.** An expired row stays until it is replaced or the account is deleted (at most two per account), so no sweeper. Rejected: 7-day confirmation links (a week of exposure in a mailbox); 15-minute reset links (mail can arrive late or in spam).
5. **The link carries the token in its path; its GET moves it into the session; the change is a POST from a page whose URL has no token.** `GET /reset-password/<token>` and `GET /verify-email/<token>` (43 base64url characters, else the router's 404) only `session.put` the token and redirect to `/reset-password` or `/verify-email`, answering `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. The page reads the token from the session (production's cookie store keeps it encrypted with `APP_KEY`), so it is never in that page's URL, its Referer, browser history, Inertia's page object or analytics. The pages answer `Cache-Control: no-store` and `Referrer-Policy: same-origin` (not `no-referrer`: a refused form goes back by its Referer). Setting the password and confirming the address are POSTs with Shield's CSRF token, so a mail scanner that opens links fills only its own session. The token reaches the reverse proxy's access log once: deploy.md turns logging off for those two paths, as for deposit links. Rejected: a `#token` fragment (JavaScript would have to post it into the session anyway, and a form error loses it); a query string (the same logs, and it rides along in Referer).
6. **Signup never reveals whether an address has an account (carry-forward (d)).** No unique rule; nobody is signed in by signup; the answer is always a redirect to `/signup/sent` ("Check your email") with the address in a flash. A new address gets an unconfirmed account and a confirmation email; a taken one gets no change to its account and a "You already have a Tattoo Drip account" email with a sign-in link and a reset link. Both do the same work: the model hashes the password either way (a taken address's insert fails in a savepoint after hashing), one token is written and one email queued; the taken path adds one indexed select (well under network jitter), and TAT-8's 10 per hour per client address plus ruling 12's 3 per hour per address leave nothing to average. Why signup stops signing in: being signed in or not after the POST would itself tell. Rejected: keeping the "already taken" field error; signing in new accounts only.
7. **Account emails print nothing the signup form took.** No name ("Hello,") in any of the four emails: the form is open to anyone, so its fields must not become words in an email sent to someone else's address. Subjects hold no link or token (`SendMailJob.failed()` logs subjects and recipients).
8. **Email addresses are canonical (carry-forward (c), in this ticket).** Canonical means surrounding whitespace removed and the ASCII letters A to Z in lower case; nothing else changes (other scripts keep their case; dots and `+tags` stay). One function, `canonicalEmail` (`#modules/identity/email_address`), runs in the shared `accountEmail()` Vine rule (signup, login, reset request), in a `User` `beforeSave` hook, and the database checks it (`users_email_canonical`: `email = translate(btrim(email), 'A…Z', 'a…z')`); the existing unique constraint then means one account per address whatever its case, and lookups stay exact. Gmail dots and plus-tags: no; their meaning depends on the provider, folding them would merge different mailboxes elsewhere, and people use `+tags` on purpose. Why ASCII only: `translate()` and the JavaScript rule agree in every Postgres locale, while `lower()` follows the database's locale. Rejected: Unicode `lower()`; `citext` (an extension, and the same locale question); a second "canonical" column; Vine's `normalizeEmail()` (drops Gmail dots and tags).
9. **The cleanup migration never merges, renames or deletes an account.** It first refuses, rolling everything back, while two accounts share an address once case and surrounding spaces are ignored; its message gives the number of such addresses and points at the README, where the operator finds the query that lists them and decides which account keeps each address. Otherwise it rewrites every address to its canonical form and adds the check. `down()` drops the check and leaves the addresses canonical: the old schema accepts them and their former case carried nothing anything reads. Rejected: renaming the duplicates (someone silently loses their login), merging (two people's data in one account), keeping the original case in a backup table (personal data kept for a case nobody uses).
10. **Login looks up the canonical address; TAT-8's limits stay as they are.** A sign-in still gives back only its own two points. TAT-8 kept earlier email failures because look-alike accounts shared a count; that reason is gone, the behaviour stays (a sign-in proves the password, not who made the earlier guesses). Rejected: clearing the email count on every sign-in (TAT-8's decision; a separate follow-up if wanted).
11. **The reset request answers the same for every address.** `/forgot-password` redirects to `/forgot-password/sent`: "If an account uses ink@example.com, we sent it a link to choose a new password." An address without an account gets no email: sending to any typed address would let anyone use the platform to mail strangers, and bounces would hurt the sending domain. The found path writes one token and queues one email more than the unknown one (a few milliseconds), and 3 requests per address per hour leave nothing to measure. Rejected: a queued lookup job for equal work (a second queue hop and the typed address in `queue_jobs` for a difference the limit already hides); a "no account uses this address" email.
12. **Rate limits with TAT-8's machinery (carry-forward (a)).** New `AUTH_LIMITS` entries, each a `limiter.define` middleware in `start/limiter.ts` that counts every request (unknown addresses too), keyed by `digest(...)`: `signupPerEmail` 3 per hour (after the existing 10 per client address); `resetPerIp` 10 per hour and `resetPerEmail` 3 per hour on the reset request (the address limit first); `accountLinksPerIp` 30 per 15 minutes on the two link GETs and the two token POSTs; `verifyResendCooldown` 1 per minute and `verifyResendPerUser` 5 per hour per account on "Send a new link". A form without an email isn't counted per address (validation refuses it). Refusals are TAT-8's toast "Too many attempts. Try again in N minutes.". The per-address limits cap the email one mailbox can be sent through the platform. Rejected: counting in controllers (TAT-8: every request counts, so middleware).
13. **A completed reset, in one transaction.** It sets the password with signup's rule (8 to 32 characters, never weaker), raises the account's session version (every session signs out, this browser included), uses the token (one per account and purpose, so every outstanding reset link dies), confirms the address if it wasn't (the link proved the mailbox; any confirmation link is revoked), queues "Your Tattoo Drip password was changed" to the account's address (the time in UTC and a link to `/forgot-password`, never a token), and after the commit clears the login failures counted for the account's STORED address (carry-forward (b); the client addresses' counts stay). It does not sign in: the page goes to `/login` with "Password changed. Sign in with your new password." Why: an emailed link would otherwise be a login credential, and a normal sign-in lets the password manager save the new password. Rejected: signing in after the reset; clearing the client address count.
14. **Server-side sign-out with cookie sessions: a session version.** `users.session_version` (integer, at least 1, default 1). The session keeps `<user id>.<version>` instead of the id: `SessionVersionUserProvider` (`#modules/identity/session_user_provider`, used by `config/auth.ts`) writes it and, when it loads the user for a session, returns nobody when the version isn't the account's. Auth, guest and silent auth all load the user that way, so a stale session is a guest everywhere, with no extra query. Sessions from before this ticket hold a bare id and sign out once at deploy (as TAT-9's rename did). Rejected: a digest of the password hash in the session (implicit, and a later "sign out everywhere" needs a counter anyway); a sessions table (`SESSION_DRIVER=cookie`); a second session key checked in a middleware (two places to keep in step, and tests' `loginAs` wouldn't write it).
15. **When a confirmation link is sent.** At signup for a new address, and on "Send a new link" (signed in, address not yet confirmed: the notice page and the banner), which replaces the old link. Never on login. There is no email change today; when one is built it must confirm the new address before switching (carry-forward).
16. **The confirmation page is open to everyone and signs nobody in (carry-forward (e), ruled).** `/verify-email` is not in the `guest` group: its usual visitor is signed in (the guest group would send them away), and since it signs nobody in or out there is no history to clear. States: ready (shows the address the link confirms; with another account signed in it says so and that confirming changes nothing for that account), done, expired, invalid (used, replaced or never issued). The link confirms the account it was sent to, whoever is signed in. After confirming: a signed-in visitor gets "Continue" (`/dashboard`), a guest "Sign in". Why no sign-in: someone who signed up with your address chose its password, and signing you in would put you in their account. Rejected: requiring the account itself to be signed in (opening the link on a phone would fail).
17. **The gate is one named middleware, `verifiedEmail`.** After `auth`: an account whose address isn't confirmed goes to `/confirm-email`, for any method, and nothing it sent is used. It guards `GET` and `POST /onboarding` now and TAT-33's accept-invitation route next; `account_routes.spec.ts` lists the gated routes and fails if one loses the middleware. Unconfirmed accounts can still sign in and out, use every page of every tenant they already belong to (any role), receive alerts, reset their password and ask for a new link; they can't create a tenant or accept an invitation. The service layer (`TenancyService.createTenant`) isn't gated: tests, seeders and the account itself call it. Rejected: gating every page (it would lock out the pilot's existing owners); a check inside `createTenant` (every test helper would change, and it's an HTTP rule).
18. **Existing accounts are unconfirmed.** A backfill would prove nothing. They see the banner and nothing they do today breaks; one without a tenant confirms before onboarding. That includes the user's own development account and the QA account (the SMTP sink or `account:verify` confirms them). There are no user seeders or factories: test helpers create unconfirmed users, like accounts from before this ticket, and tests that pass the gate set `emailVerifiedAt`. A prune of unconfirmed accounts without a tenant is a carry-forward.
19. **What unconfirmed users see.** `/confirm-email` (auth layout, signed in): the address, "Send a new link", and "Wrong address? Sign out, then create the account again with the right one." with a sign-out button; a confirmed account is sent on to `/dashboard`. On tenant pages, a slim bar under the top bar: "Confirm your email address: we sent a link to ink@example.com." with "Send a new link". The shared `user` prop gains `emailVerified`.
20. **Production mail before a sending domain exists (TAT-20).** Nothing switches confirmation off. Until mail reaches inboxes, a new account can sign in but can't create a studio; the operator confirms a pilot's account by hand after checking who they are some other way: `node build/ace.js account:verify <email>` (`node ace account:verify <email>` in development). It prints no token, id or link, works in every environment, and adds no power that shell and database access don't already have. Account emails ignore `ALERT_EMAILS` (they are required, not alerts). A failure stays inside `SendMailJob`: 3 retries, then one "Sending email failed." log line with the recipient and the subject, never the link; the account isn't touched, and "Send a new link" or a new reset request tries again. deploy.md says what to set before signup works. Rejected: a setting that skips confirmation (one forgotten variable opens studio creation to any address); showing or logging the link in development (a `NODE_ENV` mistake would leak it in production); a command that prints a reset link (a password equivalent in a terminal and its history).
21. **Guest pages (carry-forward (e)).** `/forgot-password`, `/forgot-password/sent`, `/reset-password/<token>`, `/reset-password` and `/signup/sent` join the `guest` group, so they clear page history (TAT-82). A signed-in visitor of a guest page now goes to `/dashboard` instead of the starter kit's `/` page (the reset link stays valid for its hour). `/verify-email` is outside the group (ruling 16), `/confirm-email` behind `auth`.
22. **No redirect target from a request; CSRF on every POST.** Every redirect in these flows is a named route, so there is no open redirect. Shield's CSRF covers the five new POSTs; tests pin it on the two that use a token.
23. **Logging.** Nothing new is logged. No token reaches an app log line; the queued email rows hold links, as before (`SendMailJob` keeps failed rows one day).
24. **Staff alerts keep going to every recipient (TAT-52's carry-forward to this ticket).** New members are confirmed by the gates; existing members' addresses are the ones they typed themselves. No change to `AlertService`.
25. **The guest layout loses the starter kit.** Its side panel's starter text and its link to plus.adonisjs.com go (these pages now hold reset and confirmation state and should link nowhere else); login reads "Sign in to your studio.", signup "Set up your studio in a few minutes." and shows the password rule.
26. **Three additive migrations; `account_tokens` is exempt from row-level security.** (a) the canonical-email cleanup and check; (b) `users.email_verified_at` and `users.session_version` with a positive check; (c) `account_tokens` with its unique keys, the purpose check, `expires_at > created_at` and `on delete cascade` from `users`. `account_tokens` is not tenant-owned and is read before any context exists, like `users`: it joins `EXEMPT` in `catalog_guard.spec.ts` with that reason. The new routes are not `/t/:tenant` routes, so `cases.ts` doesn't apply; accounts are isolated by the token itself, and the tests use another account's token, a page seen by another signed-in account and a resend that only ever reaches the signed-in account.
27. **Built on TAT-52's tip; conflicts are textual.** The plan quotes every edited file as it is at a5fa888.

## The pieces

### Pure helpers (`app/modules/identity/`)

- `email_address.ts`: `canonicalEmail(value)`.
- `account_tokens.ts`: `TOKEN_PURPOSES`, `TokenPurpose`, `TOKEN_MINUTES`, `ACCOUNT_TOKEN` (the route pattern), `SESSION_TOKEN_KEYS`, `SENT_TO_FLASH`, `CONFIRMED_FLASH`, `newAccountToken()`, `hashAccountToken(token)`, `linkPath(purpose, token)`, `accountUrl(appUrl, path)`.
- `session_identifier.ts`: `sessionIdentifier(user)`, `parseSessionIdentifier(value)`.
- `session_user_provider.ts`: `SessionVersionUserProvider` (extends the auth package's `SessionLucidUserProvider`).

### Services

| Operation | Rule |
|---|---|
| `AccountTokenService.issue(user, purpose)` | A new token for the account's current address; replaces the older one of that purpose; returns the token (only its hash is stored) |
| `AccountTokenService.state(token, purpose)` | `live` (with the account and address), `expired` or `unknown` |
| `AccountTokenService.consume(token, purpose)` | Deletes a live token and returns its account and address, once |
| `AccountTokenService.revoke(userId, purpose)` | Deletes the account's token of that purpose |
| `AccountService.signUp(input)` | Ruling 6 |
| `AccountService.sendVerification(user)` | A new confirmation link (ruling 15) |
| `AccountService.tokenState(token, purpose)` | What a link page shows |
| `AccountService.confirmEmail(token)` | Ruling 16; the account, or null |
| `AccountService.markVerified(email)` | `unknown`, `already` or `confirmed` (the command) |
| `AccountService.requestPasswordReset(email)` | Ruling 11 |
| `AccountService.resetPassword(token, password)` | Ruling 13; the account, or null |
| `clearLoginFailures(storedEmail)` (`auth_limits.ts`) | Deletes the login failure count of that address |

`User` gains `emailVerified` (a getter), a `beforeCreate` hook that fills the database defaults in memory (Lucid reads back only the id after an insert, and signing in needs the version) and the `beforeSave` canonical-email hook.

### Routes

| Method and path | Name | Group, middleware |
|---|---|---|
| `GET /signup/sent` | `new_account.sent` | guest |
| `GET /forgot-password` | `password_reset.create` | guest |
| `POST /forgot-password` | `password_reset.store` | guest, `throttleResetRequest`, `throttleResetEmail` |
| `GET /forgot-password/sent` | `password_reset.sent` | guest |
| `GET /reset-password/:token` | `password_reset.link` | guest, `throttleAccountLinks`, token pattern |
| `GET /reset-password` | `password_reset.edit` | guest |
| `POST /reset-password` | `password_reset.update` | guest, `throttleAccountLinks` |
| `GET /verify-email/:token` | `email_verification.link` | none, `throttleAccountLinks`, token pattern |
| `GET /verify-email` | `email_verification.show` | none |
| `POST /verify-email` | `email_verification.confirm` | none, `throttleAccountLinks` |
| `GET /confirm-email` | `email_verification.notice` | auth, dbContext |
| `POST /confirm-email` | `email_verification.resend` | auth, dbContext, `throttleVerifyCooldown`, `throttleVerifyResend` |

`POST /signup` gains `throttleSignupEmail`; `GET` and `POST /onboarding` gain `middleware.verifiedEmail()`.

## Screens

All in the existing `AuthLayout` (except the banner), one column, 44 px buttons and inputs (`h-11`), a `<Head>` title per page, errors under their field (`role="alert"`), toasts for flashes (Sonner's live region), light and dark through the theme tokens.

### Check your email (`auth/check_email`, after signup and after a reset request)

```
Check your email
We sent a link to ada@example.com. Open it to confirm your address,
then sign in to set up your studio.               (signup)
If an account uses ada@example.com, we sent it a link to choose a new
password.                                         (reset)
The link works for 24 hours. If this address already has an account,
the email says how to sign in instead. Nothing there after a few
minutes? Check your spam folder.                  (signup)
The link works for 1 hour. Nothing there after a few minutes? Check
your spam folder, or ask for a new link.          (reset)
[Ask for a new link] (reset)   [Back to sign in]
```

Without the flash (a reload): "the address you entered" instead of the address.

### Forgot password, reset form

"Reset your password" / "Enter your account's email address and we'll send you a link to choose a new password." / Email / [Send the link] ("Sending…") / Back to sign in. The reset form: "Choose a new password" / "For ink@example.com. Every device signed in to this account will be signed out; then sign in with the new password." / New password ("8 to 32 characters.") / Confirm new password / [Change password] ("Changing…"); a hidden `autocomplete="username"` field with the address, so a password manager files the new password under the right account. A dead link: "This link has expired" ("Reset links work for 1 hour.") or "This link no longer works" ("It was already used, or a newer link replaced it."), then "Ask for a new one if you still need it.", [Ask for a new link], Back to sign in.

### Confirmation page (`auth/verify_email`)

Ready: "Confirm your email address" / "Confirm ink@example.com as the email address of your Tattoo Drip account." / (another account signed in) "You're signed in as other@example.com. Confirming changes nothing for that account." / [Confirm email] ("Confirming…"). Done: "Email address confirmed" / "Thanks: ink@example.com is confirmed." / [Continue] or "Sign in to set up your studio." [Sign in]. Expired: "This link has expired" / "Confirmation links work for 24 hours."; invalid: "This link no longer works" / "It was already used, or a newer link replaced it."; then [Send a new link] (signed in, unconfirmed), [Continue] (signed in, confirmed) or "Sign in to send a new link." [Sign in].

### Confirm-email notice (`auth/confirm_email`) and the banner

Notice: "Confirm your email address" / "We sent a link to ink@example.com. Open it to confirm your address, then you can set up your studio." / "The link works for 24 hours. Nothing there? Check your spam folder, or send a new link." / [Send a new link] / divider / "Wrong address? Sign out, then create the account again with the right one." [Sign out]. Banner (`inertia/components/shell/verify_email_bar.tsx`, in `AppLayout` under the top bar, `aria-label="Email confirmation"`): "Confirm your email address: we sent a link to ink@example.com." [Send a new link]; it wraps at 375 px.

### Login and signup

Login: "Sign in to your studio.", and under the form "Forgot your password?" (a 44 px link). Signup: "Set up your studio in a few minutes.", and "8 to 32 characters." under the password. The layout's side panel: "Inquiries, quotes and deposits for your studio, in one place." / "Tattoo Drip turns your booking link into complete inquiries, then helps you quote, take the deposit and book the session."

## Emails

All four in the shared layout, HTML plus text, "Hello,", no name, no secret in the subject (`#modules/identity/emails/`, templates `identity::emails/<name>` and `<name>_text`).

| Mail | Subject | Body |
|---|---|---|
| `VerifyEmailMail({ to, url })` | Confirm your email address | Confirm that this is the email address of your Tattoo Drip account. The link works for 24 hours. [Confirm email address] (and the link written out). If you didn't create a Tattoo Drip account, ignore this email: nothing happens without the link. |
| `AccountExistsMail({ to, signInUrl, resetUrl })` | You already have a Tattoo Drip account | Someone tried to create a Tattoo Drip account with this email address, but it already has one. If it was you, sign in instead: [Sign in]. Forgot your password? Choose a new one with this link. It works for 1 hour: (link). If it wasn't you, ignore this email: your account hasn't changed. |
| `ResetPasswordMail({ to, url })` | Choose a new password | Someone asked to reset the password of your Tattoo Drip account. Choose a new one with this link. It works for 1 hour, once. [Choose a new password] (and the link). If you didn't ask, ignore this email: your password stays as it is. |
| `PasswordChangedMail({ to, changedAt, resetUrl })` | Your Tattoo Drip password was changed | The password of your Tattoo Drip account was changed on 19 Oct 2026 at 14:05 UTC, and every device that was signed in was signed out. If it was you, there's nothing to do. If it wasn't, choose a new password now and check who else can read this mailbox: [Choose a new password] (to `/forgot-password`). |

## Words

Flashes: "Password changed. Sign in with your new password.", "We sent a new link to {email}.", TAT-8's "Too many attempts. Try again in N minutes.". Everything else is in Screens and Emails above.

## Tests

- **Unit:** `canonicalEmail` (trim, ASCII case, dots and tags kept, other scripts kept, stable); account tokens (format, never twice, the route pattern, SHA-256 only, expiries, link paths); session identifiers (round trip, bare ids and malformed values refused, no version refused); the four mails (recipient, subject, no sender, layout, links escaped in HTML and as typed in text, no name); `changedAtText`; `emailCountKey` and `clearLoginFailures` (only the stored address's count goes).
- **Functional, tables:** the canonical check refuses upper case and spaces; the model stores canonical addresses and a case variant is the unique violation; new accounts start unconfirmed at version 1; the version check; `account_tokens` keys, purpose check, expiry check and cascade; the cleanup migration's SQL against a scratch table on the owner connection (refuses case-variant duplicates and changes nothing; canonicalises the rest the same way `canonicalEmail` does).
- **Functional, sessions:** login stores `<id>.<version>`; a session with an older version or a bare id is signed out; a fresh one works; a stale session sees the guest pages again.
- **Functional, services:** `AccountTokenService` (hash only, bound address, replacement per purpose, single use, expiry, purpose separation, altered tokens, revoke); `AccountService` (signup for a new and a taken address, confirmation once, a link to an address the account no longer has, `markVerified`, the reset request, a completed reset with all of ruling 13, a replay, expired and wrong-purpose tokens).
- **Functional, HTTP:** signup (new and taken addresses answer identically: status, location, flash keys, cookie names, signed out; the right email each; the sent page; 3 per address per hour; equal field errors); reset request (identical answers, an email only for a known address, both limits); the reset link (session only, headers, a signed-in visitor sent to `/dashboard`); the reset form (states, no token in the page, rules, success, replay, expired, altered and confirmation tokens, CSRF refused, the address's failures cleared and the locked account signing in again, the notice email); the confirmation link and page (states, the account it was sent to whoever is signed in, done, replay, expired, altered and reset tokens, CSRF refused, the link-route limit); the notice and resend (replacement, 1 a minute, 5 an hour, confirmed accounts sent on); the gate (onboarding refused while unconfirmed, allowed once confirmed, every studio page still open, the shared prop) and its route guard; page history (the new guest pages clear it, the confirmation pages don't); the multipart guard on the three new guest POSTs.
- **Functional, command:** `account:verify` confirms (and revokes the link), says "already", fails for an unknown address.
- **Not automated:** timing (ruling 6 and 11 argue it), how the pages and emails look (browser pass), a real SMTP provider.

## Browser pass (in the PR)

Mailpit isn't installed and nothing may be downloaded, so the worker sends to a throwaway SMTP sink on `127.0.0.1:1025` (a 40-line Node script in the plan, like TAT-52's), and no mail can leave the machine. Dev server on `PORT=3401`, worker with `APP_URL=http://localhost:3401 SMTP_HOST=127.0.0.1 SMTP_PORT=1025` on its command line. At 375 px and 1280 px, light and dark:

1. **Signup.** A throwaway address: "Check your email" with the address; the sink has "Confirm your email address", no name in it. Sign up again with the same address in upper case: the same page; the sink has "You already have a Tattoo Drip account".
2. **Confirm.** Open the confirmation link signed out: the page shows the address and no token in the URL; Confirm; "Email address confirmed"; Sign in; onboarding's form opens. Open the link again: "This link no longer works".
3. **Gate and banner.** Sign up a second address, sign in without confirming: `/onboarding` sends to "Confirm your email address"; "Send a new link" toasts and the sink gets a second email; a second click within a minute: "Too many attempts. Try again in 1 minute." Sign in as the QA account (an existing, unconfirmed owner): the bar on every studio page; "Send a new link", open the link signed in, Confirm, Continue: the bar is gone.
4. **Reset.** Login, "Forgot your password?", the first throwaway address: "Check your email"; an unknown address: the same page and nothing in the sink. Open the reset link: the form with the address; mismatched passwords: the error under the field; a 7-character password: refused; set one: "Password changed…" on the login page; the old password fails, the new one works; the sink has "Your Tattoo Drip password was changed". Open the reset link again: "This link no longer works".
5. **Sign-out everywhere.** Signed in to the throwaway account in a second browser context, complete a reset in the first: the second context's next click lands on the login page.
6. **Limits.** Four reset requests for one address: the fourth toasts "Too many attempts. Try again in 60 minutes."
7. **Keyboard and screen reader.** Tab through every new page; the field errors and toasts are announced; the banner's button is reachable.

## Docs

- `apps/platform/docs/backend.md`: a new "Accounts (TAT-18)" section (tokens, the session version, the gate, canonical emails, the command); the Rate limits bullets (new limits, the look-alike sentence corrected, the "Adding a limit" sentence now past tense); the Tenancy bullet (signup no longer lands on `/dashboard`; onboarding needs a confirmed address); the Page history bullet (the new guest pages, the confirmation page's exception, `/dashboard` for signed-in visitors).
- `apps/platform/docs/jobs-and-email.md`: an "Account emails (TAT-18)" bullet.
- `apps/platform/docs/testing.md`: an Accounts paragraph (unconfirmed users by default, `emailVerifiedAt` to pass the gate, `#tests/helpers/accounts`, sessions hold `<id>.<version>`, the link limit).
- `apps/platform/docs/ui.md`: the banner and the auth pages.
- `apps/platform/docs/deploy.md`: mail before signup works, `account:verify`, no access log for the two link paths, everyone signed out once at deploy, after-first-deploy checks.
- `apps/platform/database/README.md`: canonical emails and how to resolve the refusal; `account_tokens` as a second exception next to `rate_limits`.
- `apps/platform/.env.example`: account emails need working mail and ignore `ALERT_EMAILS`.
- `docs/requirements.md`: tick "Sign up with email and password, verify the email, log in and out, reset the password" and "Create a `studio` or `independent` tenant (needs a verified email)…", with the rules underneath.
- `docs/architecture.md`: the Domains, sessions, auth bullet; `docs/data-model.md`: `User` (confirmed address, session version) and `AccountToken`.
- `README.md`: a Deployment bullet for account email.

## Carry-forwards

Posted when the PR is ready (no Linear tickets were created in this run):

- **For the user, new tickets:** changing an account's email (confirm the new address with a `verify_email` token bound to it before switching, tell the old address, raise `session_version`); a Settings, Account page with "change password" and "sign out everywhere" (both raise `session_version`); the password rule (raise the 32-character maximum to at least 64, consider a breached-password check); pruning unconfirmed accounts that have no tenant after 30 days (or fold into TAT-42).
- **TAT-20:** the sending domain (SPF, DKIM, DMARC). Until it exists, new studios get in only through `account:verify`.
- **TAT-33:** accepting an invitation runs `middleware.verifiedEmail()` after `auth` (add its route to `NEEDS_CONFIRMED_EMAIL` in `tests/functional/identity/account_routes.spec.ts`); match the invitation to the account by `canonicalEmail`; an unconfirmed invitee lands on `/confirm-email` and comes back through the invitation link (no redirect parameter). If the invitation email itself should confirm the address, that is TAT-33's ruling: only for the exact canonical address it was sent to, and with a single-use token like these.
- **TAT-14:** the proxy's access log off for `/reset-password/` and `/verify-email/` (deploy.md), next to the deposit paths.
- **TAT-8 follow-up (optional):** with canonical emails a sign-in could clear its address's failure count; TAT-8's rule is kept here.
- **TAT-42:** account deletion removes the account's tokens (cascade); unconfirmed accounts are personal data too.

## Not in this ticket

Email change, change password while signed in, "sign out everywhere", 2FA, a password policy change, breached-password checks, pruning unconfirmed accounts, a magic-link sign-in, a switch to turn confirmation off, showing links in development, Nepali copy, any API, SDK or storefront change.

## Assumptions the user can overrule at review

Signup no longer signs in (one more step: confirm, then sign in); a taken address's email includes a reset link; links last 24 hours and 60 minutes; the limit numbers; a reset signs out every session and doesn't sign in; existing accounts start unconfirmed with the banner (the QA and development accounts included); ASCII-only case folding, no Gmail dot or plus folding; a confirmation link works whoever is signed in; no switch to skip confirmation, only `account:verify`; the guest layout's new words; no names in account emails; everyone signed out once at deploy; signed-in visitors of guest pages go to `/dashboard`.

## Verification

`PORT=3402 node ace test` passes on Node 24.3.0; `pnpm check`, `pnpm typecheck`, `pnpm build` and `node ace codegen` are clean; `database/schema.ts` changes only by `pnpm migrate`; the browser pass above. Then the whole-branch review and the Codex code and security reviews before the PR.
