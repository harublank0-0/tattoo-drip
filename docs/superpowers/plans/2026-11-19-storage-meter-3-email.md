# Storage Meter, Step 3 (The 95% Email) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email a studio's owners once when its storage first reaches 95% of its allowance, and again only after it has fallen below 90% and crossed again (`docs/superpowers/specs/2026-11-16-storage-meter-design.md`, "Email at 95%").

**Architecture:** The reservation (`reserveStorageFor`) already reads usage under the studio's advisory lock, so it notices the crossing: with enforcement on, when usage (with this upload, if it fits) is at or over 95% and the studio's marker `tenants.storage_alerted_at` is unset, it queues `StorageAlertJob { tenantId }` in its own committed transaction; when usage before the upload is under 90% and the marker is set, it clears it. The job (a `TenantJob`) re-reads usage, claims the marker with `update … where storage_alerted_at is null returning` and queues one `StorageNearlyFullMail` per live owner with `sendMailInTransaction` in that same transaction, so a rerun, a second job or concurrent uploads send once. A refused upload still records the crossing: the reservation decides inside its transaction and throws `StorageFullError` only after it commits.

**Tech stack:** AdonisJS 7, Lucid/PostgreSQL, `@adonisjs/queue` (TenantJob), `@adonisjs/mail` with Edge templates, Japa.

---

## Global Constraints

- **When:** only with `STORAGE_ENFORCEMENT=enforce` and a metered allowance. In observe mode nothing is queued or marked; a reservation that itself crosses 95% logs `logger.info({ tenantId, rule: "storage_alert", usedBytes, limitBytes }, "Package rule would email")`.
- **Mail off** (`ALERT_EMAILS=false`): the job still claims the marker (no repeated work) and logs "Storage alert email is off (ALERT_EMAILS=false)." with the tenant id; it sends nothing.
- **Recipients:** every live owner (`TenancyService.members`, role `owner`). Artists don't get it (the dashboard bar tells them).
- **Words:**
  - Subject: `${studioName}'s storage is nearly full`
  - Body: `${studioName} has used ${percent}% of its ${limitText} storage. When it's full, new uploads pause until there's room; existing files, bookings and deposits keep working.` and `Free up space or see what uses it under Settings, Billing, Storage.` with the button `See storage` (`APP_URL` + `/t/<slug>/settings/billing`). No client data.
- **The job re-checks:** enforcement still on and usage still at or over 95% (a delete may have freed space meanwhile); otherwise it does nothing.
- A crossing is noticed when a counted upload reserves. Always-accepted purposes reserve nothing, so they don't trigger it on their own; the next staff upload does.

## Review Focus

1. **One email per crossing:** two jobs, a rerun and concurrent reservations send one email per owner. *(Task 2 test.)*
2. **Rearming:** after usage falls under 90% and an upload reserves, the marker is clear, and the next crossing emails again. *(Task 2 test.)*
3. **A refused upload** at 96% still queues the alert. *(Task 1 test.)*

---

### Task 1: The marker and the crossing

**Files:**
- Create: `apps/platform/database/migrations/1792050000000_add_storage_alerted_at_to_tenants.ts` (`storage_alerted_at timestamptz null`), then migrate and keep the regenerated `database/schema.ts` (formatted).
- Modify: `apps/platform/app/modules/storage/reservations.ts`: decide inside the transaction, throw after it; read the marker with the studio-visible check; clear under 90%; queue the job at 95% (enforce) or log the crossing (observe).
- Create: `apps/platform/app/modules/storage/jobs/storage_alert_job.ts` (a stub `handle` first; Task 2 fills it).
- Test: `apps/platform/tests/functional/storage/storage_alert.spec.ts` (queue fake): a reservation that reaches 95% queues one job; one under 95% queues none; a refused upload at 96% queues one; observe mode queues none and logs; usage under 90% clears a set marker; a set marker queues nothing more.
- [ ] Red, implement, green (the new spec and the reservations spec), commit `feat(platform): notice when a studio's storage reaches 95%`.

### Task 2: The job and the email

**Files:**
- Create: `apps/platform/app/modules/notifications/emails/storage_nearly_full_mail.ts`, `storage_nearly_full.edge`, `storage_nearly_full_text.edge`.
- Fill: `StorageAlertJob.handle` (re-check, claim the marker, one mail per live owner in the same transaction, the mail-off log).
- Test (same spec): running the job twice queues one `SendMailJob` per owner with the subject and the Billing link; a job after usage fell under 95% sends none and leaves the marker unset; `ALERT_EMAILS=false` sets the marker and sends none; marker cleared under 90% then a new crossing sends again; artists get nothing.
- Modify: `tests/unit/jobs/job_classes.spec.ts` only if it lists TenantJobs.
- [ ] Red, implement, green, commit `feat(platform): email a studio's owners when its storage is nearly full`.

### Task 3: Docs

- `apps/platform/docs/jobs-and-email.md` (a bullet for the storage alert), `apps/platform/docs/deploy.md` (the email under the storage meter), `apps/platform/database/README.md` (the migration).
- [ ] Commit `docs(platform): the storage alert email`.
