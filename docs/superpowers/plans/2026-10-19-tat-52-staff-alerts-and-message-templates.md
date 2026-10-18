# Staff alerts and one-tap message templates (TAT-52) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new inquiry alerts the studio's owners, and the member linked to the artist the client asked for, once each: an email from the worker and an in-app alert behind a bell with the unread count. Every project page and every new inquiry offers one-tap WhatsApp and Viber messages (inquiry received, quote, deposit link, booking confirmation, session reminder, aftercare) from texts each studio edits in Settings, Messages, plus plain WhatsApp, Viber and Call links; every tap records the last contact with its channel and message. About 5 points.

**Architecture:** A new `app/modules/notifications/` module: pure `messages.ts` (kinds, placeholders, defaults, one-pass renderer, validation), `alerts.ts` (recipients, email copy, in-app lines), `chat.ts` and `project_messages.ts`; models `MessageTemplate` (`message_templates`) and `StaffAlert` (`staff_alerts`); `MessageTemplateService` (texts per studio, defaults in code) and `AlertService` (alerts once per member with the email queued in the same transaction through the new `#services/mail_in_transaction`); `NewInquiryMail`. TAT-64's `quoteMessage` and TAT-65's `depositMessage` render through the engine with byte-identical defaults. `tattoo_projects` and `inquiries` gain `last_contact_channel` and `last_contact_kind` (inquiries also `last_contacted_at`, freed in their guard trigger). Two settings routes, one inbox route and an `/alerts` group; a "Message the client" card on the project and inquiry pages; an Alerts link in the shell.

**Tech Stack:** AdonisJS 7, Lucid on PostgreSQL 18 with RLS, `@adonisjs/queue` (database driver), `@adonisjs/mail` with Edge templates, VineJS, Luxon, Japa; Inertia + React 19 + shadcn/ui + Tailwind v4; Tuyau `urlFor`.

**Spec:** `docs/superpowers/specs/2026-10-19-tat-52-staff-alerts-and-message-templates-design.md`. Read its Rulings first: they decide every open question.

## Global Constraints

- **Node 24.3.0.** Run every node and pnpm command with the pinned install first on PATH: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm …`. Every command below already carries it.
- `<repo>` is the checkout you build in (the coordinator decides: this worktree, `/home/blank/Coding/tattoo-drip-worktrees/tat-52`, or the main folder after a merge; say which in your report). `<scratchpad>` is your session's scratchpad directory. The shell's cwd resets between calls: every command uses `-C <repo>` or absolute paths.
- **Migrations (exact names):** `apps/platform/database/migrations/1791670000000_add_last_contact_to_projects_and_inquiries.ts`, `1791670000001_create_message_templates_table.ts`, `1791670000002_create_staff_alerts_table.ts`. Apply with `pnpm -C <repo>/apps/platform migrate` (owner role); it regenerates `database/schema.ts`, which you commit. They change the dev database the other checkouts share: say so in your report (a checkout without these three files can't run `pnpm migrate` until it has them; to undo, run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate:rollback` from this branch, which rolls back the batch Task 3 applied).
- **Routes (exact):** `GET /t/:tenant/settings/messages` `tenant.settings.messages` and `PUT /t/:tenant/settings/messages` `tenant.settings.messages.update` (settings group, `MessageTemplatesController.show` / `update`); `POST /t/:tenant/inbox/:id/contacted` `tenant.inbox.contacted.store` (inbox group, `InquiriesController.contacted`); a new `/alerts` group with `middleware.role({ allow: ["owner", "artist"] })`: `GET /t/:tenant/alerts` `tenant.alerts.index`, `POST /t/:tenant/alerts/read` `tenant.alerts.read`, `POST /t/:tenant/alerts/:id/open` `tenant.alerts.open` (`AlertsController.index` / `readAll` / `open`). The existing `POST /t/:tenant/projects/:id/contacted` keeps its name and takes optional `channel` and `kind`.
- **New setting:** `ALERT_EMAILS` (optional boolean; unset is on). `.env.test` sets `ALERT_EMAILS=true`; `.env.example` gets a commented line. Never read or edit `apps/platform/.env`.
- **Copy (verbatim).** Flashes: `Messages saved.`, `All alerts marked as read.`, `Marked as contacted.` (unchanged). Field errors: `Write the message, or reset it to the default.`, `Use at most 1,000 characters.`, `Remove the unsupported characters.`, `{x} can't be used here. This message can use {a}, {b}.`, `Keep {deposit_link}: it is the link the client pays on.`. Card: `Message the client`, `Message`, `Send on WhatsApp`, `Open Viber chat`, `Copy message`, `Message copied.`, `Couldn't copy: select the text instead.`, `Viber opens the chat empty: copy the message first, then paste it there.`, `Or open a chat without a message:`, `Open a chat with the client:`, `WhatsApp`, `Viber`, `Call`, `This client has no phone number to message.`. Settings: `Messages`, `Placeholders:`, `Preview with example details`, `Reset to default`, `Save messages`, `Saving…`. Alerts: `Alerts`, `Mark all as read`, ` (Unread)` (screen readers), `No alerts yet. New inquiries show up here.`, `New inquiry` / `Open it in the inbox.`, `A new inquiry asks for you` / `An owner reviews it in the inbox.`. Email: subject `New inquiry for {studio}`, title `New inquiry`, preheader `A new tattoo inquiry is waiting.`, `Open the inquiry`, `An owner of {studio} will review it in the inbox.`, `You get these emails as a member of {studio} on Tattoo Drip.`; boot warning `Staff alert emails are off (ALERT_EMAILS=false): new inquiries alert the dashboard only.`
- Fixture slugs in new tests end in `-52` (`alerts-52`, …): the tests share the dev database, where a slug someone once used stays taken. Tests added to an existing file keep that file's studio (`studioWithOwner()` is `black-needle`, "Black Needle").
- `@inject()` dependencies are value imports with `// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.`
- No `autoFocus`, no non-null assertions (`!`), no custom CSS classes (Tailwind utilities only), touch targets 44 px (`h-11`), nothing wider than 375 px.
- Tests: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts`. A spec importing a missing module or export hangs Japa, so RED steps run as `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test <suite> --files=<name>.spec.ts > <scratchpad>/red.log 2>&1; echo $?` (exit 124 plus "Cannot find module" or "does not provide an export" in the log is the expected RED; otherwise read the failing assertion). Read the log's `Tests` line, not the wrapper's exit code. Never `sh -c`, never read `apps/platform/.env`, never port 3333; the full suite takes about 2 minutes (run it in the background and wait for the notification). `pnpm typecheck` is the authority over editor diagnostics.
- Unset `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS`, `TRUST_PROXY` and `ALERT_EMAILS` in your shell before test runs (an exported value wins over `.env.test`).
- Never hand-edit `database/schema.ts` or `.adonisjs/`. After controller, route or page changes run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen` and commit `.adonisjs/`.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again, and keep Biome's import order.
- Commits: Conventional Commits with the `platform` scope (`docs` for Task 10), each ending with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (as a second `-m`). Never push, never open a PR.

## Review Focus

1. **One alert and one email per member per inquiry, however often the job runs.** A second run, a rerun after a crash and a rollback must leave exactly one alert per recipient and exactly one queued email per alert, the email only if its alert committed. Tests: Task 8 "a repeated run adds no alert and queues no second email", "an email is queued only with its alert: a rollback leaves neither"; "NewInquiryAlertJob alerts the owner through AlertService, once however often it runs".
2. **The right recipients, and nobody else.** Live owners; the preferred artist only through a live linked profile and a live membership; never a removed member, an unlinked or deleted profile, or another studio's user. Tests: Task 8 "a new inquiry alerts every live owner and the asked-for artist's member, once each", "a deleted, unlinked or foreign preferred artist alerts the owners only"; Task 8 unit `inquiryRecipients`.
3. **What leaves the platform.** The email holds the first name and 140 characters of the idea, never the phone, the email address, the budget or a last name; the subject has no client data; the in-app row stores ids only; the asked-for artist gets no inbox link. Tests: Task 8 "the email carries the first name and the start of the idea, never the phone, email, budget or last name", "the asked-for artist's email has no inbox link; an owner's links the inquiry"; `NewInquiryMail` unit tests.
4. **Placeholders can't be injected and TAT-64/65 output doesn't move.** One pass, values never re-read, unknown names refused on save; the default quote and deposit messages are byte-identical (the existing `quotes.spec.ts`, `deposit_links.spec.ts`, `project_page.spec.ts` and `deposit_links_http.spec.ts` assertions, untouched). Tests: Task 1 "a value is never read again as a placeholder", Task 2 "a client's name is never read as a placeholder", Task 1 `templateProblem` group.
5. **Links only from the stored phone.** wa.me and Viber addresses come from `clients.phone`; the text is only ever percent-encoded into the query. Tests: Task 6 `chat.spec.ts`.
6. **The inquiry guard frees exactly three columns.** Everything submitted stays frozen; the scrub stays one-shot. Tests: Task 3 "the last contact is free to change; everything submitted stays frozen" plus the existing guard tests unchanged; `guard_search_path.spec.ts` unchanged.
7. **Authorization and isolation of every new route.** Settings and inbox routes owners only; a member opens and reads only their own alerts (another member's id in the same studio is a 404); an artist records contact only on their own project. Tests: the six `cases.ts` entries, Task 9 "another member's alert is a 404 and stays unread", Task 4 "artists get a 404 on the page and the save", Task 5 "the inquiry's chat links record the contact; artists get a 404".

---

## Task 0: Preconditions (stop if any fails)

- [ ] **Step 1: Node and checkout**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` → `v24.3.0`.
Run: `git -C <repo> branch --show-current` → `harublank00/tat-52-staff-new-inquiry-alerts-one-tap-whatsappviber-message`; `git -C <repo> status -sb` → clean; `git -C <repo> log --oneline -1 -- docs/superpowers/plans/2026-10-19-tat-52-staff-alerts-and-message-templates.md` → the design commit "docs(platform): spec and plan for TAT-52 staff alerts and message templates".

- [ ] **Step 2: The base holds the built chain**

Run: `git -C <repo> merge-base --is-ancestor e2b3c1d HEAD && echo chain-ok` → `chain-ok` (the whole chain's tip: TAT-24 to TAT-66, 12, 23, 38, 44, 48, 55, 57, 9, 85, 65b). **If it prints nothing, STOP** and ask the coordinator.

- [ ] **Step 3: The names this plan edits exist**

Each command must print at least one line:

```
git -C <repo> grep -n 'logger.info({ tenantId, inquiryId }, "New inquiry received.");' -- apps/platform/app/modules/inquiries/jobs/new_inquiry_alert_job.ts
git -C <repo> grep -n "export function quoteMessage({" -- apps/platform/app/modules/projects/quotes.ts
git -C <repo> grep -n "export function depositMessage({" -- apps/platform/app/modules/payments/deposit_links.ts
git -C <repo> grep -n "export function chatLinks(" -- apps/platform/app/modules/clients/contact_links.ts
git -C <repo> grep -n "async markContacted(" -- apps/platform/app/modules/projects/services/project_service.ts
git -C <repo> grep -n "async createFromInquiry(" -- apps/platform/app/modules/projects/services/project_service.ts
git -C <repo> grep -n "export function contactedText(" -- apps/platform/app/modules/projects/contact.ts
git -C <repo> grep -n "free text\[\] := array\['status', 'decided_at', 'deleted_at', 'updated_at', 'anonymized_at'\];" -- apps/platform/database/migrations/1791590000001_create_inquiries_table.ts
git -C <repo> grep -n 'deposit_outcomes: \["tenant_isolation:ALL"\],' -- apps/platform/tests/functional/rls/catalog_guard.spec.ts
git -C <repo> grep -n '{ area: "sessions", allow: \["owner", "artist"\] },' -- apps/platform/tests/functional/tenancy/tenant_routes.spec.ts
git -C <repo> grep -n "session: scheduled.session," -- apps/platform/tests/helpers/tenants.ts
git -C <repo> grep -n '| "newInquiry"' -- apps/platform/tests/isolation/cases.ts
git -C <repo> grep -n "proofCount: ctx.inertia.always(proofCount)," -- apps/platform/app/middleware/inertia_middleware.ts
git -C <repo> grep -n "^function ChatMessage({" -- apps/platform/inertia/pages/projects/show.tsx
git -C <repo> grep -n "messageProps(live, client.name, client.phone, tenant.name, timezone)" -- apps/platform/app/controllers/projects_controller.ts
git -C <repo> grep -n "private async depositPanel(" -- apps/platform/app/controllers/projects_controller.ts
git -C <repo> grep -n 'edge.mount("identity"' -- apps/platform/start/view.ts
git -C <repo> grep -n 'label: "Artists",' -- apps/platform/inertia/layouts/settings.tsx
git -C <repo> grep -n "<AccountMenu />" -- apps/platform/inertia/components/shell/top_bar.tsx
git -C <repo> grep -n "<AccountMenu showName />" -- apps/platform/inertia/components/shell/side_nav.tsx
git -C <repo> grep -n "SMTP_PASSWORD: Env.schema.string.optional()," -- apps/platform/start/env.ts
git -C <repo> grep -n "The calendar: owners (the whole studio or one artist)" -- apps/platform/start/routes.ts
```

Each of these must print nothing:

```
git -C <repo> ls-files apps/platform/app/modules/notifications
git -C <repo> grep -n "ALERT_EMAILS\|staff_alerts\|message_templates\|last_contact_channel" -- apps/platform
git -C <repo> grep -n '"/alerts"\|"messages"' -- apps/platform/start/routes.ts
```

And `ls <repo>/apps/platform/database/migrations | tail -1` → `1791660000001_create_deposit_outcomes_table.ts`.

If a name moved (a later ticket renamed it), use the real one, keep the plan's behaviour and note the deviation in your report. If a "must print nothing" check prints something, STOP and report it.

- [ ] **Step 4: Install and environment**

If `<repo>/node_modules` is missing: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> install --frozen-lockfile`. Check the platform env file exists without reading it: `test -f <repo>/apps/platform/.env && echo env-ok` → `env-ok` (if not, ask the coordinator; never create or read it yourself). Check Postgres is up: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace migration:status --connection=owner` lists the migrations up to `1791660000001` as completed.

- [ ] **Step 5: Baseline**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=new_inquiry_alert_job.spec.ts --files=project_page.spec.ts --files=project_changes.spec.ts --files=inbox.spec.ts --files=inquiries_table.spec.ts --files=deposit_links_http.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=catalog_guard.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=quotes.spec.ts --files=deposit_links.spec.ts --files=moves.spec.ts --files=contact_links.spec.ts`. Expected: PASS. Then the full suite in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/baseline.log 2>&1`; record its `Tests` line (the final count must be 88 higher; Task 11 has the breakdown).

---

### Task 1: The message engine

**Files:**
- Create: `apps/platform/app/modules/notifications/messages.ts`
- Test: `apps/platform/tests/unit/modules/notifications/messages.spec.ts` (create)

**Interfaces:**
- Produces, from `#modules/notifications/messages` (no imports of its own): `MESSAGE_KINDS`, `type MessageKind`, `MESSAGE_LABELS`, `MESSAGE_OFFERED`, `PLACEHOLDERS`, `type Placeholder`, `PLACEHOLDER_HELP`, `KIND_PLACEHOLDERS`, `DEFAULT_TEMPLATES`, `MAX_TEMPLATE_LENGTH`, `type MessageValues`, `CONTACT_CHANNELS`, `type ContactChannel`, `CHANNEL_TEXT`, `type ContactVia`, `NO_VIA`; `firstName(name: string): string`, `renderMessage(kind: MessageKind, template: string, values: MessageValues): string`, `normalizeTemplate(text: string): string`, `templateProblem(kind: MessageKind, text: string): string | null`, `sampleValues(studio: { name: string; address: string | null }): Record<Placeholder, string>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/notifications/messages.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	DEFAULT_TEMPLATES,
	firstName,
	KIND_PLACEHOLDERS,
	MAX_TEMPLATE_LENGTH,
	MESSAGE_KINDS,
	normalizeTemplate,
	PLACEHOLDER_HELP,
	PLACEHOLDERS,
	renderMessage,
	sampleValues,
	templateProblem,
} from "#modules/notifications/messages";

const SAMPLE = sampleValues({
	name: "Black Needle",
	address: "Thamel, Kathmandu",
});

test.group("renderMessage", () => {
	test("fills each new default with its values", ({ assert }) => {
		assert.equal(
			renderMessage(
				"inquiry_received",
				DEFAULT_TEMPLATES.inquiry_received,
				SAMPLE,
			),
			"Hi Sita, thank you for your tattoo inquiry to Black Needle. We have your idea and will reply here soon.",
		);
		assert.equal(
			renderMessage(
				"booking_confirmation",
				DEFAULT_TEMPLATES.booking_confirmation,
				SAMPLE,
			),
			"Hi Sita, your session at Black Needle is booked for Mon 2 Nov 2026, 15:45–17:45 with Asha. Reply here if you need to change it.",
		);
		assert.equal(
			renderMessage(
				"session_reminder",
				DEFAULT_TEMPLATES.session_reminder,
				SAMPLE,
			),
			"Hi Sita, a reminder of your session at Black Needle on Mon 2 Nov 2026, 15:45–17:45 with Asha. See you soon!",
		);
		assert.match(
			renderMessage("aftercare", DEFAULT_TEMPLATES.aftercare, SAMPLE),
			/^Hi Sita, thank you for your tattoo at Black Needle! For the next two weeks: /,
		);
	});

	test("a value is never read again as a placeholder", ({ assert }) => {
		assert.equal(
			renderMessage("quote", "Hi {client_name}, {price}", {
				client_name: "{deposit_link} $& <b>",
				price: "NPR 1",
			}),
			"Hi {deposit_link} $& <b>, NPR 1",
		);
	});

	test("a name the kind doesn't use stays as typed", ({ assert }) => {
		assert.equal(
			renderMessage("quote", "{deposit_link} {price} {Price} {}", {
				price: "NPR 1",
				deposit_link: "https://x.test",
			}),
			"{deposit_link} NPR 1 {Price} {}",
		);
	});

	test("an empty value removes the placeholder and one space before it", ({
		assert,
	}) => {
		assert.equal(
			renderMessage(
				"booking_confirmation",
				"Hi {client_name}! See you {session_time}{studio_address} at {studio_address}.",
				{ client_name: "", session_time: "Mon" },
			),
			"Hi! See you Mon at.",
		);
		assert.equal(
			renderMessage("quote", "Hi {client_name}, here", {}),
			"Hi, here",
		);
	});

	test("line breaks and other scripts pass through", ({ assert }) => {
		assert.equal(
			renderMessage("aftercare", "नमस्ते {client_name}!\n{studio_name} 🙏", {
				client_name: "सीता",
				studio_name: "Black Needle",
			}),
			"नमस्ते सीता!\nBlack Needle 🙏",
		);
	});
});

test.group("templateProblem", () => {
	test("every default is a valid message", ({ assert }) => {
		for (const kind of MESSAGE_KINDS) {
			assert.isNull(templateProblem(kind, DEFAULT_TEMPLATES[kind]), kind);
		}
	});

	test("only the kind's own placeholders, and nothing else in braces", ({
		assert,
	}) => {
		assert.equal(
			templateProblem("inquiry_received", "Hi {client_name}, {price}"),
			"{price} can't be used here. This message can use {client_name}, {studio_name}.",
		);
		for (const typo of [
			"{client name}",
			"{Client_Name}",
			"{}",
			"{ client_name }",
		]) {
			assert.match(
				templateProblem("aftercare", `Hi ${typo}`) ?? "",
				/can't be used here/,
				typo,
			);
		}
		assert.isNull(
			templateProblem(
				"session_reminder",
				"{client_name} {studio_name} {artist_name} {session_time} {studio_address}",
			),
		);
	});

	test("the deposit link message keeps its link", ({ assert }) => {
		assert.equal(
			templateProblem("deposit_link", "Hi {client_name}, pay {amount}."),
			"Keep {deposit_link}: it is the link the client pays on.",
		);
		assert.isNull(templateProblem("deposit_link", "Pay here: {deposit_link}"));
	});

	test("1 to 1,000 characters once trimmed, a line ending counted once", ({
		assert,
	}) => {
		assert.equal(
			templateProblem("aftercare", "   \r\n  "),
			"Write the message, or reset it to the default.",
		);
		assert.isNull(templateProblem("aftercare", "x".repeat(MAX_TEMPLATE_LENGTH)));
		assert.equal(
			templateProblem("aftercare", "x".repeat(MAX_TEMPLATE_LENGTH + 1)),
			"Use at most 1,000 characters.",
		);
		// 500 lines typed in a browser arrive with \r\n: 999 characters stored.
		assert.isNull(
			templateProblem("aftercare", Array(500).fill("x").join("\r\n")),
		);
		// An emoji is one character, as Postgres counts it.
		assert.isNull(templateProblem("aftercare", "🙏".repeat(MAX_TEMPLATE_LENGTH)));
	});

	test("refuses NUL", ({ assert }) => {
		assert.equal(
			templateProblem("aftercare", "Hi\u0000"),
			"Remove the unsupported characters.",
		);
	});
});

test.group("message helpers", () => {
	test("normalizeTemplate stores \\n line endings, trimmed", ({ assert }) => {
		assert.equal(
			normalizeTemplate("  Hi\r\nthere\rnow\n "),
			"Hi\nthere\nnow",
		);
	});

	test("firstName is the first word, or nothing", ({ assert }) => {
		assert.equal(firstName("  Sita   Rai "), "Sita");
		assert.equal(firstName("   "), "");
		assert.equal(firstName("सीता राई"), "सीता");
	});

	test("every placeholder is explained and used by some message", ({
		assert,
	}) => {
		const used = new Set(
			MESSAGE_KINDS.flatMap((kind) => KIND_PLACEHOLDERS[kind]),
		);
		assert.deepEqual([...used].sort(), [...PLACEHOLDERS].sort());
		for (const name of PLACEHOLDERS) assert.isString(PLACEHOLDER_HELP[name]);
	});

	test("sample values use the studio's own name and address", ({ assert }) => {
		assert.equal(SAMPLE.studio_name, "Black Needle");
		assert.equal(SAMPLE.studio_address, "Thamel, Kathmandu");
		assert.equal(sampleValues({ name: "X", address: null }).studio_address, "");
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=messages.spec.ts > <scratchpad>/red.log 2>&1; echo $?`
Expected: `124`, and the log says `Cannot find module` for `#modules/notifications/messages`.

- [ ] **Step 3: Write the engine**

Create `apps/platform/app/modules/notifications/messages.ts`:

```ts
/**
 * The messages staff send clients with one tap (TAT-52): the six kinds,
 * their placeholders, the default texts and the one renderer, plus how a
 * contact was made. No imports, so any module can use it: projects and
 * payments render their messages with it, and the dashboard restates
 * `renderMessage` for the settings page's live preview
 * (inertia/components/messages.ts; a unit test runs both on the same cases).
 */

/** The six messages, in the order a project meets them. */
export const MESSAGE_KINDS = [
	"inquiry_received",
	"quote",
	"deposit_link",
	"booking_confirmation",
	"session_reminder",
	"aftercare",
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** What each message is called on the dashboard. */
export const MESSAGE_LABELS: Record<MessageKind, string> = {
	inquiry_received: "Inquiry received",
	quote: "Quote",
	deposit_link: "Deposit link",
	booking_confirmation: "Booking confirmation",
	session_reminder: "Session reminder",
	aftercare: "Aftercare",
};

/** Where the dashboard offers each message, as the settings page says it. */
export const MESSAGE_OFFERED: Record<MessageKind, string> = {
	inquiry_received: "Offered on a new inquiry, and on a project under review.",
	quote: "Offered under the quote while the client's answer is awaited.",
	deposit_link:
		"Offered with the deposit link, to owners, while the deposit is due.",
	booking_confirmation: "Offered on a project with a session coming up.",
	session_reminder: "Offered on a project with a session coming up.",
	aftercare: "Offered once a tattoo or touch-up session is done.",
};

/** Every placeholder a message can hold. */
export const PLACEHOLDERS = [
	"client_name",
	"studio_name",
	"artist_name",
	"price",
	"deposit_note",
	"valid_until",
	"amount",
	"reference_code",
	"deposit_link",
	"session_time",
	"studio_address",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** What each placeholder becomes, for the settings page. */
export const PLACEHOLDER_HELP: Record<Placeholder, string> = {
	client_name: "the client's first name",
	studio_name: "your studio's name",
	artist_name: "the artist's name",
	price: "the quoted price",
	deposit_note: "the deposit sentence, such as “Deposit: NPR 3,000.”",
	valid_until: "the quote's last day",
	amount: "the deposit still due",
	reference_code: "the code for the payment remark",
	deposit_link: "the deposit page link",
	session_time: "the session's day and time",
	studio_address:
		"your address from the studio profile (empty if you have none)",
};

/** The placeholders each message may use (spec ruling 16). */
export const KIND_PLACEHOLDERS: Record<MessageKind, readonly Placeholder[]> = {
	inquiry_received: ["client_name", "studio_name"],
	quote: ["client_name", "studio_name", "price", "deposit_note", "valid_until"],
	deposit_link: [
		"client_name",
		"studio_name",
		"amount",
		"reference_code",
		"deposit_link",
	],
	booking_confirmation: [
		"client_name",
		"studio_name",
		"artist_name",
		"session_time",
		"studio_address",
	],
	session_reminder: [
		"client_name",
		"studio_name",
		"artist_name",
		"session_time",
		"studio_address",
	],
	aftercare: ["client_name", "studio_name", "artist_name"],
};

/**
 * What a studio sends until it writes its own (Settings, Messages). The
 * quote and the deposit link are TAT-64's and TAT-65's messages word for
 * word: their tests pin that a studio which never edited them sends what it
 * sent before.
 */
export const DEFAULT_TEMPLATES: Record<MessageKind, string> = {
	inquiry_received:
		"Hi {client_name}, thank you for your tattoo inquiry to {studio_name}. We have your idea and will reply here soon.",
	quote:
		"Hi {client_name}, here is your quote from {studio_name}: {price}. {deposit_note} Valid until {valid_until}. Reply here to confirm.",
	deposit_link:
		"Hi {client_name}, please pay your deposit of {amount} to {studio_name}. Write {reference_code} in the payment remark, then send a screenshot of the payment on this page:\n{deposit_link}",
	booking_confirmation:
		"Hi {client_name}, your session at {studio_name} is booked for {session_time} with {artist_name}. Reply here if you need to change it.",
	session_reminder:
		"Hi {client_name}, a reminder of your session at {studio_name} on {session_time} with {artist_name}. See you soon!",
	aftercare:
		"Hi {client_name}, thank you for your tattoo at {studio_name}! For the next two weeks: wash it gently with clean water and mild soap and pat it dry, put on a thin layer of aftercare cream, don't scratch or pick it, and keep it out of the sun, pools and the sea. Message us here if anything worries you.",
};

/** A message's longest text, in characters (the column is varchar(1000)). */
export const MAX_TEMPLATE_LENGTH = 1000;

/** The placeholders' values; a missing or empty one removes its placeholder. */
export type MessageValues = Partial<Record<Placeholder, string>>;

/** How staff reached a client: the link or button they tapped (TAT-52). */
export const CONTACT_CHANNELS = ["whatsapp", "viber", "call", "copy"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** The channel in "contacted today on WhatsApp". */
export const CHANNEL_TEXT: Record<ContactChannel, string> = {
	whatsapp: "on WhatsApp",
	viber: "on Viber",
	call: "by phone",
	copy: "with a copied message",
};

/** What a last contact records besides its time; both null for "Mark contacted". */
export type ContactVia = {
	channel: ContactChannel | null;
	kind: MessageKind | null;
};
export const NO_VIA: ContactVia = { channel: null, kind: null };

/** `{name}`, with the one space before it that an empty value takes along. */
const PLACEHOLDER = /( ?)\{([a-z_]+)\}/g;
/** Anything in braces: on save, each must be one of the kind's placeholders. */
const BRACED = /\{([^{}]*)\}/g;

/** The first word of a name, for "Hi Sita"; "" for a blank name. */
export function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] ?? "";
}

/**
 * `template` with each of `kind`'s placeholders replaced by its value, in
 * one pass: a value is never read again, so a client named "{deposit_link}"
 * keeps that name. A name `kind` doesn't use stays as typed. An empty or
 * missing value removes the placeholder and one space before it, so
 * "Hi {client_name}," reads "Hi," without a name (TAT-64's behaviour).
 */
export function renderMessage(
	kind: MessageKind,
	template: string,
	values: MessageValues,
): string {
	const allowed: readonly string[] = KIND_PLACEHOLDERS[kind];
	return template.replace(
		PLACEHOLDER,
		(match: string, space: string, name: string) => {
			if (!allowed.includes(name)) return match;
			const value = values[name as Placeholder] ?? "";
			return value === "" ? "" : `${space}${value}`;
		},
	);
}

/** A typed text as it is stored: "\n" line endings, trimmed. */
export function normalizeTemplate(text: string): string {
	return text.replace(/\r\n?/g, "\n").trim();
}

/**
 * Why `text` can't be `kind`'s message, for its field error; null when it
 * can (spec ruling 20). Lengths count characters as Postgres does (code
 * points), after normalizeTemplate.
 */
export function templateProblem(
	kind: MessageKind,
	text: string,
): string | null {
	const body = normalizeTemplate(text);
	if (body.includes("\u0000")) return "Remove the unsupported characters.";
	if (body === "") return "Write the message, or reset it to the default.";
	if (Array.from(body).length > MAX_TEMPLATE_LENGTH) {
		return "Use at most 1,000 characters.";
	}
	const allowed: readonly string[] = KIND_PLACEHOLDERS[kind];
	for (const [braced, name] of body.matchAll(BRACED)) {
		if (!allowed.includes(name ?? "")) {
			const list = allowed.map((placeholder) => `{${placeholder}}`).join(", ");
			return `${braced} can't be used here. This message can use ${list}.`;
		}
	}
	if (kind === "deposit_link" && !body.includes("{deposit_link}")) {
		return "Keep {deposit_link}: it is the link the client pays on.";
	}
	return null;
}

/**
 * Example values for the settings page's preview: the studio's own name and
 * address, made-up details for the rest.
 */
export function sampleValues(studio: {
	name: string;
	address: string | null;
}): Record<Placeholder, string> {
	return {
		client_name: "Sita",
		studio_name: studio.name,
		artist_name: "Asha",
		price: "NPR 15,000",
		deposit_note: "Deposit: NPR 3,000.",
		valid_until: "28 Oct 2026",
		amount: "NPR 3,000",
		reference_code: "7K3M9Q",
		deposit_link: "https://your-studio.example/deposit#example",
		session_time: "Mon 2 Nov 2026, 15:45–17:45",
		studio_address: studio.address ?? "",
	};
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=messages.spec.ts`
Expected: PASS, 14 tests. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/notifications/messages.ts apps/platform/tests/unit/modules/notifications/messages.spec.ts
git -C <repo> add apps/platform/app/modules/notifications/messages.ts apps/platform/tests/unit/modules/notifications/messages.spec.ts
git -C <repo> commit -m "feat(platform): add the chat message kinds, placeholders and renderer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The quote and deposit messages through the templates

**Files:**
- Modify: `apps/platform/app/modules/projects/quotes.ts` (`quoteMessage`)
- Modify: `apps/platform/app/modules/payments/deposit_links.ts` (`depositMessage`)
- Test: `apps/platform/tests/unit/modules/projects/quotes.spec.ts`, `apps/platform/tests/unit/modules/payments/deposit_links.spec.ts` (add tests; the existing ones stay unchanged: they are the pins)

**Interfaces:**
- `quoteMessage(input: QuoteMessageInput, template: string = DEFAULT_TEMPLATES.quote): string` and `depositMessage(input: DepositMessageInput, template: string = DEFAULT_TEMPLATES.deposit_link): string`: the same inputs and, without `template`, the same output as before.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/unit/modules/projects/quotes.spec.ts`, inside `test.group("quoteMessage", () => { … })`, after the test "greets a client with no name plainly", add:

```ts
	test("a studio's own text gets the same values", ({ assert }) => {
		assert.equal(
			quoteMessage(
				{
					clientName: "Sita Rai",
					studioName: "Ink House",
					quote: { ...fixed, depositAmount: 300_000, expiresAt },
					timezone: KTM,
				},
				"Namaste {client_name} ji! {studio_name}: {price}. {deposit_note} Until {valid_until}.",
			),
			"Namaste Sita ji! Ink House: NPR 15,000. Deposit: NPR 3,000. Until 28 Oct 2026.",
		);
	});

	test("a client's name is never read as a placeholder", ({ assert }) => {
		const text = quoteMessage({
			clientName: "{price} Rai",
			studioName: "Ink House",
			quote: { ...fixed, depositAmount: 0, expiresAt },
			timezone: KTM,
		});
		assert.isTrue(
			text.startsWith(
				"Hi {price}, here is your quote from Ink House: NPR 15,000.",
			),
			text,
		);
	});
```

In `apps/platform/tests/unit/modules/payments/deposit_links.spec.ts`, inside `test.group("depositMessage", () => { … })`, after the test "without a name it says Hi", add:

```ts
	test("a studio's own text, with the link exactly as given", ({ assert }) => {
		assert.equal(
			depositMessage(
				input,
				"{client_name}: {amount} to {studio_name}, code {reference_code}. {deposit_link}",
			),
			`Sita: NPR 3,000 to Black Needle, code 7K3M9Q. https://black-needle.tattoodrip.app/deposit#${TOKEN}`,
		);
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=quotes.spec.ts --files=deposit_links.spec.ts`
Expected: FAIL in the two "studio's own text" tests (the second argument is ignored today); the name test passes already (TAT-64 never re-read values) and stays as a pin.

- [ ] **Step 3: Render the quote through the engine**

In `apps/platform/app/modules/projects/quotes.ts`, add to the imports (Biome orders them):

```ts
import {
	DEFAULT_TEMPLATES,
	firstName,
	renderMessage,
} from "#modules/notifications/messages";
```

and replace the doc comment and body of `quoteMessage` (from `/**\n * The quote as a chat message to the client, in English. TAT-52 turns the` to the function's closing brace) with:

```ts
/**
 * The quote as a chat message to the client: the studio's own text
 * (`template`, Settings, Messages; TAT-52), or the default, which is
 * TAT-64's original message word for word.
 */
export function quoteMessage(
	{ clientName, studioName, quote, timezone }: QuoteMessageInput,
	template: string = DEFAULT_TEMPLATES.quote,
): string {
	const total = formatMoney(quoteTotal(quote));
	return renderMessage("quote", template, {
		client_name: firstName(clientName),
		studio_name: studioName,
		price: quote.kind === "fixed" ? total : `${priceText(quote)} ≈ ${total}`,
		deposit_note:
			quote.depositAmount === 0
				? "No deposit needed."
				: `Deposit: ${formatMoney(quote.depositAmount)}.`,
		valid_until: formatDay(validUntil(quote.expiresAt, timezone)),
	});
}
```

- [ ] **Step 4: Render the deposit link message through the engine**

In `apps/platform/app/modules/payments/deposit_links.ts`, add to the imports:

```ts
import {
	DEFAULT_TEMPLATES,
	firstName,
	renderMessage,
} from "#modules/notifications/messages";
```

and replace the doc comment and body of `depositMessage` (from `/**\n * The deposit link as a chat message to the client, in English, the link` to its closing brace) with:

```ts
/**
 * The deposit link as a chat message to the client: the studio's own text
 * (`template`, which must keep {deposit_link}; TAT-52), or the default,
 * TAT-65's original message with the link last and on its own line so
 * every chat app makes it tappable.
 */
export function depositMessage(
	{ clientName, studioName, dueText, referenceCode, url }: DepositMessageInput,
	template: string = DEFAULT_TEMPLATES.deposit_link,
): string {
	return renderMessage("deposit_link", template, {
		client_name: firstName(clientName),
		studio_name: studioName,
		amount: dueText,
		reference_code: referenceCode,
		deposit_link: url,
	});
}
```

- [ ] **Step 5: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=quotes.spec.ts --files=deposit_links.spec.ts`
Expected: PASS, every old test unchanged plus the 3 new ones. Then the pages that pin the output: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts --files=deposit_links_http.spec.ts` → PASS unchanged. Then `typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/projects/quotes.ts apps/platform/app/modules/payments/deposit_links.ts apps/platform/tests/unit/modules/projects/quotes.spec.ts apps/platform/tests/unit/modules/payments/deposit_links.spec.ts
git -C <repo> add apps/platform/app/modules/projects/quotes.ts apps/platform/app/modules/payments/deposit_links.ts apps/platform/tests/unit/modules/projects/quotes.spec.ts apps/platform/tests/unit/modules/payments/deposit_links.spec.ts
git -C <repo> commit -m "feat(platform): render the quote and deposit messages from editable templates" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The schema: last contact, message templates, staff alerts

**Files:**
- Create: `apps/platform/database/migrations/1791670000000_add_last_contact_to_projects_and_inquiries.ts`
- Create: `apps/platform/database/migrations/1791670000001_create_message_templates_table.ts`
- Create: `apps/platform/database/migrations/1791670000002_create_staff_alerts_table.ts`
- Create: `apps/platform/app/modules/notifications/models/message_template.ts`, `apps/platform/app/modules/notifications/models/staff_alert.ts`
- Create: `apps/platform/app/modules/notifications/alerts.ts` (only `ALERT_KINDS` and `AlertKind` here; Task 8 fills it)
- Modify: `apps/platform/app/modules/inquiries/models/inquiry.ts`, `apps/platform/app/modules/projects/models/tattoo_project.ts`
- Modify: `apps/platform/tests/functional/rls/catalog_guard.spec.ts` (`EXPECTED_POLICIES`)
- Regenerated: `apps/platform/database/schema.ts` (by `pnpm migrate`)
- Test: `apps/platform/tests/functional/inquiries/inquiries_table.spec.ts`, `apps/platform/tests/functional/projects/tattoo_projects_table.spec.ts` (add tests), `apps/platform/tests/functional/notifications/message_templates_table.spec.ts`, `apps/platform/tests/functional/notifications/staff_alerts_table.spec.ts` (create)

**Interfaces:**
- `Inquiry` and `TattooProject` gain `lastContactChannel: ContactChannel | null` and `lastContactKind: MessageKind | null`; `Inquiry` gains `lastContactedAt: DateTime | null` (the generated schema).
- `MessageTemplate` (`tenantId`, `kind: MessageKind`, `body`, `createdAt`, `updatedAt`) and `StaffAlert` (`tenantId`, `userId`, `kind: AlertKind`, `inquiryId: string | null`, `readAt: DateTime | null`, `createdAt`), from `#modules/notifications/models/message_template` and `#modules/notifications/models/staff_alert`.
- `ALERT_KINDS = ["new_inquiry"] as const`, `type AlertKind` from `#modules/notifications/alerts`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/inquiries/inquiries_table.spec.ts`, after the test "the decision, deletion and updated_at are free to change", add:

```ts
	test("the last contact is free to change; everything submitted stays frozen", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();

		await withDbContext({ tenantId: a.id }, async (trx) => {
			const id = idOf(
				await insertRow(trx, "inquiries", newInquiry(a.id, clientA.id)),
			);

			await updateRow(trx, "inquiries", id, {
				last_contacted_at: new Date(),
				last_contact_channel: "whatsapp",
				last_contact_kind: "inquiry_received",
			});
			await updateRow(trx, "inquiries", id, {
				last_contacted_at: new Date(),
				last_contact_channel: null,
				last_contact_kind: null,
			});
			const { rows } = await trx.rawQuery(
				"select last_contacted_at, last_contact_channel from inquiries where id = ?",
				[id],
			);
			assert.isNotNull(rows[0].last_contacted_at);
			assert.isNull(rows[0].last_contact_channel);
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						updateRow(inner, "inquiries", id, {
							last_contacted_at: new Date(),
							idea: "Another idea",
						}),
					),
				/inquiries_guard_update: idea cannot change/,
			);
		});
	});

	test("a last contact's channel and message take listed values and need its time", async ({
		assert,
	}) => {
		const { a, clientA } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "inquiries", newInquiry(a.id, clientA.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async () => {
			await rejects(
				{ last_contacted_at: new Date(), last_contact_channel: "sms" },
				/inquiries_last_contact_channel_check/,
			);
			await rejects(
				{ last_contacted_at: new Date(), last_contact_kind: "hello" },
				/inquiries_last_contact_kind_check/,
			);
			await rejects(
				{ last_contact_channel: "viber" },
				/inquiries_last_contact_needs_time/,
			);
		});
	});
```

In `apps/platform/tests/functional/projects/tattoo_projects_table.spec.ts`, after the test "status only takes its listed values", add:

```ts
	test("a last contact's channel and message take listed values and need its time", async ({
		assert,
	}) => {
		const { a, mine } = await twoTenants();
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(
							inner,
							"tattoo_projects",
							newProject(a.id, mine.client.id, over),
						),
					),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(
				{ last_contacted_at: new Date(), last_contact_channel: "sms" },
				/tattoo_projects_last_contact_channel_check/,
			);
			await rejects(
				{ last_contacted_at: new Date(), last_contact_kind: "hello" },
				/tattoo_projects_last_contact_kind_check/,
			);
			await rejects(
				{ last_contact_kind: "quote" },
				/tattoo_projects_last_contact_needs_time/,
			);
			await insertRow(
				trx,
				"tattoo_projects",
				newProject(a.id, mine.client.id, {
					last_contacted_at: new Date(),
					last_contact_channel: "copy",
					last_contact_kind: "deposit_link",
				}),
			);
		});
	});
```

Create `apps/platform/tests/functional/notifications/message_templates_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { MESSAGE_KINDS } from "#modules/notifications/messages";
import { withDbContext, withTransaction } from "#services/db_context";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow } from "#tests/helpers/sql";
import { studioWithOwner } from "#tests/helpers/tenants";

const row = (tenantId: string, over: Record<string, unknown> = {}) => ({
	tenant_id: tenantId,
	kind: "quote",
	body: "Hi {client_name}",
	...over,
});

test.group("message_templates table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		// A different kind each time: a studio has one row per kind.
		let next = 0;
		await assertRowLevelSecurity(assert, "message_templates", async (tenant) =>
			row(tenant.id, { kind: MESSAGE_KINDS[next++ % MESSAGE_KINDS.length] }),
		);
	});

	test("one text per message kind per studio", async ({ assert }) => {
		const { tenant } = await studioWithOwner("templates-52");

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await insertRow(trx, "message_templates", row(tenant.id));
			await assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "message_templates", row(tenant.id)),
					),
				/message_templates_tenant_id_kind_unique/,
			);
			await insertRow(
				trx,
				"message_templates",
				row(tenant.id, { kind: "aftercare" }),
			);
		});
	});

	test("the kind is one of the six, and the text 1 to 1,000 characters", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("templates-check-52");
		const rejects = (over: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) =>
						insertRow(inner, "message_templates", row(tenant.id, over)),
					),
				message,
			);

		await withDbContext({ tenantId: tenant.id }, async (trx) => {
			await rejects({ kind: "hello" }, /message_templates_kind_check/);
			await rejects({ body: "  " }, /message_templates_body_not_blank/);
			await rejects({ body: "x".repeat(1001) }, /value too long/);
			await insertRow(
				trx,
				"message_templates",
				row(tenant.id, { body: "🙏".repeat(1000) }),
			);
		});
	});
});
```

Create `apps/platform/tests/functional/notifications/staff_alerts_table.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import User from "#models/user";
import { withDbContext, withTransaction } from "#services/db_context";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { assertRowLevelSecurity } from "#tests/helpers/rls";
import { insertRow, sql } from "#tests/helpers/sql";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

let users = 0;
/** A user who receives alerts: staff_alerts points at users, not memberships. */
const member = () =>
	User.create({
		email: `alert-member-${++users}-52@example.com`,
		password: "secret-password",
	});

const inquiryIn = (tenant: { id: string }) =>
	inTenant(tenant, async () => makeInquiry(tenant, await makeClient(tenant)));

const alert = (
	tenantId: string,
	userId: string,
	inquiryId: string | null,
	over: Record<string, unknown> = {},
) => ({
	tenant_id: tenantId,
	user_id: userId,
	kind: "new_inquiry",
	inquiry_id: inquiryId,
	...over,
});

test.group("staff_alerts table", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("row-level security", async ({ assert }) => {
		await assertRowLevelSecurity(assert, "staff_alerts", async (tenant) =>
			alert(tenant.id, (await member()).id, (await inquiryIn(tenant)).id),
		);
	});

	test("an alert names an inquiry of its own studio, once per member", async ({
		assert,
	}) => {
		const { tenant: a, owner } = await studioWithOwner("alerts-a-52");
		const { tenant: b } = await studioWithOwner("alerts-b-52");
		const mine = await inquiryIn(a);
		const theirs = await inquiryIn(b);
		const rejects = (values: Record<string, unknown>, message: RegExp) =>
			assert.rejects(
				() =>
					withTransaction((inner) => insertRow(inner, "staff_alerts", values)),
				message,
			);

		await withDbContext({ tenantId: a.id }, async (trx) => {
			await rejects(
				alert(a.id, owner.id, theirs.id),
				/staff_alerts_tenant_id_inquiry_id_foreign/,
			);
			await rejects(
				alert(a.id, owner.id, null),
				/staff_alerts_subject_matches_kind/,
			);
			await rejects(
				alert(a.id, owner.id, mine.id, { kind: "hello" }),
				/staff_alerts_kind_check/,
			);
			await insertRow(trx, "staff_alerts", alert(a.id, owner.id, mine.id));
			await rejects(
				alert(a.id, owner.id, mine.id),
				/staff_alerts_user_id_inquiry_id_unique/,
			);
		});
	});

	test("deleting the member's account removes their alerts", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alerts-gone-52");
		const gone = await member();
		const inquiry = await inquiryIn(tenant);
		await withDbContext({ tenantId: tenant.id }, (trx) =>
			insertRow(trx, "staff_alerts", alert(tenant.id, gone.id, inquiry.id)),
		);

		await gone.delete();

		const { rows } = await sql(
			{ tenantId: tenant.id },
			"select count(*)::int as n from staff_alerts",
		);
		assert.equal(rows[0].n, 0);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=inquiries_table.spec.ts --files=tattoo_projects_table.spec.ts --files=message_templates_table.spec.ts --files=staff_alerts_table.spec.ts`
Expected: the 9 new tests FAIL (`column "last_contacted_at" of relation "inquiries" does not exist`, `column "last_contact_channel" … does not exist`, `relation "message_templates" does not exist`, `relation "staff_alerts" does not exist`); the old ones pass.

- [ ] **Step 3: The last-contact migration**

Create `apps/platform/database/migrations/1791670000000_add_last_contact_to_projects_and_inquiries.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";

/**
 * The channels and messages a last contact records (TAT-52). Copied from
 * #modules/notifications/messages, not imported: a migration must not
 * change when the app's lists do.
 */
const CHANNELS = ["whatsapp", "viber", "call", "copy"];
const KINDS = [
	"inquiry_received",
	"quote",
	"deposit_link",
	"booking_confirmation",
	"session_reminder",
	"aftercare",
];

/** TAT-37's free columns, and the three this migration frees as well. */
const FREE_TAT_37 = [
	"status",
	"decided_at",
	"deleted_at",
	"updated_at",
	"anonymized_at",
];
const LAST_CONTACT = [
	"last_contacted_at",
	"last_contact_channel",
	"last_contact_kind",
];

/**
 * inquiries_guard_update with `free` as its free columns. Otherwise TAT-37's
 * body verbatim: the pinned search_path, the fail-closed check and the
 * one-shot scrub.
 */
const guard = (free: string[]) => `
create or replace function inquiries_guard_update() returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
	free text[] := array[${free.map((column) => `'${column}'`).join(", ")}];
	scrub text[] := array['contact_name', 'contact_phone', 'contact_email', 'idea', 'placement', 'approximate_size', 'preferred_dates', 'budget'];
	changed text;
begin
	if old.anonymized_at is not null and new.anonymized_at is distinct from old.anonymized_at then
		raise exception 'inquiries_guard_update: anonymized_at cannot change';
	end if;
	-- The scrub columns are free only in the update that first sets the marker.
	if old.anonymized_at is null and new.anonymized_at is not null then
		free := free || scrub;
	end if;
	select n.key into changed
		from jsonb_each(to_jsonb(new)) as n(key, value)
		where n.key <> all (free) and n.value is distinct from (to_jsonb(old) -> n.key)
		limit 1;
	if changed is not null then
		raise exception 'inquiries_guard_update: % cannot change', changed;
	end if;
	return new;
end
$$`;

/**
 * When staff last contacted the client, on which channel and with which of
 * the studio's messages (TAT-52): on projects (which had the time since
 * TAT-37) and on inquiries, whose guard trigger frees exactly these three
 * columns; everything submitted stays frozen. Rolling back restores TAT-37's
 * guard first, then drops the columns (and the contacts recorded in them).
 */
export default class extends BaseSchema {
	async up() {
		this.schema.alterTable("inquiries", (table) => {
			table.timestamp("last_contacted_at", { useTz: true }).nullable();
		});
		for (const name of ["tattoo_projects", "inquiries"]) {
			this.schema.alterTable(name, (table) => {
				table.enum("last_contact_channel", CHANNELS).nullable();
				table.enum("last_contact_kind", KINDS).nullable();
			});
			this.schema.raw(
				`alter table ${name} add constraint ${name}_last_contact_needs_time check (last_contacted_at is not null or (last_contact_channel is null and last_contact_kind is null))`,
			);
		}
		this.schema.raw(guard([...FREE_TAT_37, ...LAST_CONTACT]));
	}

	async down() {
		this.schema.raw(guard(FREE_TAT_37));
		for (const name of ["tattoo_projects", "inquiries"]) {
			this.schema.raw(
				`alter table ${name} drop constraint ${name}_last_contact_needs_time`,
			);
			this.schema.alterTable(name, (table) => {
				table.dropColumn("last_contact_kind");
				table.dropColumn("last_contact_channel");
			});
		}
		this.schema.alterTable("inquiries", (table) => {
			table.dropColumn("last_contacted_at");
		});
	}
}
```

- [ ] **Step 4: The message templates migration**

Create `apps/platform/database/migrations/1791670000001_create_message_templates_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
} from "#database/helpers/tenant_rls";

/** The six message kinds (#modules/notifications/messages; copied). */
const KINDS = [
	"inquiry_received",
	"quote",
	"deposit_link",
	"booking_confirmation",
	"session_reminder",
	"aftercare",
];

/**
 * A studio's own text for one of its chat messages (TAT-52). A row exists
 * only for a message the studio changed: the defaults live in code, and
 * saving the default text again deletes the row. Not soft-deleted: a
 * setting replaced in place.
 */
export default class extends BaseSchema {
	protected tableName = "message_templates";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table.enum("kind", KINDS).notNullable();
			table.string("body", 1000).notNullable();

			table.timestamp("created_at", { useTz: true }).notNullable();
			table.timestamp("updated_at", { useTz: true }).nullable();

			// One text per kind; also the tenant_id index.
			table.unique(["tenant_id", "kind"]);
		});
		this.schema.raw(
			"alter table message_templates add constraint message_templates_body_not_blank check (btrim(body) <> '')",
		);
		for (const sql of enableTenantRls(this.tableName)) this.schema.raw(sql);
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

- [ ] **Step 5: The staff alerts migration**

Create `apps/platform/database/migrations/1791670000002_create_staff_alerts_table.ts`:

```ts
import { BaseSchema } from "@adonisjs/lucid/schema";
import {
	disableTenantRls,
	enableTenantRls,
	tenantReference,
} from "#database/helpers/tenant_rls";

/**
 * One member's alert about one event (TAT-52): a new inquiry so far (the
 * deposit-proof follow-up adds a kind and its columns). Ids only, never
 * client data; the list shows a fixed line per kind. Unique per member and
 * inquiry, so the alert job's `on conflict do nothing` makes a rerun add
 * nothing. Deleting the account removes its alerts; so does a hard delete
 * of the inquiry. Not soft-deleted: read or unread, and kept.
 */
export default class extends BaseSchema {
	protected tableName = "staff_alerts";

	async up() {
		this.schema.createTable(this.tableName, (table) => {
			table.uuid("id").primary().defaultTo(this.raw("uuidv7()"));
			table
				.uuid("tenant_id")
				.notNullable()
				.references("id")
				.inTable("tenants")
				.onDelete("CASCADE");
			table
				.uuid("user_id")
				.notNullable()
				.references("id")
				.inTable("users")
				.onDelete("CASCADE");
			table.enum("kind", ["new_inquiry"]).notNullable();
			table.uuid("inquiry_id").nullable();
			table.timestamp("read_at", { useTz: true }).nullable();
			table.timestamp("created_at", { useTz: true }).notNullable();

			tenantReference(table, "inquiry_id", "inquiries");

			// One alert per member per inquiry; also the user_id index.
			table.unique(["user_id", "inquiry_id"]);
			// The Alerts page: a member's alerts in a studio, newest first.
			table.index(["tenant_id", "user_id", "created_at"]);
			// The composite key's index.
			table.index(["tenant_id", "inquiry_id"]);
		});
		for (const statement of [
			"alter table staff_alerts add constraint staff_alerts_subject_matches_kind check ((kind = 'new_inquiry') = (inquiry_id is not null))",
			// The shell's unread count.
			"create index staff_alerts_unread_index on staff_alerts (tenant_id, user_id) where read_at is null",
			...enableTenantRls(this.tableName),
		]) {
			this.schema.raw(statement);
		}
	}

	async down() {
		for (const sql of disableTenantRls(this.tableName)) this.schema.raw(sql);
		this.schema.dropTable(this.tableName);
	}
}
```

- [ ] **Step 6: Migrate**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform migrate`
Expected: the three migrations run, and `git -C <repo> diff --stat -- apps/platform/database/schema.ts` shows `schema.ts` changed (new `MessageTemplateSchema` and `StaffAlertSchema`, `lastContactChannel` / `lastContactKind` on `InquirySchema` and `TattooProjectSchema`, `lastContactedAt` on `InquirySchema`). If the regenerated file also differs elsewhere, that is a sign the dev database holds another branch's migrations: STOP and report.

- [ ] **Step 7: Models**

Create `apps/platform/app/modules/notifications/alerts.ts` (Task 8 adds the rest):

```ts
/** What a staff alert is about (TAT-52). The deposit-proof alert is a follow-up (spec ruling 12). */
export const ALERT_KINDS = ["new_inquiry"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
```

Create `apps/platform/app/modules/notifications/models/message_template.ts`:

```ts
import { MessageTemplateSchema } from "#database/schema";
import type { MessageKind } from "#modules/notifications/messages";

/**
 * A studio's own text for one of its chat messages (TAT-52). A row exists
 * only for a message the studio changed; the default is DEFAULT_TEMPLATES,
 * and saving it again removes the row. Not soft-deleted. Read and save
 * through MessageTemplateService.
 */
export default class MessageTemplate extends MessageTemplateSchema {
	declare kind: MessageKind;
}
```

Create `apps/platform/app/modules/notifications/models/staff_alert.ts`:

```ts
import { StaffAlertSchema } from "#database/schema";
import type { AlertKind } from "#modules/notifications/alerts";

/**
 * One member's alert about one event (TAT-52): ids only, never client data
 * (the list shows a fixed line per kind). Not soft-deleted. Made and read
 * through AlertService.
 */
export default class StaffAlert extends StaffAlertSchema {
	declare kind: AlertKind;
}
```

In `apps/platform/app/modules/inquiries/models/inquiry.ts`, add the import:

```ts
import type {
	ContactChannel,
	MessageKind,
} from "#modules/notifications/messages";
```

replace the class doc comment's first sentence "A database\n * trigger freezes everything except the decision (and the privacy scrub, only\n * in the update that first sets `anonymizedAt`), so do not try to edit the\n * submitted fields." with "A database\n * trigger freezes everything except the decision, the last contact (TAT-52)\n * and the privacy scrub (only in the update that first sets `anonymizedAt`),\n * so do not try to edit the submitted fields.", and add inside the class, after `declare sourceChannel: SourceChannel;`:

```ts
	declare lastContactChannel: ContactChannel | null;
	declare lastContactKind: MessageKind | null;
```

In `apps/platform/app/modules/projects/models/tattoo_project.ts`, add the same import and, after `declare status: ProjectStatus;`:

```ts
	declare lastContactChannel: ContactChannel | null;
	declare lastContactKind: MessageKind | null;
```

- [ ] **Step 8: The catalog guard knows the two tables**

In `apps/platform/tests/functional/rls/catalog_guard.spec.ts`, in `EXPECTED_POLICIES`, replace

```ts
	inquiries: ["tenant_isolation:ALL"],
	payment_methods: ["tenant_isolation:ALL"],
```

with

```ts
	inquiries: ["tenant_isolation:ALL"],
	message_templates: ["tenant_isolation:ALL"],
	payment_methods: ["tenant_isolation:ALL"],
```

and

```ts
	reference_images: ["tenant_isolation:ALL"],
	tattoo_projects: ["tenant_isolation:ALL"],
```

with

```ts
	reference_images: ["tenant_isolation:ALL"],
	staff_alerts: ["tenant_isolation:ALL"],
	tattoo_projects: ["tenant_isolation:ALL"],
```

- [ ] **Step 9: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=inquiries_table.spec.ts --files=tattoo_projects_table.spec.ts --files=message_templates_table.spec.ts --files=staff_alerts_table.spec.ts --files=catalog_guard.spec.ts --files=guard_search_path.spec.ts --files=policies.spec.ts`
Expected: PASS (9 new tests; the guard and catalog tests unchanged). Then `typecheck`: clean.

- [ ] **Step 10: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/database/migrations/1791670000000_add_last_contact_to_projects_and_inquiries.ts apps/platform/database/migrations/1791670000001_create_message_templates_table.ts apps/platform/database/migrations/1791670000002_create_staff_alerts_table.ts apps/platform/app/modules/notifications apps/platform/app/modules/inquiries/models/inquiry.ts apps/platform/app/modules/projects/models/tattoo_project.ts apps/platform/tests/functional/rls/catalog_guard.spec.ts apps/platform/tests/functional/inquiries/inquiries_table.spec.ts apps/platform/tests/functional/projects/tattoo_projects_table.spec.ts apps/platform/tests/functional/notifications
git -C <repo> add apps/platform/database apps/platform/app/modules/notifications apps/platform/app/modules/inquiries/models/inquiry.ts apps/platform/app/modules/projects/models/tattoo_project.ts apps/platform/tests/functional/rls/catalog_guard.spec.ts apps/platform/tests/functional/inquiries/inquiries_table.spec.ts apps/platform/tests/functional/projects/tattoo_projects_table.spec.ts apps/platform/tests/functional/notifications
git -C <repo> commit -m "feat(platform): add the last contact, message templates and staff alerts tables" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Studio texts and Settings, Messages

**Files:**
- Create: `apps/platform/app/modules/notifications/services/message_template_service.ts`
- Create: `apps/platform/app/modules/notifications/validators/message_templates.ts`
- Create: `apps/platform/app/controllers/message_templates_controller.ts`
- Create: `apps/platform/inertia/components/messages.ts`, `apps/platform/inertia/pages/settings/messages.tsx`
- Modify: `apps/platform/start/routes.ts` (settings group), `apps/platform/inertia/layouts/settings.tsx`
- Modify: `apps/platform/tests/isolation/cases.ts` (two cases)
- Regenerated: `apps/platform/.adonisjs/` (codegen)
- Test: `apps/platform/tests/functional/notifications/message_template_service.spec.ts`, `apps/platform/tests/functional/notifications/message_templates_http.spec.ts`, `apps/platform/tests/unit/inertia/message_preview.spec.ts` (create)

**Interfaces:**
- `MessageTemplateService` (no dependencies): `textsFor(tenant): Promise<Record<MessageKind, string>>`, `save(tenant, texts: Record<MessageKind, string>): Promise<void>`.
- `messageTemplatesValidator` (`#modules/notifications/validators/message_templates`): the six kinds as string fields, each checked by `templateProblem`.
- `inertia/components/messages.ts` (no imports): `type MessageKindName`, `type ContactChannelName`, `type ContactLinksProps`, `type CardMessageProps`, `type ContactVia`, `previewMessage(text, allowed, values): string`.
- Page `settings/messages`, props `{ messages: { kind, label, offered, text, defaultText, placeholders: { name, help }[] }[]; sample: Record<string, string> }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/notifications/message_template_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import {
	DEFAULT_TEMPLATES,
	type MessageKind,
} from "#modules/notifications/messages";
import MessageTemplate from "#modules/notifications/models/message_template";
import MessageTemplateService from "#modules/notifications/services/message_template_service";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const templates = new MessageTemplateService();

/** The studio's own rows, by kind. */
const rowsOf = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		(
			await MessageTemplate.query()
				.where("tenant_id", tenant.id)
				.orderBy("kind")
		).map(({ kind, body }) => ({ kind, body })),
	);

test.group("MessageTemplateService", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a studio that wrote nothing gets the six defaults", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("texts-52");

		assert.deepEqual(
			await inTenant(tenant, () => templates.textsFor(tenant)),
			DEFAULT_TEMPLATES,
		);
	});

	test("saving keeps only the texts that differ from the default, normalized", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("texts-save-52");

		await inTenant(tenant, () =>
			templates.save(tenant, {
				...DEFAULT_TEMPLATES,
				aftercare: "  Namaste {client_name}!\r\nTake care.  ",
			}),
		);

		assert.deepEqual(await rowsOf(tenant), [
			{ kind: "aftercare", body: "Namaste {client_name}!\nTake care." },
		]);
		const texts = await inTenant(tenant, () => templates.textsFor(tenant));
		assert.equal(texts.aftercare, "Namaste {client_name}!\nTake care.");
		assert.equal(texts.quote, DEFAULT_TEMPLATES.quote);
	});

	test("saving the default again removes the studio's text; a new text replaces the old", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("texts-reset-52");
		const save = (over: Partial<Record<MessageKind, string>>) =>
			inTenant(tenant, () =>
				templates.save(tenant, { ...DEFAULT_TEMPLATES, ...over }),
			);

		await save({ quote: "Quote: {price}", aftercare: "Bye {client_name}" });
		await save({ quote: "Your quote: {price}" });
		assert.deepEqual(await rowsOf(tenant), [
			{ kind: "quote", body: "Your quote: {price}" },
		]);

		await save({ quote: `${DEFAULT_TEMPLATES.quote}\r\n` });
		assert.deepEqual(await rowsOf(tenant), []);
	});

	test("another studio's context sees none of its texts", async ({
		assert,
	}) => {
		const { tenant: a } = await studioWithOwner("texts-a-52");
		const { tenant: b } = await studioWithOwner("texts-b-52");
		await inTenant(a, () =>
			templates.save(a, { ...DEFAULT_TEMPLATES, quote: "A's quote: {price}" }),
		);

		// Asked from B's context for A's texts: the tenant filter and RLS both
		// hide them, so B gets the defaults.
		assert.deepEqual(
			await inTenant(b, () => templates.textsFor(a)),
			DEFAULT_TEMPLATES,
		);
		assert.deepEqual(
			await inTenant(b, () => templates.textsFor(b)),
			DEFAULT_TEMPLATES,
		);
	});
});
```

Create `apps/platform/tests/functional/notifications/message_templates_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import {
	DEFAULT_TEMPLATES,
	MESSAGE_KINDS,
} from "#modules/notifications/messages";
import MessageTemplate from "#modules/notifications/models/message_template";
import { makeClient, makeProject, makeQuote } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { assertValidationError } from "#tests/helpers/validation";

const PAGE = "/t/black-needle/settings/messages";

const rowsOf = (tenant: { id: string }) =>
	inTenant(tenant, async () =>
		(
			await MessageTemplate.query()
				.where("tenant_id", tenant.id)
				.orderBy("kind")
		).map(({ kind, body }) => ({ kind, body })),
	);

test.group("Settings, Messages", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the page lists the six messages with their placeholders and example details", async ({
		client,
		assert,
	}) => {
		const { owner } = await studioWithOwner();

		const response = await client.get(PAGE).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("settings/messages");
		const { messages, sample } = response.inertiaProps;
		assert.deepEqual(
			messages.map(({ kind }: { kind: string }) => kind),
			[...MESSAGE_KINDS],
		);
		assert.deepInclude(messages[1], {
			kind: "quote",
			label: "Quote",
			offered: "Offered under the quote while the client's answer is awaited.",
			text: DEFAULT_TEMPLATES.quote,
			defaultText: DEFAULT_TEMPLATES.quote,
		});
		assert.deepEqual(
			messages[1].placeholders.map(({ name }: { name: string }) => name),
			["client_name", "studio_name", "price", "deposit_note", "valid_until"],
		);
		assert.equal(sample.studio_name, "Black Needle");
		assert.equal(sample.client_name, "Sita");
	});

	test("saving keeps the studio's own text, with the flash", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.put(PAGE)
			.form({
				...DEFAULT_TEMPLATES,
				aftercare: "Namaste {client_name}! Take care.",
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", PAGE);
		response.assertFlashMessage("success", "Messages saved.");
		assert.deepEqual(await rowsOf(tenant), [
			{ kind: "aftercare", body: "Namaste {client_name}! Take care." },
		]);
		const shown = (await client.get(PAGE).withInertia().loginAs(owner))
			.inertiaProps;
		assert.equal(shown.messages[5].text, "Namaste {client_name}! Take care.");
	});

	test("a wrong placeholder or a missing deposit link is a field error and nothing is saved", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();

		const response = await client
			.put(PAGE)
			.form({
				...DEFAULT_TEMPLATES,
				quote: "Hi {client name}, {price}",
				deposit_link: "Please pay {amount}.",
				aftercare: "x".repeat(1001),
			})
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		assertValidationError(
			response,
			"quote",
			"{client name} can't be used here. This message can use {client_name}, {studio_name}, {price}, {deposit_note}, {valid_until}.",
		);
		assertValidationError(
			response,
			"deposit_link",
			"Keep {deposit_link}: it is the link the client pays on.",
		);
		assertValidationError(response, "aftercare", "Use at most 1,000 characters.");
		assert.deepEqual(await rowsOf(tenant), []);
	});

	test("artists get a 404 on the page and the save", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);

		(await client.get(PAGE).withInertia().loginAs(artist)).assertStatus(404);
		const save = await client
			.put(PAGE)
			.form({ ...DEFAULT_TEMPLATES, quote: "Mine: {price}" })
			.withCsrfToken()
			.loginAs(artist)
			.redirects(0);
		save.assertStatus(404);
		assert.deepEqual(await rowsOf(tenant), []);
	});

	test("the project page sends the studio's own quote text", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () => {
			const project = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Sita Rai" }),
				{ status: "quoted" },
			);
			await makeQuote(tenant, project);
			return project;
		});
		await client
			.put(PAGE)
			.form({ ...DEFAULT_TEMPLATES, quote: "Namaste {client_name}: {price}" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const props = (
			await client
				.get(`/t/black-needle/projects/${project.id}`)
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		assert.equal(props.message.text, "Namaste Sita: NPR 15,000");
	});
});
```

Create `apps/platform/tests/unit/inertia/message_preview.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	DEFAULT_TEMPLATES,
	KIND_PLACEHOLDERS,
	MESSAGE_KINDS,
	type MessageKind,
	renderMessage,
	sampleValues,
} from "#modules/notifications/messages";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `MessagesModule` below restates its shape and the inertia project type-checks the real one.
import * as messagesModule from "../../../inertia/components/messages.js";

type MessagesModule = {
	previewMessage(
		text: string,
		allowed: readonly string[],
		values: Readonly<Record<string, string>>,
	): string;
};
const { previewMessage } = messagesModule as MessagesModule;

test.group("previewMessage", () => {
	test("shows exactly what the server sends", ({ assert }) => {
		const sample = sampleValues({ name: "Black Needle", address: null });
		const cases: [MessageKind, string][] = [
			...MESSAGE_KINDS.map(
				(kind): [MessageKind, string] => [kind, DEFAULT_TEMPLATES[kind]],
			),
			["quote", "Hi {client_name}, {deposit_link} {price} {Price} {}"],
			[
				"booking_confirmation",
				"See you {session_time}{studio_address} at {studio_address}.\nनमस्ते 🙏",
			],
		];

		for (const [kind, text] of cases) {
			assert.equal(
				previewMessage(text, KIND_PLACEHOLDERS[kind], sample),
				renderMessage(kind, text, sample),
				`${kind}: ${text}`,
			);
		}
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test functional --files=message_template_service.spec.ts --files=message_templates_http.spec.ts > <scratchpad>/red.log 2>&1; echo $?` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=message_preview.spec.ts > <scratchpad>/red2.log 2>&1; echo $?`
Expected: `124` each, with `Cannot find module` for `#modules/notifications/services/message_template_service` and for `inertia/components/messages.js`.

- [ ] **Step 3: The service**

Create `apps/platform/app/modules/notifications/services/message_template_service.ts`:

```ts
import {
	DEFAULT_TEMPLATES,
	MESSAGE_KINDS,
	type MessageKind,
	normalizeTemplate,
} from "#modules/notifications/messages";
import MessageTemplate from "#modules/notifications/models/message_template";
import type Tenant from "#modules/tenancy/models/tenant";
import { withTransaction } from "#services/db_context";

type TenantRef = Pick<Tenant, "id">;

/**
 * A studio's chat message texts (TAT-52). A row exists only for a message
 * the studio changed; every other one is the default in code, so improving
 * a default reaches every studio that never edited it.
 */
export default class MessageTemplateService {
	/** The studio's six texts: its own where it wrote one, else the default. One query. */
	async textsFor(tenant: TenantRef): Promise<Record<MessageKind, string>> {
		const rows = await MessageTemplate.query().where("tenant_id", tenant.id);
		const own = new Map(rows.map((row) => [row.kind, row.body]));
		return Object.fromEntries(
			MESSAGE_KINDS.map((kind) => [
				kind,
				own.get(kind) ?? DEFAULT_TEMPLATES[kind],
			]),
		) as Record<MessageKind, string>;
	}

	/**
	 * Saves the six texts (messageTemplatesValidator checked them), each
	 * normalized: one equal to the default removes the studio's row, any
	 * other is stored in place. One transaction.
	 */
	async save(
		tenant: TenantRef,
		texts: Record<MessageKind, string>,
	): Promise<void> {
		await withTransaction(async (trx) => {
			for (const kind of MESSAGE_KINDS) {
				const body = normalizeTemplate(texts[kind]);
				if (body === DEFAULT_TEMPLATES[kind]) {
					await MessageTemplate.query({ client: trx })
						.where("tenant_id", tenant.id)
						.where("kind", kind)
						.delete();
					continue;
				}
				await trx.rawQuery(
					`insert into message_templates (tenant_id, kind, body, created_at, updated_at)
					 values (?, ?, ?, now(), now())
					 on conflict (tenant_id, kind) do update
					 set body = excluded.body, updated_at = now()
					 where message_templates.body is distinct from excluded.body`,
					[tenant.id, kind, body],
				);
			}
		});
	}
}
```

- [ ] **Step 4: The validator**

Create `apps/platform/app/modules/notifications/validators/message_templates.ts`:

```ts
import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { FieldContext } from "@vinejs/vine/types";
import {
	type MessageKind,
	templateProblem,
} from "#modules/notifications/messages";

/** A text must pass templateProblem for its kind (spec ruling 20). */
const messageText = vine.createRule<MessageKind>(
	(value: unknown, kind: MessageKind, field: FieldContext) => {
		if (typeof value !== "string") return;
		const problem = templateProblem(kind, value);
		if (problem) field.report(problem, "messageText", field);
	},
);

/** One field per kind, named after it: one form and one error bag, so each error shows under its own box. */
const text = (kind: MessageKind) => vine.string().use(messageText(kind));

/** Settings, Messages: the six texts at once. */
export const messageTemplatesValidator = vine.create({
	inquiry_received: text("inquiry_received"),
	quote: text("quote"),
	deposit_link: text("deposit_link"),
	booking_confirmation: text("booking_confirmation"),
	session_reminder: text("session_reminder"),
	aftercare: text("aftercare"),
});
messageTemplatesValidator.messagesProvider = new SimpleMessagesProvider({
	required: "Write the message, or reset it to the default.",
	string: "Write the message, or reset it to the default.",
});
```

- [ ] **Step 5: The controller and the routes**

Create `apps/platform/app/controllers/message_templates_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	DEFAULT_TEMPLATES,
	KIND_PLACEHOLDERS,
	MESSAGE_KINDS,
	MESSAGE_LABELS,
	MESSAGE_OFFERED,
	PLACEHOLDER_HELP,
	sampleValues,
} from "#modules/notifications/messages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import MessageTemplateService from "#modules/notifications/services/message_template_service";
import { messageTemplatesValidator } from "#modules/notifications/validators/message_templates";

/**
 * Settings, Messages (TAT-52): the studio's six chat messages. Owners only
 * (the settings group's role check).
 */
@inject()
export default class MessageTemplatesController {
	constructor(private templates: MessageTemplateService) {}

	async show(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const texts = await this.templates.textsFor(tenant);

		return ctx.inertia.render("settings/messages", {
			messages: MESSAGE_KINDS.map((kind) => ({
				kind,
				label: MESSAGE_LABELS[kind],
				offered: MESSAGE_OFFERED[kind],
				text: texts[kind],
				defaultText: DEFAULT_TEMPLATES[kind],
				placeholders: KIND_PLACEHOLDERS[kind].map((name) => ({
					name,
					help: PLACEHOLDER_HELP[name],
				})),
			})),
			sample: sampleValues({ name: tenant.name, address: tenant.address }),
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const texts = await ctx.request.validateUsing(messageTemplatesValidator);
		await this.templates.save(tenant, texts);
		ctx.session.flash("success", "Messages saved.");
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.messages", { tenant: tenant.slug });
	}
}
```

In `apps/platform/start/routes.ts`, in the settings group, replace

```ts
				router
					.delete("payments/:id", [controllers.PaymentMethods, "destroy"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.destroy");
			})
			.prefix("/settings")
```

with

```ts
				router
					.delete("payments/:id", [controllers.PaymentMethods, "destroy"])
					.where("id", router.matchers.uuid())
					.as("tenant.settings.payments.destroy");
				// The studio's chat messages (TAT-52). The kind is a body field
				// per message, never a path segment.
				router
					.get("messages", [controllers.MessageTemplates, "show"])
					.as("tenant.settings.messages");
				router
					.put("messages", [controllers.MessageTemplates, "update"])
					.as("tenant.settings.messages.update");
			})
			.prefix("/settings")
```

- [ ] **Step 6: The dashboard's message helpers**

Create `apps/platform/inertia/components/messages.ts`:

```ts
/**
 * The dashboard's side of the chat messages (TAT-52). No imports: the unit
 * tests load it.
 */

export type MessageKindName =
	| "inquiry_received"
	| "quote"
	| "deposit_link"
	| "booking_confirmation"
	| "session_reminder"
	| "aftercare";

export type ContactChannelName = "whatsapp" | "viber" | "call" | "copy";

/** One-tap links to the client without a message. */
export type ContactLinksProps = {
	whatsappUrl: string;
	viberUrl: string;
	callUrl: string;
};

/** A message the "Message the client" card offers, ready to send. */
export type CardMessageProps = {
	kind: MessageKindName;
	label: string;
	text: string;
	whatsappUrl: string;
	viberUrl: string;
};

/** What the contact routes take: the link tapped and the message it carried. */
export type ContactVia = {
	channel?: ContactChannelName;
	kind?: MessageKindName;
};

/** `{name}`, with the one space before it that an empty value takes along. */
const PLACEHOLDER = /( ?)\{([a-z_]+)\}/g;

/**
 * The settings page's live preview: the server's renderMessage
 * (#modules/notifications/messages) restated, because the dashboard can't
 * import server code. message_preview.spec.ts runs both on the same cases.
 */
export function previewMessage(
	text: string,
	allowed: readonly string[],
	values: Readonly<Record<string, string>>,
): string {
	return text.replace(
		PLACEHOLDER,
		(match: string, space: string, name: string) => {
			if (!allowed.includes(name)) return match;
			const value = values[name] ?? "";
			return value === "" ? "" : `${space}${value}`;
		},
	);
}
```

- [ ] **Step 7: The page and the settings entry**

Create `apps/platform/inertia/pages/settings/messages.tsx`:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { useState } from "react";
import { previewMessage } from "~/components/messages";
import Section from "~/components/section";
import { Button } from "~/components/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "~/components/ui/field";
import { Textarea } from "~/components/ui/textarea";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";
import SettingsLayout from "~/layouts/settings";

type MessageSetting = {
	kind: string;
	label: string;
	offered: string;
	text: string;
	defaultText: string;
	placeholders: { name: string; help: string }[];
};

/**
 * Settings, Messages (TAT-52): the six chat messages staff send with one
 * tap. One form, so each error shows under its own box; each preview
 * follows its box as it is typed.
 */
export default function Messages({
	messages,
	sample,
}: {
	messages: MessageSetting[];
	sample: Record<string, string>;
}) {
	const tenant = useTenant();
	const [texts, setTexts] = useState<Record<string, string>>(() =>
		Object.fromEntries(messages.map(({ kind, text }) => [kind, text])),
	);
	const setText = (kind: string, text: string) =>
		setTexts((current) => ({ ...current, [kind]: text }));

	return (
		<Form
			route="tenant.settings.messages.update"
			routeParams={{ tenant: tenant.slug }}
			options={{ preserveScroll: true, preserveState: "errors" }}
		>
			{({ errors, processing }) => (
				<FieldGroup>
					{messages.map((message) => {
						const text = texts[message.kind] ?? "";
						const error = errors[message.kind];
						const id = `message-${message.kind}`;
						return (
							<Section
								key={message.kind}
								title={message.label}
								description={message.offered}
							>
								<div className="flex flex-col gap-3">
									<Field data-invalid={!!error}>
										<FieldLabel htmlFor={id} className="sr-only">
											{message.label}
										</FieldLabel>
										<Textarea
											id={id}
											name={message.kind}
											rows={6}
											maxLength={1000}
											value={text}
											onChange={(event) =>
												setText(message.kind, event.target.value)
											}
											aria-invalid={!!error}
											aria-describedby={
												error
													? `${id}-error ${id}-placeholders`
													: `${id}-placeholders`
											}
										/>
										{error && <FieldError id={`${id}-error`}>{error}</FieldError>}
										<FieldDescription id={`${id}-placeholders`}>
											Placeholders:
										</FieldDescription>
										<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
											{message.placeholders.map(({ name, help }) => (
												<li key={name}>
													<code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
														{`{${name}}`}
													</code>{" "}
													{help}
												</li>
											))}
										</ul>
									</Field>
									<div className="flex flex-col gap-1">
										<p className="text-xs font-medium text-muted-foreground">
											Preview with example details
										</p>
										<p className="rounded-md bg-muted/50 p-3 text-sm break-words whitespace-pre-line">
											{previewMessage(
												text,
												message.placeholders.map(({ name }) => name),
												sample,
											)}
										</p>
									</div>
									{text !== message.defaultText && (
										<div>
											<Button
												type="button"
												variant="ghost"
												className="h-11"
												onClick={() => setText(message.kind, message.defaultText)}
											>
												Reset to default
											</Button>
										</div>
									)}
								</div>
							</Section>
						);
					})}
					<div>
						<Button type="submit" className="h-11" disabled={processing}>
							{processing ? "Saving…" : "Save messages"}
						</Button>
					</div>
				</FieldGroup>
			)}
		</Form>
	);
}

Messages.layout = [AppLayout, SettingsLayout];
```

In `apps/platform/inertia/layouts/settings.tsx`, replace the lucide import

```ts
import { Store, Users, Wallet } from "lucide-react";
```

with

```ts
import { MessageSquareText, Store, Users, Wallet } from "lucide-react";
```

replace

```ts
		{
			label: "Payments",
			route: "tenant.settings.payments",
			params,
			icon: Wallet,
		},
```

with

```ts
		{
			label: "Payments",
			route: "tenant.settings.payments",
			params,
			icon: Wallet,
		},
		{
			label: "Messages",
			route: "tenant.settings.messages",
			params,
			icon: MessageSquareText,
		},
```

and replace the description `"Your studio's public details, its artists, and how clients pay you."` with `"Your studio's public details, its artists, how clients pay you and the messages you send them."`.

- [ ] **Step 8: Two isolation cases**

In `apps/platform/tests/isolation/cases.ts`, add the import (Biome orders it):

```ts
import { DEFAULT_TEMPLATES } from "#modules/notifications/messages";
import MessageTemplate from "#modules/notifications/models/message_template";
```

after the `tenantSlugRows` helper add:

```ts
// The studio's own message texts (TAT-52): what saving the messages could
// change.
const templateRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await MessageTemplate.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("kind")
		).map((row) => row.serialize()),
	);
```

and at the end of `isolationCases`, replace

```ts
		ownStatus: 302,
		snapshot: sessionRows,
	},
];
```

with

```ts
		ownStatus: 302,
		snapshot: sessionRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/settings/messages",
		actor: "owner",
		ownStatus: 200,
		snapshot: templateRows,
	},
	{
		method: "PUT",
		pattern: "/t/:tenant/settings/messages",
		actor: "owner",
		// Every default but the quote: A's control stores one row.
		body: () => ({
			...DEFAULT_TEMPLATES,
			quote: "Hi {client_name}, your quote: {price}.",
		}),
		ownStatus: 302,
		snapshot: templateRows,
	},
];
```

- [ ] **Step 9: The project page's quote message uses the studio's text**

The HTTP test "the project page sends the studio's own quote text" needs `ProjectsController` to pass the studio's quote text (Task 6 does the rest of the page). In `apps/platform/app/controllers/projects_controller.ts`, add the import and the constructor parameter (last):

```ts
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import MessageTemplateService from "#modules/notifications/services/message_template_service";
```

```ts
		private bookings: BookingService,
		private templates: MessageTemplateService,
	) {}
```

in `show()`, right after `const { timezone } = tenant;`, add:

```ts
		// The studio's own chat texts, else the defaults (TAT-52).
		const texts = await this.templates.textsFor(tenant);
```

replace

```ts
						? messageProps(live, client.name, client.phone, tenant.name, timezone)
```

with

```ts
						? messageProps(
								live,
								client.name,
								client.phone,
								tenant.name,
								timezone,
								texts.quote,
							)
```

and replace the `messageProps` function at the bottom with:

```ts
/** The chat message for a live quote, in the studio's text, and the links that send it. */
function messageProps(
	quote: Quote,
	clientName: string,
	phone: string,
	studioName: string,
	timezone: string,
	template: string,
) {
	return chatMessage(
		quoteMessage({ clientName, studioName, quote, timezone }, template),
		phone,
	);
}
```

- [ ] **Step 10: Regenerate types, run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then
`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=message_template_service.spec.ts --files=message_templates_http.spec.ts --files=project_page.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=message_preview.spec.ts`.
Expected: PASS (4 service and 5 HTTP tests, 2 new isolation cases, the preview test; `project_page.spec.ts` unchanged). Then `typecheck`: clean.

- [ ] **Step 11: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/notifications apps/platform/app/controllers/message_templates_controller.ts apps/platform/app/controllers/projects_controller.ts apps/platform/start/routes.ts apps/platform/inertia/components/messages.ts apps/platform/inertia/pages/settings/messages.tsx apps/platform/inertia/layouts/settings.tsx apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/notifications apps/platform/tests/unit/inertia/message_preview.spec.ts
git -C <repo> add apps/platform/app/modules/notifications apps/platform/app/controllers/message_templates_controller.ts apps/platform/app/controllers/projects_controller.ts apps/platform/start/routes.ts apps/platform/inertia/components/messages.ts apps/platform/inertia/pages/settings/messages.tsx apps/platform/inertia/layouts/settings.tsx apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/notifications apps/platform/tests/unit/inertia/message_preview.spec.ts apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): let owners edit the studio's chat messages in Settings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Recording the last contact

**Files:**
- Create: `apps/platform/app/modules/notifications/validators/contact.ts`
- Modify: `apps/platform/app/modules/projects/contact.ts` (`lastContactText`)
- Modify: `apps/platform/app/modules/projects/services/project_service.ts` (`markContacted`, `createFromInquiry`)
- Modify: `apps/platform/app/modules/inquiries/services/inquiry_service.ts` (`markContacted`, `accept`)
- Modify: `apps/platform/app/controllers/project_changes_controller.ts` (`contacted`), `apps/platform/app/controllers/inquiries_controller.ts` (`contacted`), `apps/platform/app/controllers/projects_controller.ts` (the two `contactedText` props)
- Modify: `apps/platform/start/routes.ts` (inbox group), `apps/platform/tests/isolation/cases.ts` (one case)
- Regenerated: `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/unit/modules/projects/moves.spec.ts`, `apps/platform/tests/functional/projects/project_changes.spec.ts`, `apps/platform/tests/functional/inquiries/inquiry_service.spec.ts`, `apps/platform/tests/functional/inquiries/inbox.spec.ts` (add tests)

**Interfaces:**
- `contactValidator` (`channel?: ContactChannel`, `kind?: MessageKind`) and `toContactVia(input): ContactVia`, from `#modules/notifications/validators/contact`.
- `lastContactText(at: DateTime | null, timezone: string, via: ContactVia, now?: DateTime): string` in `#modules/projects/contact`.
- `ProjectService.markContacted(tenant, member, project, via: ContactVia = NO_VIA)`; `createFromInquiry(tenant, { …, lastContact?: { at: DateTime | null } & ContactVia })`.
- `InquiryService.markContacted(tenant, inquiry, via: ContactVia): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/unit/modules/projects/moves.spec.ts`, change the contact import to

```ts
import {
	contactedText,
	daysAgoText,
	lastContactText,
} from "#modules/projects/contact";
```

add `import { NO_VIA } from "#modules/notifications/messages";` and append at the end of the file:

```ts
test.group("lastContactText", () => {
	// 10:00 on 15 Oct in Kathmandu (UTC+5:45).
	const now = DateTime.fromISO("2026-10-15T10:00:00", { zone: KTM });

	test("adds the channel and the message to the day", ({ assert }) => {
		const earlier = now.set({ hour: 9 });
		assert.equal(
			lastContactText(earlier, KTM, { channel: "whatsapp", kind: "quote" }, now),
			"contacted today on WhatsApp (Quote)",
		);
		assert.equal(
			lastContactText(
				now.minus({ days: 2 }),
				KTM,
				{ channel: "copy", kind: "deposit_link" },
				now,
			),
			"contacted 2 days ago with a copied message (Deposit link)",
		);
		assert.equal(
			lastContactText(
				now.minus({ days: 1 }),
				KTM,
				{ channel: "call", kind: null },
				now,
			),
			"contacted yesterday by phone",
		);
		assert.equal(lastContactText(earlier, KTM, NO_VIA, now), "contacted today");
		assert.equal(
			lastContactText(null, KTM, { channel: "viber", kind: "aftercare" }, now),
			"never contacted",
		);
	});
});
```

In `apps/platform/tests/functional/projects/project_changes.spec.ts`, after the test "Mark contacted records the time" (it ends with `assert.isTrue(at !== null && at >= before);\n\t});`), add:

```ts
	test("a chat link records its channel and message; Mark contacted records the time only", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);
		const send = (body: Record<string, string>) =>
			client
				.post(url(project.id, "/contacted"))
				.form(body)
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		(await send({ channel: "whatsapp", kind: "quote" })).assertFlashMessage(
			"success",
			"Marked as contacted.",
		);
		let live = await reload(tenant, project);
		assert.equal(live.lastContactChannel, "whatsapp");
		assert.equal(live.lastContactKind, "quote");

		await send({});
		live = await reload(tenant, project);
		assert.isNotNull(live.lastContactedAt);
		assert.isNull(live.lastContactChannel);
		assert.isNull(live.lastContactKind);
	});

	test("a channel or message the page doesn't send is refused and nothing is recorded", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await projectIn(tenant);

		for (const [field, value] of [
			["channel", "sms"],
			["kind", "hello"],
		] as const) {
			const response = await client
				.post(url(project.id, "/contacted"))
				.form({ [field]: value })
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);
			assertValidationError(response, field);
		}
		assert.isNull((await reload(tenant, project)).lastContactedAt);
	});
```

In `apps/platform/tests/functional/inquiries/inquiry_service.spec.ts`, add `import { NO_VIA } from "#modules/notifications/messages";` and append at the end of the file:

```ts
test.group("InquiryService contact (TAT-52)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("markContacted records the contact on the inquiry; a deleted one is a 404", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			await inquiries.markContacted(tenant, inquiry, {
				channel: "viber",
				kind: "inquiry_received",
			});
			const live = await Inquiry.findOrFail(inquiry.id);
			assert.isNotNull(live.lastContactedAt);
			assert.equal(live.lastContactChannel, "viber");
			assert.equal(live.lastContactKind, "inquiry_received");
			assert.equal(live.idea, inquiry.idea);

			const gone = await inquiryIn(tenant);
			await gone.softDelete();
			await assert.rejects(
				() => inquiries.markContacted(tenant, gone, NO_VIA),
				/Row not found/,
			);
		});
	});

	test("accepting carries the inquiry's last contact to its project", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();

		await inTenant(tenant, async () => {
			const inquiry = await inquiryIn(tenant);
			await inquiries.markContacted(tenant, inquiry, {
				channel: "whatsapp",
				kind: "inquiry_received",
			});
			const contacted = await Inquiry.findOrFail(inquiry.id);

			const project = await inquiries.accept(tenant, contacted, null);

			const created = await TattooProject.findOrFail(project.id);
			assert.equal(
				created.lastContactedAt?.toMillis(),
				contacted.lastContactedAt?.toMillis(),
			);
			assert.equal(created.lastContactChannel, "whatsapp");
			assert.equal(created.lastContactKind, "inquiry_received");
		});
	});
});
```

In `apps/platform/tests/functional/inquiries/inbox.spec.ts`, append at the end of the file:

```ts
test.group("Inbox contact (TAT-52)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the inquiry's chat links record the contact; artists get a 404", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const send = (user: typeof owner) =>
			client
				.post(inbox(`/${inquiry.id}/contacted`))
				.form({ channel: "whatsapp", kind: "inquiry_received" })
				.withCsrfToken()
				.loginAs(user)
				.redirects(0);
		const reload = () => inTenant(tenant, () => Inquiry.findOrFail(inquiry.id));

		(await send(artist)).assertStatus(404);
		assert.isNull((await reload()).lastContactedAt);

		const response = await send(owner);
		response.assertStatus(302);
		response.assertHeader("location", inbox(`/${inquiry.id}`));
		response.assertFlashMessage("success", "Marked as contacted.");
		const live = await reload();
		assert.equal(live.lastContactChannel, "whatsapp");
		assert.equal(live.lastContactKind, "inquiry_received");
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=moves.spec.ts > <scratchpad>/red.log 2>&1; echo $?` → `124` with "does not provide an export named 'lastContactText'". Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_changes.spec.ts --files=inquiry_service.spec.ts --files=inbox.spec.ts` → the 5 new tests FAIL (the channel is not stored; `markContacted` is not a function on `InquiryService`; the inbox route is a 404 for the owner too).

- [ ] **Step 3: The contact validator and the text**

Create `apps/platform/app/modules/notifications/validators/contact.ts`:

```ts
import vine, { SimpleMessagesProvider } from "@vinejs/vine";
import type { Infer } from "@vinejs/vine/types";
import {
	CONTACT_CHANNELS,
	type ContactVia,
	MESSAGE_KINDS,
} from "#modules/notifications/messages";

/**
 * What a contact route takes (TAT-52): the link or button tapped and the
 * message it carried, both optional ("Mark contacted" sends neither). The
 * page sends them; a value it doesn't send is a validation error.
 */
export const contactValidator = vine.create({
	channel: vine.enum(CONTACT_CHANNELS).optional(),
	kind: vine.enum(MESSAGE_KINDS).optional(),
});
contactValidator.messagesProvider = new SimpleMessagesProvider({
	"channel.enum": "Choose WhatsApp, Viber, a call or a copied message.",
	"kind.enum": "Choose one of the studio's messages.",
});

/** The validated body as a last contact: what is missing is null. */
export function toContactVia({
	channel,
	kind,
}: Infer<typeof contactValidator>): ContactVia {
	return { channel: channel ?? null, kind: kind ?? null };
}
```

In `apps/platform/app/modules/projects/contact.ts`, add the import

```ts
import {
	CHANNEL_TEXT,
	type ContactVia,
	MESSAGE_LABELS,
} from "#modules/notifications/messages";
```

and append:

```ts
/**
 * The last contact for people (TAT-52): contactedText plus the channel and
 * the message, "contacted today on WhatsApp (Quote)"; "contacted today" for
 * "Mark contacted"; "never contacted" without a time.
 */
export function lastContactText(
	at: DateTime | null,
	timezone: string,
	via: ContactVia,
	now: DateTime = DateTime.now(),
): string {
	if (!at) return "never contacted";
	const channel = via.channel ? ` ${CHANNEL_TEXT[via.channel]}` : "";
	const kind = via.kind ? ` (${MESSAGE_LABELS[via.kind]})` : "";
	return `${contactedText(at, timezone, now)}${channel}${kind}`;
}
```

- [ ] **Step 4: The services**

In `apps/platform/app/modules/projects/services/project_service.ts`, add the import

```ts
import { type ContactVia, NO_VIA } from "#modules/notifications/messages";
```

replace `createFromInquiry` (doc comment and body) with:

```ts
	/**
	 * A `reviewing` project for an accepted inquiry. InquiryService.accept
	 * calls it inside its own transaction, holding the inquiry's lock; the
	 * artist was already checked there. The project is new, so there is
	 * nothing to lock. It starts from the inquiry's last contact (TAT-52), so
	 * the "received" message staff sent shows on the project too.
	 */
	async createFromInquiry(
		tenant: TenantRef,
		input: {
			clientId: string;
			inquiryId: string;
			brief: string;
			artistId: string | null;
			lastContact?: { at: DateTime | null } & ContactVia;
		},
	): Promise<TattooProject> {
		return TattooProject.create({
			tenantId: tenant.id,
			clientId: input.clientId,
			inquiryId: input.inquiryId,
			brief: input.brief,
			artistId: input.artistId,
			status: "reviewing",
			lastContactedAt: input.lastContact?.at ?? null,
			lastContactChannel: input.lastContact?.channel ?? null,
			lastContactKind: input.lastContact?.kind ?? null,
		});
	}
```

and replace `markContacted` (doc comment and body) with:

```ts
	/**
	 * Records that the client was contacted now: the chat links call it as
	 * they open, with the channel and the message (TAT-52), and staff tap
	 * "Mark contacted" after a call or a visit (`NO_VIA`).
	 */
	async markContacted(
		tenant: TenantRef,
		member: Member,
		project: TattooProject,
		via: ContactVia = NO_VIA,
	): Promise<void> {
		assertProjectOf(tenant, project);
		await withTransaction(async (trx) => {
			const live = await this.lockFor(trx, tenant, member, project.id);
			live.lastContactedAt = DateTime.now();
			live.lastContactChannel = via.channel;
			live.lastContactKind = via.kind;
			await live.save();
		});
	}
```

In `apps/platform/app/modules/inquiries/services/inquiry_service.ts`, add the import

```ts
import type { ContactVia } from "#modules/notifications/messages";
```

in `accept`, replace

```ts
			const project = await this.projects.createFromInquiry(tenant, {
				clientId: live.clientId,
				inquiryId: live.id,
				brief: live.idea,
				artistId,
			});
```

with

```ts
			const project = await this.projects.createFromInquiry(tenant, {
				clientId: live.clientId,
				inquiryId: live.id,
				brief: live.idea,
				artistId,
				lastContact: {
					at: live.lastContactedAt,
					channel: live.lastContactChannel,
					kind: live.lastContactKind,
				},
			});
```

and after `decline` add:

```ts
	/**
	 * Records that the client was contacted about this inquiry now (TAT-52):
	 * the inquiry page's chat links, with the channel and the message. These
	 * three columns are the only ones besides the decision that the guard
	 * trigger lets change. Any status (a decided inquiry's plain links record
	 * too). A deleted or another tenant's inquiry is E_ROW_NOT_FOUND.
	 */
	async markContacted(
		tenant: TenantRef,
		inquiry: Inquiry,
		via: ContactVia,
	): Promise<void> {
		assertInquiryOf(tenant, inquiry);
		await withTransaction(async (trx) => {
			const live = await lockInquiry(trx, tenant, inquiry.id);
			live.lastContactedAt = DateTime.now();
			live.lastContactChannel = via.channel;
			live.lastContactKind = via.kind;
			await live.save();
		});
	}
```

- [ ] **Step 5: The controllers and the route**

In `apps/platform/app/controllers/project_changes_controller.ts`, add the import

```ts
import {
	contactValidator,
	toContactVia,
} from "#modules/notifications/validators/contact";
```

and replace the body of `contacted` with:

```ts
	async contacted(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const via = toContactVia(
			await ctx.request.validateUsing(contactValidator),
		);
		await this.projects.markContacted(tenant, membership, project, via);
		ctx.session.flash("success", "Marked as contacted.");
		return backTo(ctx, tenant, project);
	}
```

In `apps/platform/app/controllers/inquiries_controller.ts`, add the import

```ts
import {
	contactValidator,
	toContactVia,
} from "#modules/notifications/validators/contact";
```

and after `decline` add:

```ts
	/** The inquiry page's chat links record the contact in the background (TAT-52). */
	async contacted(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const inquiry = await this.inquiries.findFor(tenant, ctx.params.id);
		const via = toContactVia(
			await ctx.request.validateUsing(contactValidator),
		);
		await this.inquiries.markContacted(tenant, inquiry, via);
		ctx.session.flash("success", "Marked as contacted.");
		return ctx.response
			.redirect()
			.toRoute("tenant.inbox.show", { tenant: tenant.slug, id: inquiry.id });
	}
```

In `apps/platform/app/controllers/projects_controller.ts`, change the import `import { contactedText } from "#modules/projects/contact";` to `import { lastContactText } from "#modules/projects/contact";`, and replace

```ts
				contactedText: contactedText(project.lastContactedAt, tenant.timezone),
```

(in `index`) with

```ts
				contactedText: lastContactText(project.lastContactedAt, tenant.timezone, {
					channel: project.lastContactChannel,
					kind: project.lastContactKind,
				}),
```

and

```ts
			contactedText: contactedText(project.lastContactedAt, timezone),
```

(in `show`) with

```ts
			contactedText: lastContactText(project.lastContactedAt, timezone, {
				channel: project.lastContactChannel,
				kind: project.lastContactKind,
			}),
```

In `apps/platform/start/routes.ts`, in the inbox group, replace

```ts
				router
					.post(":id/decline", [controllers.Inquiries, "decline"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.decline");
```

with

```ts
				router
					.post(":id/decline", [controllers.Inquiries, "decline"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.decline");
				// The inquiry page's chat links record the contact (TAT-52).
				router
					.post(":id/contacted", [controllers.Inquiries, "contacted"])
					.where("id", router.matchers.uuid())
					.as("tenant.inbox.contacted.store");
```

- [ ] **Step 6: The isolation case**

In `apps/platform/tests/isolation/cases.ts`, at the end of `isolationCases`, replace

```ts
		ownStatus: 302,
		snapshot: templateRows,
	},
];
```

with

```ts
		ownStatus: 302,
		snapshot: templateRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/inbox/:id/contacted",
		resource: "newInquiry",
		actor: "owner",
		body: () => ({ channel: "whatsapp", kind: "inquiry_received" }),
		ownStatus: 302,
		snapshot: inboxRows,
	},
];
```

- [ ] **Step 7: Regenerate types, run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=moves.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_changes.spec.ts --files=inquiry_service.spec.ts --files=inbox.spec.ts --files=project_service.spec.ts --files=projects_list.spec.ts --files=project_page.spec.ts --files=cross_tenant.spec.ts --files=tenant_routes.spec.ts`.
Expected: PASS (1 + 2 + 2 + 1 new tests, 1 new isolation case; the old contact texts unchanged: "contacted 2 days ago", "contacted yesterday", "never contacted"). Then `typecheck`: clean.

- [ ] **Step 8: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/notifications/validators/contact.ts apps/platform/app/modules/projects/contact.ts apps/platform/app/modules/projects/services/project_service.ts apps/platform/app/modules/inquiries/services/inquiry_service.ts apps/platform/app/controllers/project_changes_controller.ts apps/platform/app/controllers/inquiries_controller.ts apps/platform/app/controllers/projects_controller.ts apps/platform/start/routes.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/unit/modules/projects/moves.spec.ts apps/platform/tests/functional/projects/project_changes.spec.ts apps/platform/tests/functional/inquiries/inquiry_service.spec.ts apps/platform/tests/functional/inquiries/inbox.spec.ts
git -C <repo> add apps/platform/app apps/platform/start/routes.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/unit/modules/projects/moves.spec.ts apps/platform/tests/functional/projects/project_changes.spec.ts apps/platform/tests/functional/inquiries/inquiry_service.spec.ts apps/platform/tests/functional/inquiries/inbox.spec.ts apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): record the channel and message of every client contact" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "Message the client" on the project page

**Files:**
- Create: `apps/platform/app/modules/notifications/chat.ts`, `apps/platform/app/modules/notifications/project_messages.ts`
- Create: `apps/platform/inertia/components/chat_message.tsx`, `apps/platform/inertia/components/message_card.tsx`
- Modify: `apps/platform/app/controllers/projects_controller.ts`, `apps/platform/inertia/components/projects.ts`, `apps/platform/inertia/pages/projects/show.tsx`
- Test: `apps/platform/tests/unit/modules/notifications/chat.spec.ts`, `apps/platform/tests/unit/modules/notifications/project_messages.spec.ts` (create), `apps/platform/tests/functional/projects/project_page.spec.ts` (add a group)

**Interfaces:**
- `#modules/notifications/chat`: `type ChatMessage = { text; whatsappUrl; viberUrl }`, `chatMessage(text, phone): ChatMessage`, `type ContactLinks = { whatsappUrl; viberUrl; callUrl }`, `contactLinks(phone): ContactLinks`.
- `#modules/notifications/project_messages`: `CARD_KINDS`, `type CardKind`, `type CardState`, `cardKinds(state): CardKind[]`, `defaultCardKind(status, kinds): CardKind | null`, `type CardFacts`, `ANY_ARTIST`, `cardValues(kind, facts): MessageValues`.
- Page `projects/show` gains `contact: ContactLinksProps | null`, `messages: CardMessageProps[]`, `messageKind: MessageKindName | null`. `message` and `deposit.message` keep TAT-64's and TAT-65's shape.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/notifications/chat.spec.ts`:

```ts
import { test } from "@japa/runner";
import { chatMessage, contactLinks } from "#modules/notifications/chat";

test.group("Chat messages", () => {
	test("the text is percent-encoded as UTF-8, newlines and reserved characters included", ({
		assert,
	}) => {
		const text = "नमस्ते Sita,\nतपाईंको सत्र 🙏 #1 + ? & =";

		const message = chatMessage(text, "+9779812345678");

		assert.equal(message.text, text);
		assert.equal(
			message.whatsappUrl,
			"https://wa.me/9779812345678?text=%E0%A4%A8%E0%A4%AE%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A5%87%20Sita%2C%0A%E0%A4%A4%E0%A4%AA%E0%A4%BE%E0%A4%88%E0%A4%82%E0%A4%95%E0%A5%8B%20%E0%A4%B8%E0%A4%A4%E0%A5%8D%E0%A4%B0%20%F0%9F%99%8F%20%231%20%2B%20%3F%20%26%20%3D",
		);
		assert.equal(new URL(message.whatsappUrl).searchParams.get("text"), text);
		assert.equal(message.viberUrl, "viber://chat?number=%2B9779812345678");
	});

	test("the address is the stored number, whatever the text says", ({
		assert,
	}) => {
		const url = new URL(
			chatMessage(
				"Call +1 555 0100 or open https://evil.example/?a=1#x",
				"+9779812345678",
			).whatsappUrl,
		);

		assert.equal(url.host, "wa.me");
		assert.equal(url.pathname, "/9779812345678");
		assert.deepEqual([...url.searchParams.keys()], ["text"]);
		assert.equal(url.hash, "");
	});

	test("plain links open a chat or a call without a message", ({ assert }) => {
		assert.deepEqual(contactLinks("+9779812345678"), {
			whatsappUrl: "https://wa.me/9779812345678",
			viberUrl: "viber://chat?number=%2B9779812345678",
			callUrl: "tel:+9779812345678",
		});
	});
});
```

Create `apps/platform/tests/unit/modules/notifications/project_messages.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	cardKinds,
	cardValues,
	defaultCardKind,
} from "#modules/notifications/project_messages";

test.group("cardKinds", () => {
	test("inquiry received under review; the session messages with a session to come; aftercare once work is done", ({
		assert,
	}) => {
		const none = { upcomingSession: false, finishedWork: false };
		assert.deepEqual(cardKinds({ status: "reviewing", ...none }), [
			"inquiry_received",
		]);
		assert.deepEqual(cardKinds({ status: "quoted", ...none }), []);
		assert.deepEqual(
			cardKinds({ status: "booked", upcomingSession: true, finishedWork: false }),
			["booking_confirmation", "session_reminder"],
		);
		assert.deepEqual(
			cardKinds({
				status: "in_progress",
				upcomingSession: true,
				finishedWork: true,
			}),
			["booking_confirmation", "session_reminder", "aftercare"],
		);
		assert.deepEqual(
			cardKinds({
				status: "completed",
				upcomingSession: false,
				finishedWork: true,
			}),
			["aftercare"],
		);
		assert.deepEqual(
			cardKinds({
				status: "reviewing",
				upcomingSession: true,
				finishedWork: false,
			}),
			["inquiry_received", "booking_confirmation", "session_reminder"],
		);
	});

	test("a declined or cancelled project offers none", ({ assert }) => {
		for (const status of ["declined", "cancelled"] as const) {
			assert.deepEqual(
				cardKinds({ status, upcomingSession: true, finishedWork: true }),
				[],
				status,
			);
		}
	});
});

test.group("defaultCardKind", () => {
	test("starts on what the project's status most likely needs", ({
		assert,
	}) => {
		assert.equal(
			defaultCardKind("reviewing", [
				"inquiry_received",
				"booking_confirmation",
				"session_reminder",
			]),
			"inquiry_received",
		);
		assert.equal(
			defaultCardKind("booked", [
				"booking_confirmation",
				"session_reminder",
				"aftercare",
			]),
			"booking_confirmation",
		);
		assert.equal(
			defaultCardKind("in_progress", [
				"booking_confirmation",
				"session_reminder",
				"aftercare",
			]),
			"aftercare",
		);
		assert.equal(
			defaultCardKind("deposit_pending", [
				"booking_confirmation",
				"session_reminder",
			]),
			"session_reminder",
		);
		assert.isNull(defaultCardKind("quoted", []));
	});
});

test.group("cardValues", () => {
	test("names the next session and its artist, and 'your artist' when there is none", ({
		assert,
	}) => {
		const facts = {
			clientName: " Sita Rai",
			studioName: "Black Needle",
			studioAddress: null,
			projectArtistName: null,
			session: { whenText: "Mon 2 Nov 2026, 15:45–17:45", artistName: "Asha" },
		};

		assert.deepEqual(cardValues("inquiry_received", facts), {
			client_name: "Sita",
			studio_name: "Black Needle",
		});
		assert.deepEqual(cardValues("session_reminder", facts), {
			client_name: "Sita",
			studio_name: "Black Needle",
			artist_name: "Asha",
			session_time: "Mon 2 Nov 2026, 15:45–17:45",
			studio_address: "",
		});
		assert.deepEqual(cardValues("aftercare", facts), {
			client_name: "Sita",
			studio_name: "Black Needle",
			artist_name: "your artist",
		});
		assert.equal(
			cardValues("booking_confirmation", {
				...facts,
				session: { whenText: "x", artistName: null },
			}).artist_name,
			"your artist",
		);
	});
});
```

In `apps/platform/tests/functional/projects/project_page.spec.ts`, add the imports

```ts
import { chatLinks } from "#modules/clients/contact_links";
import { sessionTimeText } from "#modules/scheduling/times";
```

and append at the end of the file:

```ts
test.group("Project page: Message the client (TAT-52)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("a project under review offers the received message and the plain links", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(
				tenant,
				await makeClient(tenant, { name: "Sita Rai", phone: "+9779812345678" }),
			),
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		const text =
			"Hi Sita, thank you for your tattoo inquiry to Black Needle. We have your idea and will reply here soon.";
		assert.deepEqual(props.contact, {
			whatsappUrl: "https://wa.me/9779812345678",
			viberUrl: "viber://chat?number=%2B9779812345678",
			callUrl: "tel:+9779812345678",
		});
		assert.deepEqual(props.messages, [
			{
				kind: "inquiry_received",
				label: "Inquiry received",
				text,
				whatsappUrl: chatLinks("+9779812345678", text).whatsapp,
				viberUrl: "viber://chat?number=%2B9779812345678",
			},
		]);
		assert.equal(props.messageKind, "inquiry_received");
	});

	test("a project at work names its next session, and a finished one adds aftercare", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const start = DateTime.now().plus({ days: 3 }).startOf("hour");
		const done = DateTime.now().minus({ days: 2 }).startOf("hour");
		const project = await inTenant(tenant, async () => {
			const artist = await makeArtist(tenant);
			const project = await makeProject(
				tenant,
				await makeClient(tenant, { name: "Ram Thapa" }),
				{ status: "in_progress", artistId: artist.id },
			);
			await makeSession(tenant, project, artist, {
				status: "completed",
				startsAt: done,
				endsAt: done.plus({ hours: 2 }),
			});
			await makeSession(tenant, project, artist, {
				startsAt: start,
				endsAt: start.plus({ hours: 2 }),
			});
			return project;
		});

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.deepEqual(
			props.messages.map(({ kind }: { kind: string }) => kind),
			["booking_confirmation", "session_reminder", "aftercare"],
		);
		assert.equal(props.messageKind, "aftercare");
		const when = sessionTimeText(start, start.plus({ hours: 2 }), KTM);
		assert.equal(
			props.messages[0].text,
			`Hi Ram, your session at Black Needle is booked for ${when} with Sita. Reply here if you need to change it.`,
		);
		assert.match(
			props.messages[2].text,
			/^Hi Ram, thank you for your tattoo at Black Needle!/,
		);
	});

	test("without a phone there is nothing to tap", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const project = await inTenant(tenant, async () =>
			makeProject(
				tenant,
				await makeClient(tenant, { phone: null, anonymizedAt: DateTime.utc() }),
			),
		);

		const props = (
			await client.get(page(project.id)).withInertia().loginAs(owner)
		).inertiaProps;

		assert.isNull(props.contact);
		assert.deepEqual(props.messages, []);
		assert.isNull(props.messageKind);
	});
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=chat.spec.ts --files=project_messages.spec.ts > <scratchpad>/red.log 2>&1; echo $?` → `124`, `Cannot find module` for `#modules/notifications/chat`. Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts` → the 3 new tests FAIL (`props.contact` is undefined).

- [ ] **Step 3: The chat and card helpers**

Create `apps/platform/app/modules/notifications/chat.ts`:

```ts
import { chatLinks, telLink } from "#modules/clients/contact_links";

/** A chat message and the links that send it: WhatsApp prefilled, Viber to paste (TAT-64's shape). */
export type ChatMessage = { text: string; whatsappUrl: string; viberUrl: string };

/**
 * `text` as a chat message to `phone`: the client's stored E.164 number,
 * never anything typed. The text only ever goes in WhatsApp's `text` query,
 * percent-encoded as UTF-8.
 */
export function chatMessage(text: string, phone: string): ChatMessage {
	const links = chatLinks(phone, text);
	return { text, whatsappUrl: links.whatsapp, viberUrl: links.viber };
}

/** One-tap links to `phone` without a message: a WhatsApp chat, a Viber chat and a call. */
export type ContactLinks = {
	whatsappUrl: string;
	viberUrl: string;
	callUrl: string;
};

export function contactLinks(phone: string): ContactLinks {
	const links = chatLinks(phone);
	return {
		whatsappUrl: links.whatsapp,
		viberUrl: links.viber,
		callUrl: telLink(phone),
	};
}
```

Create `apps/platform/app/modules/notifications/project_messages.ts`:

```ts
import {
	firstName,
	type MessageValues,
} from "#modules/notifications/messages";
import type { ProjectStatus } from "#modules/projects/models/tattoo_project";

/**
 * The messages the project page's "Message the client" card offers
 * (TAT-52). The quote and the deposit link have their own cards (TAT-64,
 * TAT-65), so they are not here.
 */
export const CARD_KINDS = [
	"inquiry_received",
	"booking_confirmation",
	"session_reminder",
	"aftercare",
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

const CLOSED: readonly ProjectStatus[] = ["declined", "cancelled"];

/** What the card needs to know about the project. */
export type CardState = {
	status: ProjectStatus;
	/** A scheduled session that hasn't started yet. */
	upcomingSession: boolean;
	/** A completed tattoo or touch-up session. */
	finishedWork: boolean;
};

/** The card's messages now, in lifecycle order (spec ruling 16). */
export function cardKinds({
	status,
	upcomingSession,
	finishedWork,
}: CardState): CardKind[] {
	if (CLOSED.includes(status)) return [];
	const kinds: CardKind[] = [];
	if (status === "reviewing") kinds.push("inquiry_received");
	if (upcomingSession) kinds.push("booking_confirmation", "session_reminder");
	if (finishedWork) kinds.push("aftercare");
	return kinds;
}

/** The message the card starts on (spec ruling 25), or null when it offers none. */
export function defaultCardKind(
	status: ProjectStatus,
	kinds: readonly CardKind[],
): CardKind | null {
	let order: CardKind[] = [
		"aftercare",
		"session_reminder",
		"booking_confirmation",
		"inquiry_received",
	];
	if (status === "reviewing") {
		order = [
			"inquiry_received",
			"booking_confirmation",
			"session_reminder",
			"aftercare",
		];
	} else if (status === "booked") {
		order = [
			"booking_confirmation",
			"session_reminder",
			"aftercare",
			"inquiry_received",
		];
	}
	return order.find((kind) => kinds.includes(kind)) ?? null;
}

/** Who the card's messages are about. */
export type CardFacts = {
	clientName: string;
	studioName: string;
	studioAddress: string | null;
	/** The project's artist, for aftercare; null without one. */
	projectArtistName: string | null;
	/** The next session's time text and artist, for the confirmation and the reminder. */
	session: { whenText: string; artistName: string | null } | null;
};

/** Who a message names when it has no artist to name. */
export const ANY_ARTIST = "your artist";

/** The placeholder values of one card message (spec ruling 18). */
export function cardValues(kind: CardKind, facts: CardFacts): MessageValues {
	const base = {
		client_name: firstName(facts.clientName),
		studio_name: facts.studioName,
	};
	if (kind === "inquiry_received") return base;
	if (kind === "aftercare") {
		return { ...base, artist_name: facts.projectArtistName ?? ANY_ARTIST };
	}
	return {
		...base,
		artist_name: facts.session?.artistName ?? ANY_ARTIST,
		session_time: facts.session?.whenText ?? "",
		studio_address: facts.studioAddress ?? "",
	};
}
```

- [ ] **Step 4: The project page's props**

In `apps/platform/app/controllers/projects_controller.ts`:

Replace the import `import { chatLinks } from "#modules/clients/contact_links";` with

```ts
import { chatMessage, contactLinks } from "#modules/notifications/chat";
import { MESSAGE_LABELS, renderMessage } from "#modules/notifications/messages";
import {
	cardKinds,
	cardValues,
	defaultCardKind,
} from "#modules/notifications/project_messages";
```

In `show()`, right before `return ctx.inertia.render("projects/show", {`, add:

```ts
		// "Message the client" (TAT-52): one-tap links for a client with a
		// phone, and the messages this project offers now. The confirmation
		// and the reminder name the next session still to come.
		const phone = client?.phone ?? null;
		const upcoming =
			scheduled.find(
				({ startsAt }) => startsAt.toMillis() > now.toMillis(),
			) ?? null;
		const cardMessages = cardKinds({
			status: project.status,
			upcomingSession: upcoming !== null,
			finishedWork: sessions.some(
				({ status, kind }) => status === "completed" && kind !== "consultation",
			),
		});
		const facts = {
			clientName: client?.name ?? "",
			studioName: tenant.name,
			studioAddress: tenant.address,
			projectArtistName: artist?.name ?? null,
			session: upcoming
				? {
						whenText: sessionTimeText(
							upcoming.startsAt,
							upcoming.endsAt,
							timezone,
						),
						artistName:
							artists.find(({ id }) => id === upcoming.artistId)?.name ?? null,
					}
				: null,
		};
```

In the render object, right after the `message:` prop (it ends with `: null,` after the `messageProps(…)` call), add:

```ts
			contact: phone ? contactLinks(phone) : null,
			messages: phone
				? cardMessages.map((kind) => ({
						kind,
						label: MESSAGE_LABELS[kind],
						...chatMessage(
							renderMessage(kind, texts[kind], cardValues(kind, facts)),
							phone,
						),
					}))
				: [],
			messageKind: phone ? defaultCardKind(project.status, cardMessages) : null,
```

Replace

```ts
					? await this.depositPanel(tenant, project, client)
```

with

```ts
					? await this.depositPanel(tenant, project, client, texts.deposit_link)
```

In `depositPanel`, replace the parameter list

```ts
		tenant: Tenant,
		project: TattooProject,
		client: Pick<Client, "name" | "phone"> | null,
	) {
```

with

```ts
		tenant: Tenant,
		project: TattooProject,
		client: Pick<Client, "name" | "phone"> | null,
		depositTemplate: string,
	) {
```

and in its body replace

```ts
							depositMessage({
								clientName: client.name,
								studioName: tenant.name,
								dueText: formatMoney(due),
								referenceCode: link.referenceCode,
								url,
							}),
```

with

```ts
							depositMessage(
								{
									clientName: client.name,
									studioName: tenant.name,
									dueText: formatMoney(due),
									referenceCode: link.referenceCode,
									url,
								},
								depositTemplate,
							),
```

Finally delete the local helper at the bottom of the file (its doc comment and body):

```ts
/** A chat message and the links that send it: WhatsApp prefilled, Viber to paste. */
function chatMessage(text: string, phone: string) {
	const links = chatLinks(phone, text);
	return { text, whatsappUrl: links.whatsapp, viberUrl: links.viber };
}
```

`messageProps` now calls the imported `chatMessage`.

- [ ] **Step 5: The components**

Create `apps/platform/inertia/components/chat_message.tsx`:

```tsx
import { cn } from "cn";
import { toast } from "sonner";
import type {
	ContactChannelName,
	ContactLinksProps,
} from "~/components/messages";
import type { ChatMessageProps } from "~/components/projects";
import { Button, buttonVariants } from "~/components/ui/button";

const LINK = cn(buttonVariants({ variant: "outline" }), "h-11");

/**
 * A chat message with its one-tap links (TAT-64, TAT-52): WhatsApp opens
 * with it filled in; Viber's link can't carry text, so staff copy it and
 * paste. Every tap tells the page its channel, which records the contact.
 */
export default function ChatMessage({
	message,
	onSent,
}: {
	message: ChatMessageProps;
	onSent: (channel: ContactChannelName) => void;
}) {
	const copy = () => {
		navigator.clipboard.writeText(message.text).then(
			() => {
				toast.success("Message copied.");
				onSent("copy");
			},
			() => toast.error("Couldn't copy: select the text instead."),
		);
	};

	return (
		<div className="flex flex-col gap-3 rounded-md border p-3">
			<p className="text-sm break-words whitespace-pre-line">{message.text}</p>
			<div className="flex flex-wrap gap-2">
				<a
					href={message.whatsappUrl}
					target="_blank"
					rel="noreferrer"
					onClick={() => onSent("whatsapp")}
					className={LINK}
				>
					Send on WhatsApp
				</a>
				<a
					href={message.viberUrl}
					onClick={() => onSent("viber")}
					className={LINK}
				>
					Open Viber chat
				</a>
				<Button type="button" variant="ghost" className="h-11" onClick={copy}>
					Copy message
				</Button>
			</div>
			<p className="text-xs text-muted-foreground">
				Viber opens the chat empty: copy the message first, then paste it
				there.
			</p>
		</div>
	);
}

/** One-tap links to the client without a message: a WhatsApp chat, a Viber chat and a call. */
export function ChatLinks({
	contact,
	onSent,
}: {
	contact: ContactLinksProps;
	onSent: (channel: ContactChannelName) => void;
}) {
	return (
		<div className="flex flex-wrap gap-2">
			<a
				href={contact.whatsappUrl}
				target="_blank"
				rel="noreferrer"
				onClick={() => onSent("whatsapp")}
				className={LINK}
			>
				WhatsApp
			</a>
			<a
				href={contact.viberUrl}
				onClick={() => onSent("viber")}
				className={LINK}
			>
				Viber
			</a>
			<a
				href={contact.callUrl}
				onClick={() => onSent("call")}
				className={LINK}
			>
				Call
			</a>
		</div>
	);
}
```

Create `apps/platform/inertia/components/message_card.tsx`:

```tsx
import { useState } from "react";
import ChatMessage, { ChatLinks } from "~/components/chat_message";
import type {
	CardMessageProps,
	ContactLinksProps,
	ContactVia,
	MessageKindName,
} from "~/components/messages";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Field, FieldLabel } from "~/components/ui/field";

/**
 * "Message the client" (TAT-52): the messages a project or an inquiry
 * offers now, each sent in one tap, and plain links to a chat or a call.
 * Every tap goes to `onContact`, which records the last contact.
 */
export default function MessageCard({
	contact,
	messages,
	initialKind,
	onContact,
	footer,
}: {
	contact: ContactLinksProps | null;
	messages: CardMessageProps[];
	initialKind: MessageKindName | null;
	onContact: (via: ContactVia) => void;
	/** Shown under the links, e.g. the inquiry's last contact. */
	footer?: string;
}) {
	const [kind, setKind] = useState(initialKind);
	const selected =
		messages.find((message) => message.kind === kind) ?? messages[0] ?? null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Message the client</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{contact === null ? (
					<p className="text-sm text-muted-foreground">
						This client has no phone number to message.
					</p>
				) : (
					<>
						{messages.length > 1 && (
							<Field>
								<FieldLabel htmlFor="message-kind">Message</FieldLabel>
								<select
									id="message-kind"
									value={selected?.kind}
									onChange={(event) =>
										setKind(event.target.value as MessageKindName)
									}
									className="h-11 min-w-0 rounded-md border bg-transparent px-3 text-sm"
								>
									{messages.map((message) => (
										<option key={message.kind} value={message.kind}>
											{message.label}
										</option>
									))}
								</select>
							</Field>
						)}
						{messages.length === 1 && selected && (
							<p className="text-sm font-medium">{selected.label}</p>
						)}
						{selected && (
							<ChatMessage
								message={selected}
								onSent={(channel) =>
									onContact({ channel, kind: selected.kind })
								}
							/>
						)}
						<div className="flex flex-col gap-2">
							<p className="text-sm text-muted-foreground">
								{messages.length > 0
									? "Or open a chat without a message:"
									: "Open a chat with the client:"}
							</p>
							<ChatLinks
								contact={contact}
								onSent={(channel) => onContact({ channel })}
							/>
						</div>
					</>
				)}
				{footer && <p className="text-sm text-muted-foreground">{footer}</p>}
			</CardContent>
		</Card>
	);
}
```

In `apps/platform/inertia/components/projects.ts`, add the import

```ts
import type {
	CardMessageProps,
	ContactLinksProps,
	MessageKindName,
} from "~/components/messages";
```

and in `ProjectPageProps`, right after `message: ChatMessageProps | null;`, add:

```ts
	/** One-tap links to the client without a message; null without a phone (TAT-52). */
	contact: ContactLinksProps | null;
	/** The messages the "Message the client" card offers now (TAT-52). */
	messages: CardMessageProps[];
	/** The message the card starts on. */
	messageKind: MessageKindName | null;
```

- [ ] **Step 6: The page**

In `apps/platform/inertia/pages/projects/show.tsx`:

1. In the `~/components/projects` import, remove `type ChatMessageProps,`. Add the imports:

```ts
import ChatMessage from "~/components/chat_message";
import MessageCard from "~/components/message_card";
import type { ContactChannelName, ContactVia } from "~/components/messages";
```

2. In `ProjectShow`'s destructured props, after `message,` add `contact,`, `messages,` and `messageKind,`.

3. Replace

```tsx
	// The chat links and "Copy message" record the contact in the background.
	const markContacted = () =>
		router.post(
			urlFor("tenant.projects.contacted.store", params),
			{},
			{ preserveScroll: true, preserveState: true },
		);
```

with

```tsx
	// Every chat link, Call and "Copy message" record the contact in the
	// background (TAT-46), with the channel and the message (TAT-52).
	const markContacted = (via: ContactVia = {}) =>
		router.post(urlFor("tenant.projects.contacted.store", params), via, {
			preserveScroll: true,
			preserveState: true,
		});
```

4. Replace `<ContactLine text={contactedText} onMark={markContacted} />` with `<ContactLine text={contactedText} onMark={() => markContacted()} />` (an `onClick` handler gets the click event: passing `markContacted` itself would post the event as the body).

5. Right after the status card's closing `</Card>` (the card holding the status badge, `ContactLine`, `MoveButtons` and `ArtistField`), add:

```tsx
				<MessageCard
					contact={contact}
					messages={messages}
					initialKind={messageKind}
					onContact={markContacted}
				/>
```

6. In the Quote card, replace

```tsx
						{message && (
							<ChatMessage message={message} onSent={markContacted} />
						)}
```

with

```tsx
						{message && (
							<ChatMessage
								message={message}
								onSent={(channel) => markContacted({ channel, kind: "quote" })}
							/>
						)}
```

7. Replace

```tsx
					<DepositCard
						projectId={project.id}
						deposit={deposit}
						onSent={markContacted}
					/>
```

with

```tsx
					<DepositCard
						projectId={project.id}
						deposit={deposit}
						onSent={(channel) =>
							markContacted({ channel, kind: "deposit_link" })
						}
					/>
```

and in `DepositCard`'s props type replace `onSent: () => void;` with `onSent: (channel: ContactChannelName) => void;`.

8. Delete the page's own `ChatMessage` function and its doc comment (from `/**\n * The quote as a chat message: WhatsApp opens with it filled in; Viber's\n * link can't carry text, so staff copy it and paste.\n */` through that function's closing brace, right above `DepositCard`'s doc comment). `DepositCard` keeps rendering `<ChatMessage message={message} onSent={onSent} />`, now the shared component.

- [ ] **Step 7: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=chat.spec.ts --files=project_messages.spec.ts --files=contact_links.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=project_page.spec.ts --files=deposit_links_http.spec.ts --files=message_templates_http.spec.ts`.
Expected: PASS (3 + 4 unit tests, 3 new page tests; every TAT-64 and TAT-65 message assertion unchanged). Then `typecheck`: clean (the inertia project too).

- [ ] **Step 8: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/notifications/chat.ts apps/platform/app/modules/notifications/project_messages.ts apps/platform/app/controllers/projects_controller.ts apps/platform/inertia/components/chat_message.tsx apps/platform/inertia/components/message_card.tsx apps/platform/inertia/components/projects.ts apps/platform/inertia/pages/projects/show.tsx apps/platform/tests/unit/modules/notifications/chat.spec.ts apps/platform/tests/unit/modules/notifications/project_messages.spec.ts apps/platform/tests/functional/projects/project_page.spec.ts
git -C <repo> add apps/platform/app/modules/notifications/chat.ts apps/platform/app/modules/notifications/project_messages.ts apps/platform/app/controllers/projects_controller.ts apps/platform/inertia/components/chat_message.tsx apps/platform/inertia/components/message_card.tsx apps/platform/inertia/components/projects.ts apps/platform/inertia/pages/projects/show.tsx apps/platform/tests/unit/modules/notifications/chat.spec.ts apps/platform/tests/unit/modules/notifications/project_messages.spec.ts apps/platform/tests/functional/projects/project_page.spec.ts
git -C <repo> commit -m "feat(platform): message the client in one tap from every project" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The inquiry page and the inbox list

**Files:**
- Modify: `apps/platform/app/controllers/inquiries_controller.ts` (`index`, `show`)
- Modify: `apps/platform/inertia/components/inquiries.ts`, `apps/platform/inertia/pages/inquiries/show.tsx`, `apps/platform/inertia/pages/inquiries/index.tsx`
- Test: `apps/platform/tests/functional/inquiries/inbox.spec.ts` (add to the TAT-52 group)

**Interfaces:**
- Page `inquiries/show` gains `contact: ContactLinksProps | null`, `message: CardMessageProps | null` (the "received" message while the inquiry is `new` and the client has a phone) and `contactedText: string`. Each `inquiries/index` row gains `contactedText: string | null`.

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/inquiries/inbox.spec.ts`, add `import { chatLinks } from "#modules/clients/contact_links";`, and inside `test.group("Inbox contact (TAT-52)", …)`, after its first test, add:

```ts
	test("a new inquiry's page offers the received message to the client's phone", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(
				tenant,
				await makeClient(tenant, { name: "Sita Rai", phone: "+9779812345678" }),
			),
		);

		const props = (
			await client
				.get(inbox(`/${inquiry.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;

		const text =
			"Hi Sita, thank you for your tattoo inquiry to Black Needle. We have your idea and will reply here soon.";
		assert.deepEqual(props.message, {
			kind: "inquiry_received",
			label: "Inquiry received",
			text,
			whatsappUrl: chatLinks("+9779812345678", text).whatsapp,
			viberUrl: "viber://chat?number=%2B9779812345678",
		});
		assert.deepEqual(props.contact, {
			whatsappUrl: "https://wa.me/9779812345678",
			viberUrl: "viber://chat?number=%2B9779812345678",
			callUrl: "tel:+9779812345678",
		});
		assert.equal(props.contactedText, "never contacted");
	});

	test("the inbox shows the last contact; a decided inquiry keeps only the plain links", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const { fresh, quiet, declined } = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			return {
				fresh: await makeInquiry(tenant, customer),
				quiet: await makeInquiry(tenant, customer),
				declined: await makeInquiry(tenant, customer, {
					status: "declined",
					decidedAt: DateTime.utc(),
				}),
			};
		});
		await client
			.post(inbox(`/${fresh.id}/contacted`))
			.form({ channel: "whatsapp", kind: "inquiry_received" })
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		const rows = (await client.get(inbox()).withInertia().loginAs(owner))
			.inertiaProps.inquiries;
		const row = (id: string) =>
			rows.find((candidate: { id: string }) => candidate.id === id);
		assert.equal(
			row(fresh.id).contactedText,
			"contacted today on WhatsApp (Inquiry received)",
		);
		assert.isNull(row(quiet.id).contactedText);

		const shown = (
			await client
				.get(inbox(`/${declined.id}`))
				.withInertia()
				.loginAs(owner)
		).inertiaProps;
		assert.isNull(shown.message);
		assert.isNotNull(shown.contact);
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=inbox.spec.ts`
Expected: the 2 new tests FAIL (`props.message` and `contactedText` are undefined).

- [ ] **Step 3: The controller**

In `apps/platform/app/controllers/inquiries_controller.ts`:

Add the imports (Biome orders them):

```ts
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { chatMessage, contactLinks } from "#modules/notifications/chat";
import {
	firstName,
	MESSAGE_LABELS,
	renderMessage,
} from "#modules/notifications/messages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import MessageTemplateService from "#modules/notifications/services/message_template_service";
```

and change `import { daysAgoText } from "#modules/projects/contact";` to `import { daysAgoText, lastContactText } from "#modules/projects/contact";`.

Replace the constructor with:

```ts
	constructor(
		private inquiries: InquiryService,
		private projects: ProjectService,
		private artists: ArtistService,
		private images: ImageService,
		private clients: ClientService,
		private templates: MessageTemplateService,
	) {}
```

In `index`, in each row, after `projectId: projectIds.get(inquiry.id) ?? null,` add:

```ts
				// The last contact (TAT-52): a new inquiry staff already answered.
				contactedText: inquiry.lastContactedAt
					? lastContactText(inquiry.lastContactedAt, tenant.timezone, {
							channel: inquiry.lastContactChannel,
							kind: inquiry.lastContactKind,
						})
					: null,
```

In `show`, right before `return ctx.inertia.render("inquiries/show", {`, add:

```ts
		// "Message the client" (TAT-52): the client's stored phone (an owner
		// may have corrected it since), and while the inquiry is new the
		// "received" message, greeting the name it was sent with.
		const client = await this.clients.find(tenant, inquiry.clientId);
		const phone = client?.phone ?? null;
		const texts = await this.templates.textsFor(tenant);
```

and in the render object, after `projectId,` add:

```ts
			contact: phone ? contactLinks(phone) : null,
			message:
				phone && inquiry.status === "new"
					? {
							kind: "inquiry_received" as const,
							label: MESSAGE_LABELS.inquiry_received,
							...chatMessage(
								renderMessage("inquiry_received", texts.inquiry_received, {
									client_name: firstName(inquiry.contactName),
									studio_name: tenant.name,
								}),
								phone,
							),
						}
					: null,
			contactedText: lastContactText(inquiry.lastContactedAt, tenant.timezone, {
				channel: inquiry.lastContactChannel,
				kind: inquiry.lastContactKind,
			}),
```

- [ ] **Step 4: The pages**

In `apps/platform/inertia/components/inquiries.ts`, add the import

```ts
import type {
	CardMessageProps,
	ContactLinksProps,
} from "~/components/messages";
```

in `InquiryRow`, after `projectId: string | null;`, add:

```ts
	/** The last contact ("contacted today on WhatsApp (Inquiry received)"); null when never (TAT-52). */
	contactedText: string | null;
```

and in `InquiryPageProps`, after `projectId: string | null;`, add:

```ts
	/** One-tap links to the client without a message; null without a phone (TAT-52). */
	contact: ContactLinksProps | null;
	/** The "received" message while the inquiry is new. */
	message: CardMessageProps | null;
	contactedText: string;
```

In `apps/platform/inertia/pages/inquiries/show.tsx`, add the imports

```ts
import MessageCard from "~/components/message_card";
import type { ContactVia } from "~/components/messages";
```

add `contact,`, `message,` and `contactedText,` to `InquiryShow`'s destructured props, and right after `const tenant = useTenant();` add:

```tsx
	// The chat links record the contact in the background (TAT-52).
	const markContacted = (via: ContactVia = {}) =>
		router.post(
			urlFor("tenant.inbox.contacted.store", {
				tenant: tenant.slug,
				id: inquiry.id,
			}),
			via,
			{ preserveScroll: true, preserveState: true },
		);
```

Then replace

```tsx
				<Card>
					<CardHeader>
						<CardTitle>References</CardTitle>
```

with

```tsx
				<MessageCard
					contact={contact}
					messages={message ? [message] : []}
					initialKind={message?.kind ?? null}
					onContact={markContacted}
					footer={contactedText}
				/>

				<Card>
					<CardHeader>
						<CardTitle>References</CardTitle>
```

In `apps/platform/inertia/pages/inquiries/index.tsx`, replace

```tsx
											{inquiry.references > 0 &&
												` · ${inquiry.references} reference${inquiry.references === 1 ? "" : "s"}`}
										</span>
									</>
```

with

```tsx
											{inquiry.references > 0 &&
												` · ${inquiry.references} reference${inquiry.references === 1 ? "" : "s"}`}
										</span>
										{inquiry.contactedText && (
											<span className="text-sm text-muted-foreground">
												{inquiry.contactedText}
											</span>
										)}
									</>
```

- [ ] **Step 5: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=inbox.spec.ts --files=inquiry_service.spec.ts`
Expected: PASS (2 new tests; the old inbox tests unchanged). Then `typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/controllers/inquiries_controller.ts apps/platform/inertia/components/inquiries.ts apps/platform/inertia/pages/inquiries/show.tsx apps/platform/inertia/pages/inquiries/index.tsx apps/platform/tests/functional/inquiries/inbox.spec.ts
git -C <repo> add apps/platform/app/controllers/inquiries_controller.ts apps/platform/inertia/components/inquiries.ts apps/platform/inertia/pages/inquiries/show.tsx apps/platform/inertia/pages/inquiries/index.tsx apps/platform/tests/functional/inquiries/inbox.spec.ts
git -C <repo> commit -m "feat(platform): answer a new inquiry in one tap and show its last contact in the inbox" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: New-inquiry alerts from the worker

**Files:**
- Modify: `apps/platform/start/env.ts`, `apps/platform/.env.test`, `apps/platform/.env.example`, `apps/platform/start/mail.ts`, `apps/platform/start/view.ts`
- Modify: `apps/platform/app/modules/tenancy/services/tenancy_service.ts` (`find`, `members`)
- Modify: `apps/platform/app/modules/notifications/alerts.ts` (replace Task 3's two lines with the whole file)
- Create: `apps/platform/app/services/mail_in_transaction.ts`
- Create: `apps/platform/app/modules/notifications/emails/new_inquiry_mail.ts`, `new_inquiry.edge`, `new_inquiry_text.edge`
- Create: `apps/platform/app/modules/notifications/services/alert_service.ts`
- Modify: `apps/platform/app/modules/inquiries/jobs/new_inquiry_alert_job.ts`
- Test: `apps/platform/tests/unit/modules/notifications/alerts.spec.ts`, `apps/platform/tests/unit/modules/notifications/new_inquiry_mail.spec.ts`, `apps/platform/tests/functional/notifications/alert_service.spec.ts`, `apps/platform/tests/functional/notifications/new_inquiry_alert_flow.spec.ts` (create); `apps/platform/tests/functional/inquiries/new_inquiry_alert_job.spec.ts` (add a test)

**Interfaces:**
- `#modules/notifications/alerts`: `ALERT_KINDS`, `AlertKind`, `EXCERPT_LENGTH` (140), `excerpt(text, max?)`, `type AlertMember`, `type AlertRecipient`, `inquiryRecipients(members, preferredUserId)`, `inquiryIntro({ clientName, studioName, artistName, askedForYou })`, `newInquirySubject(studioName)`, `dashboardUrl(appUrl, path)`, `alertCopy(kind, isOwner)`, `alertTimeText(at, timezone, now?)`, `alertTarget(alert, role)`.
- `TenancyService.find(tenantId): Promise<Tenant | null>`; `TenancyService.members(tenant): Promise<TenantMember[]>` with `type TenantMember = { userId; role: MembershipRole; email; fullName: string | null }`.
- `sendMailInTransaction(email: BaseMail, trx): Promise<void>` (`#services/mail_in_transaction`).
- `NewInquiryMail(data: NewInquiryMailData)`, `type NewInquiryMailData = { to; recipientName; studioName; intro; excerpt; url: string | null }`.
- `AlertService` (`@inject()`: `TenancyService`, `ArtistService`): `newInquiry(tenant, inquiry: Pick<Inquiry, "id" | "contactName" | "idea" | "preferredArtistId">, options?: { emails?: boolean }): Promise<string[]>` (the users alerted by this call); `ALERTS_PER_PAGE`.
- Env: `ALERT_EMAILS` (`Env.schema.boolean.optional()`).

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/modules/notifications/alerts.spec.ts`:

```ts
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	alertCopy,
	alertTarget,
	alertTimeText,
	dashboardUrl,
	excerpt,
	inquiryIntro,
	inquiryRecipients,
	newInquirySubject,
} from "#modules/notifications/alerts";

const KTM = "Asia/Kathmandu";

test.group("excerpt", () => {
	test("short text is kept, with its whitespace collapsed", ({ assert }) => {
		assert.equal(excerpt("A koi  on\nthe calf"), "A koi on the calf");
		assert.equal(excerpt("x".repeat(140)), "x".repeat(140));
	});

	test("long text is cut at a word, or at the limit, with an ellipsis", ({
		assert,
	}) => {
		const long =
			"A fine-line peony with two leaves wrapping around the wrist, shaded softly, with a tiny bee near the stem and some dots like pollen falling down towards the hand";
		assert.equal(
			excerpt(long),
			"A fine-line peony with two leaves wrapping around the wrist, shaded softly, with a tiny bee near the stem and some dots like pollen falling…",
		);
		assert.equal(excerpt("x".repeat(150)), `${"x".repeat(140)}…`);
	});

	test("never cuts a Devanagari syllable or an emoji in half", ({
		assert,
	}) => {
		assert.equal(excerpt("नमस्ते ".repeat(30), 10), "नमस्ते नमस्ते…");
		assert.equal(excerpt("नमस्तेनमस्तेनमस्तेनमस्ते", 4), "नमस्तेन…");
		assert.equal(excerpt("🙏🏽".repeat(5), 3), "🙏🏽🙏🏽🙏🏽…");
	});
});

test.group("new-inquiry alerts", () => {
	test("every owner, then the asked-for artist's member, each once", ({
		assert,
	}) => {
		const owner = { userId: "u-owner", role: "owner", email: "o@x.test", fullName: "Ram" };
		const second = { userId: "u-second", role: "owner", email: "s@x.test", fullName: null };
		const asha = { userId: "u-asha", role: "artist", email: "a@x.test", fullName: "Asha" };
		const other = { userId: "u-other", role: "artist", email: "x@x.test", fullName: null };
		const members = [owner, asha, second, other];
		const who = (preferred: string | null) =>
			inquiryRecipients(members, preferred).map(({ userId, askedForYou }) => [
				userId,
				askedForYou,
			]);

		assert.deepEqual(who(null), [
			["u-owner", false],
			["u-second", false],
		]);
		assert.deepEqual(who("u-asha"), [
			["u-owner", false],
			["u-second", false],
			["u-asha", true],
		]);
		assert.deepEqual(who("u-second"), [
			["u-owner", false],
			["u-second", true],
		]);
		assert.deepEqual(who("u-stranger"), [
			["u-owner", false],
			["u-second", false],
		]);
	});

	test("the email's intro, subject and link", ({ assert }) => {
		const intro = (over: Partial<Parameters<typeof inquiryIntro>[0]>) =>
			inquiryIntro({
				clientName: "Sita Rai",
				studioName: "Black Needle",
				artistName: null,
				askedForYou: false,
				...over,
			});

		assert.equal(
			intro({ artistName: "Asha", askedForYou: true }),
			"Sita sent Black Needle a new tattoo inquiry and asked for you:",
		);
		assert.equal(
			intro({ artistName: "Asha" }),
			"Sita sent Black Needle a new tattoo inquiry and asked for Asha:",
		);
		assert.equal(intro({}), "Sita sent Black Needle a new tattoo inquiry:");
		assert.equal(
			intro({ clientName: "  " }),
			"A client sent Black Needle a new tattoo inquiry:",
		);
		assert.equal(newInquirySubject("Black Needle"), "New inquiry for Black Needle");
		assert.equal(
			dashboardUrl("https://app.example.com", "/t/black-needle/inbox/abc"),
			"https://app.example.com/t/black-needle/inbox/abc",
		);
		assert.equal(
			dashboardUrl("http://localhost:3401/", "/t/x/inbox/1"),
			"http://localhost:3401/t/x/inbox/1",
		);
	});

	test("the in-app line and where opening it goes", ({ assert }) => {
		assert.deepEqual(alertCopy("new_inquiry", true), {
			title: "New inquiry",
			detail: "Open it in the inbox.",
		});
		assert.deepEqual(alertCopy("new_inquiry", false), {
			title: "A new inquiry asks for you",
			detail: "An owner reviews it in the inbox.",
		});
		assert.deepEqual(
			alertTarget({ kind: "new_inquiry", inquiryId: "i-1" }, "owner"),
			{ route: "tenant.inbox.show", id: "i-1" },
		);
		assert.isNull(
			alertTarget({ kind: "new_inquiry", inquiryId: "i-1" }, "artist"),
		);
		assert.isNull(alertTarget({ kind: "new_inquiry", inquiryId: null }, "owner"));
	});

	test("when it came, in the studio's timezone", ({ assert }) => {
		const now = DateTime.fromISO("2026-10-19T10:00:00Z");
		const at = (iso: string) => DateTime.fromISO(iso);

		assert.equal(alertTimeText(at("2026-10-19T08:00:00Z"), KTM, now), "Today, 13:45");
		// 20:00 UTC on 18 Oct is 01:45 on 19 Oct in Kathmandu.
		assert.equal(alertTimeText(at("2026-10-18T20:00:00Z"), KTM, now), "Today, 01:45");
		assert.equal(alertTimeText(at("2026-10-18T20:00:00Z"), "UTC", now), "Yesterday, 20:00");
		assert.equal(alertTimeText(at("2026-10-18T05:00:00Z"), KTM, now), "Yesterday, 10:45");
		assert.equal(alertTimeText(at("2026-10-01T05:00:00Z"), KTM, now), "1 Oct, 10:45");
		assert.equal(alertTimeText(at("2025-12-31T05:00:00Z"), KTM, now), "31 Dec 2025, 10:45");
	});
});
```

Create `apps/platform/tests/unit/modules/notifications/new_inquiry_mail.spec.ts`:

```ts
import { test } from "@japa/runner";
import NewInquiryMail, {
	type NewInquiryMailData,
} from "#modules/notifications/emails/new_inquiry_mail";

// A dashboard link carries a query string in no case today; the & still
// proves the HTML escapes and the text version doesn't.
const owner: NewInquiryMailData = {
	to: "owner@black-needle.example",
	recipientName: "Ram Thapa",
	studioName: "Black Needle",
	intro: "Sita sent Black Needle a new tattoo inquiry and asked for Asha:",
	excerpt: "A koi on the calf",
	url: "https://app.tattoo-drip.test/t/black-needle/inbox/0190?x=1&y=2",
};

async function render(data: NewInquiryMailData) {
	const mail = new NewInquiryMail(data);
	await mail.buildWithContents();
	return mail.message;
}

test.group("NewInquiryMail", () => {
	test("goes to the member, with no client data in the subject and no from", async ({
		assert,
	}) => {
		const message = await render(owner);

		message.assertTo("owner@black-needle.example");
		message.assertSubject("New inquiry for Black Needle");
		// config/mail.ts fills in the platform's from address when sending.
		assert.isUndefined(message.nodeMailerMessage.from);
	});

	test("an owner's email quotes the idea and links the inquiry", async () => {
		const message = await render(owner);

		message.assertHtmlIncludes("<!DOCTYPE html>");
		message.assertHtmlIncludes("Hi Ram Thapa,");
		message.assertHtmlIncludes(
			"Sita sent Black Needle a new tattoo inquiry and asked for Asha:",
		);
		message.assertHtmlIncludes("A koi on the calf");
		message.assertHtmlIncludes(
			'href="https://app.tattoo-drip.test/t/black-needle/inbox/0190?x=1&amp;y=2"',
		);
		message.assertHtmlIncludes(
			"You get these emails as a member of Black Needle on Tattoo Drip.",
		);
		message.assertTextIncludes(
			"Open the inquiry: https://app.tattoo-drip.test/t/black-needle/inbox/0190?x=1&y=2",
		);
	});

	test("the asked-for artist's email has no inbox link", async ({ assert }) => {
		const message = await render({ ...owner, recipientName: null, url: null });

		message.assertHtmlIncludes("Hi there,");
		message.assertHtmlIncludes(
			"An owner of Black Needle will review it in the inbox.",
		);
		message.assertTextIncludes(
			"An owner of Black Needle will review it in the inbox.",
		);
		const html = String(message.nodeMailerMessage.html);
		assert.notInclude(html, "Open the inquiry");
		assert.notInclude(html, "null");
	});

	test("escapes the client's words in the HTML and keeps them as typed in the text", async ({
		assert,
	}) => {
		const message = await render({
			...owner,
			excerpt: '<b>koi</b> & "waves"',
		});

		message.assertHtmlIncludes("&lt;b&gt;koi&lt;/b&gt; &amp;");
		assert.notInclude(String(message.nodeMailerMessage.html), "<b>koi</b>");
		message.assertTextIncludes('"<b>koi</b> & "waves""');
	});
});
```

Create `apps/platform/tests/functional/notifications/alert_service.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import db from "@adonisjs/lucid/services/db";
import queue from "@adonisjs/queue/services/main";
import { test } from "@japa/runner";
import type { SendMailPayload } from "#jobs/send_mail_job";
import User from "#models/user";
import ArtistService from "#modules/artists/services/artist_service";
import ImageService from "#modules/media/services/image_service";
import StaffAlert from "#modules/notifications/models/staff_alert";
import AlertService from "#modules/notifications/services/alert_service";
import type Tenant from "#modules/tenancy/models/tenant";
import TenantMembership from "#modules/tenancy/models/tenant_membership";
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import env from "#start/env";
import { makeArtist, makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const alerts = new AlertService(
	new TenancyService(),
	new ArtistService(new ImageService()),
);

type Fake = ReturnType<typeof queue.fake>;

/** The emails the fake queue holds: SendMailJob payloads. */
const mails = (fake: Fake) =>
	fake
		.getPushedJobs()
		.filter(({ job }) => job.name === "SendMailJob")
		.map(({ job }) => job.payload as SendMailPayload);

/** Who the emails go to, sorted. */
const recipients = (fake: Fake) =>
	mails(fake)
		.map(({ mailMessage }) => String(mailMessage.message.to?.[0]))
		.sort();

/** The template data of the email to `email`. */
const mailTo = (fake: Fake, email: string) =>
	mails(fake).find(({ mailMessage }) => mailMessage.message.to?.[0] === email)
		?.mailMessage.views.html?.data;

/** The users alerted about `inquiryId`, sorted. */
const alertedUsers = (tenant: { id: string }, inquiryId: string) =>
	inTenant(tenant, async () =>
		(await StaffAlert.query().where("inquiry_id", inquiryId))
			.map(({ userId }) => userId)
			.sort(),
	);

/** A member of `tenant` with `role`. */
async function memberIn(
	tenant: Tenant,
	email: string,
	role: "owner" | "artist",
) {
	const user = await User.create({ email, password: "secret-password" });
	await inTenant(tenant, () =>
		TenantMembership.create({ tenantId: tenant.id, userId: user.id, role }),
	);
	return user;
}

/** An artist profile in `tenant`, linked to `user` (or to nobody). */
const profileIn = (
	tenant: Tenant,
	slug: string,
	name: string,
	user: { id: string } | null,
) =>
	inTenant(tenant, async () => {
		const profile = await makeArtist(tenant, slug);
		profile.name = name;
		profile.userId = user?.id ?? null;
		await profile.save();
		return profile;
	});

const removeMembership = (tenant: Tenant, user: { id: string }) =>
	inTenant(tenant, async () =>
		(
			await TenantMembership.query().where("user_id", user.id).firstOrFail()
		).softDelete(),
	);

test.group("AlertService.newInquiry", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => queue.restore());

	test("a new inquiry alerts every live owner and the asked-for artist's member, once each", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-52");
		const second = await memberIn(tenant, "second@alerts-52.example", "owner");
		const removed = await memberIn(tenant, "removed@alerts-52.example", "owner");
		await removeMembership(tenant, removed);
		const asha = await artistIn(tenant, "asha@alerts-52.example");
		await artistIn(tenant, "ram@alerts-52.example");
		const profile = await profileIn(tenant, "asha", "Asha", asha);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant, { name: "Sita Rai" }), {
				preferredArtistId: profile.id,
			}),
		);
		const fake = queue.fake();

		const alerted = await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);

		const expected = [owner.id, second.id, asha.id].sort();
		assert.deepEqual([...alerted].sort(), expected);
		assert.deepEqual(await alertedUsers(tenant, inquiry.id), expected);
		assert.deepEqual(
			recipients(fake),
			[owner.email, second.email, asha.email].sort(),
		);
	});

	test("the asked-for artist's email has no inbox link; an owner's links the inquiry", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-link-52", "Ink Link");
		const asha = await artistIn(tenant, "asha@alerts-link-52.example");
		const profile = await profileIn(tenant, "asha", "Asha", asha);
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant, { name: "Sita Rai" }), {
				preferredArtistId: profile.id,
			}),
		);
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);

		assert.deepInclude(mailTo(fake, owner.email), {
			studioName: "Ink Link",
			intro: "Sita sent Ink Link a new tattoo inquiry and asked for Asha:",
			url: new URL(
				`/t/alerts-link-52/inbox/${inquiry.id}`,
				env.get("APP_URL"),
			).toString(),
		});
		assert.deepInclude(mailTo(fake, asha.email), {
			intro: "Sita sent Ink Link a new tattoo inquiry and asked for you:",
			url: null,
		});
	});

	test("a repeated run adds no alert and queues no second email", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-again-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const fake = queue.fake();

		const first = await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);
		const second = await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);

		assert.deepEqual(first, [owner.id]);
		assert.deepEqual(second, []);
		assert.deepEqual(await alertedUsers(tenant, inquiry.id), [owner.id]);
		assert.deepEqual(recipients(fake), [owner.email]);
	});

	test("an email is queued only with its alert: a rollback leaves neither", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-rollback-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		// The real queue: a SendMailJob row's data carries the address.
		const queued = async () =>
			Number(
				(
					await db
						.from("queue_jobs")
						.where("data", "like", `%${owner.email}%`)
						.count("* as total")
				)[0].total,
			);

		await inTenant(tenant, () =>
			assert.rejects(
				() =>
					withTransaction(async () => {
						await alerts.newInquiry(tenant, inquiry, { emails: true });
						throw new Error("rolled back");
					}),
				/rolled back/,
			),
		);
		assert.deepEqual(await alertedUsers(tenant, inquiry.id), []);
		assert.equal(await queued(), 0);

		await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);
		assert.deepEqual(await alertedUsers(tenant, inquiry.id), [owner.id]);
		assert.equal(await queued(), 1);
	});

	test("with emails off, the alerts are made and no email is queued", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-off-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: false }),
		);

		assert.deepEqual(await alertedUsers(tenant, inquiry.id), [owner.id]);
		assert.deepEqual(mails(fake), []);
	});

	test("a deleted, unlinked or foreign preferred artist alerts the owners only", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alerts-only-52");
		const { owner: stranger, tenant: theirs } =
			await studioWithOwner("alerts-other-52");
		const asha = await artistIn(tenant, "asha@alerts-only-52.example");
		const deleted = await profileIn(tenant, "gone", "Gone", asha);
		await inTenant(tenant, () => deleted.softDelete());
		const unlinked = await profileIn(tenant, "loose", "Loose", null);
		// Linked to a user who belongs to another studio only.
		const foreign = await profileIn(tenant, "foreign", "Foreign", stranger);
		const inquiries = await inTenant(tenant, async () => {
			const customer = await makeClient(tenant);
			const made = [];
			for (const profile of [deleted, unlinked, foreign]) {
				made.push(
					await makeInquiry(tenant, customer, { preferredArtistId: profile.id }),
				);
			}
			return made;
		});

		for (const inquiry of inquiries) {
			assert.deepEqual(
				await inTenant(tenant, () =>
					alerts.newInquiry(tenant, inquiry, { emails: false }),
				),
				[owner.id],
			);
		}
		assert.lengthOf(await inTenant(theirs, () => StaffAlert.query()), 0);
	});

	test("the email carries the first name and the start of the idea, never the phone, email, budget or last name", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner("alerts-content-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(
				tenant,
				await makeClient(tenant, {
					name: "Sita Rai",
					phone: "+9779811112222",
					email: "sita@private.example",
				}),
				{
					budget: "NPR 99,999",
					idea: `A koi on the calf ${"with waves ".repeat(30)}`,
				},
			),
		);
		const fake = queue.fake();

		await inTenant(tenant, () =>
			alerts.newInquiry(tenant, inquiry, { emails: true }),
		);

		const [payload] = mails(fake);
		assert.equal(
			payload?.mailMessage.message.subject,
			"New inquiry for Black Needle",
		);
		const data = payload?.mailMessage.views.html?.data;
		assert.equal(data.intro, "Sita sent Black Needle a new tattoo inquiry:");
		assert.isTrue(data.excerpt.startsWith("A koi on the calf with waves"));
		assert.isAtMost(Array.from(data.excerpt as string).length, 141);
		const everything = JSON.stringify(payload);
		for (const secret of [
			"9811112222",
			"sita@private.example",
			"99,999",
			"Rai",
		]) {
			assert.notInclude(everything, secret, secret);
		}
	});

	test("TenancyService.members: live members with their account's email, oldest first", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("members-52");
		const asha = await artistIn(tenant, "asha@members-52.example");
		const gone = await artistIn(tenant, "gone@members-52.example");
		await removeMembership(tenant, gone);

		assert.deepEqual(
			await inTenant(tenant, () => new TenancyService().members(tenant)),
			[
				{ userId: owner.id, role: "owner", email: owner.email, fullName: null },
				{ userId: asha.id, role: "artist", email: asha.email, fullName: null },
			],
		);
	});
});
```

Create `apps/platform/tests/functional/notifications/new_inquiry_alert_flow.spec.ts`:

```ts
import emitter from "@adonisjs/core/services/emitter";
import testUtils from "@adonisjs/core/services/test_utils";
import mail from "@adonisjs/mail/services/main";
import { test } from "@japa/runner";
import StaffAlert from "#modules/notifications/models/staff_alert";
import { intakeFields, postInquiry } from "#tests/helpers/intake";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";
import { processQueued } from "#tests/helpers/worker";

test.group("New-inquiry alert through the worker", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => {
		mail.restore();
		emitter.restore();
	});

	test("an intake's alert reaches the owner's mailbox and the dashboard", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner(
			"alert-flow-52",
			"Alert Flow",
		);
		mail.fake();
		const events = emitter.fake(["mail:sent"]);

		const response = await postInquiry(client, "alert-flow-52", intakeFields());
		response.assertStatus(201);
		const { id } = response.body().data;

		// NewInquiryAlertJob, then the SendMailJob it queued.
		await processQueued();

		const sent = events.find("mail:sent");
		assert.exists(sent);
		assert.include(JSON.stringify(sent?.data.message.to), owner.email);
		assert.equal(sent?.data.message.subject, "New inquiry for Alert Flow");
		assert.include(
			String(sent?.data.message.html),
			"Maya sent Alert Flow a new tattoo inquiry:",
		);
		assert.include(String(sent?.data.message.text), "Open the inquiry: ");
		assert.lengthOf(
			await inTenant(tenant, () =>
				StaffAlert.query().where("inquiry_id", id),
			),
			1,
		);
	});
});
```

In `apps/platform/tests/functional/inquiries/new_inquiry_alert_job.spec.ts`, add the imports

```ts
import queue from "@adonisjs/queue/services/main";
import StaffAlert from "#modules/notifications/models/staff_alert";
```

after `group.each.setup(() => testUtils.db().wrapInGlobalTransaction());` add `group.each.teardown(() => queue.restore());`, and add at the end of the group:

```ts
	test("alerts the studio's owner through AlertService, once however often it runs", async ({
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner("alert-job-52");
		const inquiry = await inTenant(tenant, async () =>
			makeInquiry(tenant, await makeClient(tenant)),
		);
		const fake = queue.fake();

		await run({ tenantId: tenant.id, inquiryId: inquiry.id });
		await run({ tenantId: tenant.id, inquiryId: inquiry.id });

		const rows = await inTenant(tenant, () =>
			StaffAlert.query().where("inquiry_id", inquiry.id),
		);
		assert.deepEqual(
			rows.map(({ userId }) => userId),
			[owner.id],
		);
		assert.lengthOf(
			fake.getPushedJobs().filter(({ job }) => job.name === "SendMailJob"),
			1,
		);
	});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 120 pnpm -C <repo>/apps/platform test unit --files=alerts.spec.ts --files=new_inquiry_mail.spec.ts > <scratchpad>/red.log 2>&1; echo $?` → `124` ("does not provide an export named 'alertCopy'" or `Cannot find module` for the mail). Then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 timeout 180 pnpm -C <repo>/apps/platform test functional --files=alert_service.spec.ts --files=new_inquiry_alert_flow.spec.ts --files=new_inquiry_alert_job.spec.ts > <scratchpad>/red2.log 2>&1; echo $?` → `124` with `Cannot find module` for `#modules/notifications/services/alert_service`.

- [ ] **Step 3: The setting**

In `apps/platform/start/env.ts`, replace

```ts
	SMTP_PASSWORD: Env.schema.string.optional(),
});
```

with

```ts
	SMTP_PASSWORD: Env.schema.string.optional(),
	// Staff alert emails (TAT-52): unset or true sends them; false keeps the
	// alerts in the dashboard only (until the sending domain exists, TAT-20).
	ALERT_EMAILS: Env.schema.boolean.optional(),
});
```

Append to `apps/platform/.env.test`:

```
# Staff alert emails on (TAT-52): tests queue them on the fake or in the
# test's transaction and never send real mail. A developer's
# ALERT_EMAILS=false must not turn them off here.
ALERT_EMAILS=true
```

In `apps/platform/.env.example`, after the line `SMTP_PASSWORD=`, add:

```
# Staff alert emails (TAT-52): unset or true sends them (Mailpit catches them
# in development); false keeps alerts in the dashboard only. Keep it false in
# production until the platform's sending domain is set up (TAT-20).
# ALERT_EMAILS=false
```

In `apps/platform/start/mail.ts`, add the imports

```ts
import logger from "@adonisjs/core/services/logger";
import env from "#start/env";
```

and append:

```ts
// Said once per process, at boot: alerts still reach the dashboard (TAT-52).
if (env.get("ALERT_EMAILS") === false) {
	logger.warn(
		"Staff alert emails are off (ALERT_EMAILS=false): new inquiries alert the dashboard only.",
	);
}
```

In `apps/platform/start/view.ts`, append:

```ts
edge.mount("notifications", app.makePath("app/modules/notifications"));
```

- [ ] **Step 4: Members for the jobs**

In `apps/platform/app/modules/tenancy/services/tenancy_service.ts`, change `import type User from "#models/user";` to `import User from "#models/user";`, after the `DepositSettings` type add:

```ts
/** A live member and their account's address: who an alert can reach (TAT-52). */
export type TenantMember = {
	userId: string;
	role: MembershipRole;
	email: string;
	fullName: string | null;
};
```

and right after the `hasTenant` method (it ends with `return membership !== null;\n\t}`) add:

```ts
	/** The live tenant with this id, or null: what a job, which carries only the id, reads (TAT-52). */
	async find(tenantId: string): Promise<Tenant | null> {
		return Tenant.query().where("id", tenantId).first();
	}

	/**
	 * The tenant's live members with their account's email and name, oldest
	 * membership first: the people a staff alert can reach (TAT-52).
	 */
	async members(tenant: { id: string }): Promise<TenantMember[]> {
		const memberships = await TenantMembership.query()
			.where("tenant_id", tenant.id)
			.orderBy("created_at", "asc")
			.orderBy("id", "asc");
		if (memberships.length === 0) return [];
		const users = await User.query().whereIn(
			"id",
			memberships.map(({ userId }) => userId),
		);
		const byId = new Map(users.map((user) => [user.id, user]));
		return memberships.flatMap((membership) => {
			const user = byId.get(membership.userId);
			return user
				? [
						{
							userId: user.id,
							role: membership.role,
							email: user.email,
							fullName: user.fullName,
						},
					]
				: [];
		});
	}
```

- [ ] **Step 5: The pure alert helpers**

Replace the whole of `apps/platform/app/modules/notifications/alerts.ts` with:

```ts
import { DateTime } from "luxon";
import { firstName } from "#modules/notifications/messages";

/** What a staff alert is about (TAT-52). The deposit-proof alert is a follow-up (spec ruling 12). */
export const ALERT_KINDS = ["new_inquiry"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

/** How much of the idea a new-inquiry email quotes, in characters as people count them. */
export const EXCERPT_LENGTH = 140;

const GRAPHEMES = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * The start of `text` for an email (spec ruling 5): whitespace collapsed,
 * at most `max` graphemes (never half a Devanagari syllable or an emoji),
 * cut at a word when one ends in the second half, then "…".
 */
export function excerpt(text: string, max: number = EXCERPT_LENGTH): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const parts = Array.from(GRAPHEMES.segment(flat), ({ segment }) => segment);
	if (parts.length <= max) return flat;
	const cut = parts.slice(0, max).join("");
	const space = cut.lastIndexOf(" ");
	const kept = space > cut.length / 2 ? cut.slice(0, space) : cut;
	return `${kept.trimEnd()}…`;
}

/** A member an alert can reach: TenancyService.members' shape. */
export type AlertMember = {
	userId: string;
	role: string;
	email: string;
	fullName: string | null;
};

/** A recipient, and whether the client asked for them. */
export type AlertRecipient = AlertMember & { askedForYou: boolean };

/**
 * Who hears about a new inquiry (spec ruling 3): every owner, then the
 * member linked to the inquiry's live preferred artist when they aren't an
 * owner; each once. `preferredUserId` is that artist's user, or null.
 */
export function inquiryRecipients(
	members: readonly AlertMember[],
	preferredUserId: string | null,
): AlertRecipient[] {
	const asked = (member: AlertMember) =>
		preferredUserId !== null && member.userId === preferredUserId;
	const owners = members.filter(({ role }) => role === "owner");
	const preferred = members.find(
		(member) => asked(member) && member.role !== "owner",
	);
	return [...owners, ...(preferred ? [preferred] : [])].map((member) => ({
		...member,
		askedForYou: asked(member),
	}));
}

/** The email's first line: "Sita sent Black Needle a new tattoo inquiry and asked for you:". */
export function inquiryIntro({
	clientName,
	studioName,
	artistName,
	askedForYou,
}: {
	clientName: string;
	studioName: string;
	artistName: string | null;
	askedForYou: boolean;
}): string {
	const who = firstName(clientName) || "A client";
	let asked = "";
	if (askedForYou) asked = " and asked for you";
	else if (artistName) asked = ` and asked for ${artistName}`;
	return `${who} sent ${studioName} a new tattoo inquiry${asked}:`;
}

/** The subject: no client data, because SendMailJob.failed() logs it. */
export function newInquirySubject(studioName: string): string {
	return `New inquiry for ${studioName}`;
}

/** An absolute dashboard address for an email: `path` on `appUrl` (APP_URL). */
export function dashboardUrl(appUrl: string, path: string): string {
	return new URL(path, appUrl).toString();
}

type AlertLine = { title: string; detail: string };

const LINES: Record<AlertKind, { owner: AlertLine; other: AlertLine }> = {
	new_inquiry: {
		owner: { title: "New inquiry", detail: "Open it in the inbox." },
		other: {
			title: "A new inquiry asks for you",
			detail: "An owner reviews it in the inbox.",
		},
	},
};

/** The Alerts list's line for an alert. No client data: a row holds ids only (spec ruling 5). */
export function alertCopy(kind: AlertKind, isOwner: boolean): AlertLine {
	return isOwner ? LINES[kind].owner : LINES[kind].other;
}

/**
 * When an alert came, in the studio's timezone: "Today, 14:05",
 * "Yesterday, 09:12", "12 Oct, 09:12", "12 Oct 2025, 09:12".
 */
export function alertTimeText(
	at: DateTime,
	timezone: string,
	now: DateTime = DateTime.now(),
): string {
	const local = at.setZone(timezone).setLocale("en-GB");
	const today = now.setZone(timezone);
	const time = local.toFormat("HH:mm");
	if (local.hasSame(today, "day")) return `Today, ${time}`;
	if (local.hasSame(today.minus({ days: 1 }), "day")) {
		return `Yesterday, ${time}`;
	}
	if (local.hasSame(today, "year")) return `${local.toFormat("d LLL")}, ${time}`;
	return `${local.toFormat("d LLL yyyy")}, ${time}`;
}

/**
 * Where opening an alert goes (spec ruling 10): an owner's new-inquiry
 * alert opens its inquiry; anything else stays on the list. Computed from
 * the row and the member's current role, never from the request.
 */
export function alertTarget(
	alert: { kind: AlertKind; inquiryId: string | null },
	role: string,
): { route: "tenant.inbox.show"; id: string } | null {
	if (alert.kind === "new_inquiry" && alert.inquiryId && role === "owner") {
		return { route: "tenant.inbox.show", id: alert.inquiryId };
	}
	return null;
}
```

- [ ] **Step 6: Mail in a transaction, and the email**

Create `apps/platform/app/services/mail_in_transaction.ts`:

```ts
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import type { BaseMail } from "@adonisjs/mail";
import SendMailJob from "#jobs/send_mail_job";
import { dispatchInTransaction } from "#services/queue";
import env from "#start/env";

/**
 * Queues `email` for the worker inside `trx` (TAT-52): what mail.sendLater
 * does (start/mail.ts queues a SendMailJob), except that the job exists only
 * if `trx` commits. A TenantJob uses it to send one email per row it
 * inserts, so a retried job never sends twice. The mail class never sets
 * `from`: config/mail.ts adds it when the worker sends.
 */
export async function sendMailInTransaction(
	email: BaseMail,
	trx: TransactionClientContract,
): Promise<void> {
	await email.build();
	await dispatchInTransaction(
		SendMailJob.dispatch({
			mailerName: env.get("MAIL_MAILER"),
			mailMessage: email.message.toObject(),
		}),
		trx,
	);
}
```

Create `apps/platform/app/modules/notifications/emails/new_inquiry_mail.ts`:

```ts
import { BaseMail } from "@adonisjs/mail";
import { newInquirySubject } from "#modules/notifications/alerts";

/** What the email shows: plain values, because queued mail is JSON until the worker renders it. */
export type NewInquiryMailData = {
	to: string;
	recipientName: string | null;
	studioName: string;
	/** inquiryIntro's sentence. */
	intro: string;
	/** excerpt() of the idea. */
	excerpt: string;
	/** The inquiry on the dashboard, for owners; null for the asked-for artist, who can't open the inbox. */
	url: string | null;
};

/**
 * Tells a member about a new inquiry (TAT-52): the client's first name, the
 * start of the idea and, for owners, the link to the inquiry. Never the
 * phone, the email address, the budget or the references (spec ruling 5);
 * the subject has no client data, because SendMailJob.failed() logs it.
 */
export default class NewInquiryMail extends BaseMail {
	constructor(private data: NewInquiryMailData) {
		super();
		this.subject = newInquirySubject(data.studioName);
	}

	prepare() {
		const { to, ...view } = this.data;
		this.message
			.to(to)
			.htmlView("notifications::emails/new_inquiry", view)
			.textView("notifications::emails/new_inquiry_text", view);
	}
}
```

Create `apps/platform/app/modules/notifications/emails/new_inquiry.edge`:

```edge
@email.layout({ title: 'New inquiry', preheader: 'A new tattoo inquiry is waiting.' })
  <p style="margin: 0 0 16px;">Hi {{ recipientName || 'there' }},</p>
  <p style="margin: 0 0 16px;">{{ intro }}</p>
  <p style="margin: 0 0 16px; padding: 12px 16px; border-left: 3px solid #e4e4e7; color: #3f3f46;">{{ excerpt }}</p>
  @if(url)
    @!email.button({ href: url, text: 'Open the inquiry' })
  @else
    <p style="margin: 0 0 16px;">An owner of {{ studioName }} will review it in the inbox.</p>
  @end
  <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
    You get these emails as a member of {{ studioName }} on Tattoo Drip.
  </p>
@end
```

Create `apps/platform/app/modules/notifications/emails/new_inquiry_text.edge`:

```edge
Hi {{{ recipientName || 'there' }}},

{{{ intro }}}

"{{{ excerpt }}}"

@if(url)
Open the inquiry: {{{ url }}}
@else
An owner of {{{ studioName }}} will review it in the inbox.
@end

You get these emails as a member of {{{ studioName }}} on Tattoo Drip.
```

- [ ] **Step 7: The service and the job**

Create `apps/platform/app/modules/notifications/services/alert_service.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import type Inquiry from "#modules/inquiries/models/inquiry";
import {
	dashboardUrl,
	excerpt,
	inquiryIntro,
	inquiryRecipients,
} from "#modules/notifications/alerts";
import NewInquiryMail from "#modules/notifications/emails/new_inquiry_mail";
import type Tenant from "#modules/tenancy/models/tenant";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import TenancyService from "#modules/tenancy/services/tenancy_service";
import { withTransaction } from "#services/db_context";
import { sendMailInTransaction } from "#services/mail_in_transaction";
import env from "#start/env";

type TenantRef = Pick<Tenant, "id">;

/** Alerts per page on the Alerts page. */
export const ALERTS_PER_PAGE = 25;

export type AlertOptions = {
	/** Queue the emails; ALERT_EMAILS by default (unset is on). */
	emails?: boolean;
};

/**
 * Staff alerts (TAT-52): made by the jobs that learn of an event, read by
 * each member on the Alerts page. A row holds ids only (spec ruling 5).
 */
@inject()
export default class AlertService {
	constructor(
		private tenancy: TenancyService,
		private artists: ArtistService,
	) {}

	/**
	 * Alerts the studio's owners, and the member linked to the inquiry's live
	 * preferred artist, to a new inquiry (NewInquiryAlertJob). Each member
	 * gets one alert and one email, once: the unique (user_id, inquiry_id)
	 * and `on conflict do nothing` make a repeated run add nothing, and each
	 * email is queued in the same transaction as its alert. Returns the users
	 * alerted by this call.
	 */
	async newInquiry(
		tenant: TenantRef,
		inquiry: Pick<Inquiry, "id" | "contactName" | "idea" | "preferredArtistId">,
		options: AlertOptions = {},
	): Promise<string[]> {
		const studio = await this.tenancy.find(tenant.id);
		if (!studio) return [];
		const members = await this.tenancy.members(tenant);
		const artist = inquiry.preferredArtistId
			? (await this.artists.list(tenant)).find(
					({ id }) => id === inquiry.preferredArtistId,
				)
			: undefined;
		const recipients = inquiryRecipients(members, artist?.userId ?? null);
		const emails = options.emails ?? env.get("ALERT_EMAILS") !== false;

		return withTransaction(async (trx) => {
			const inserted = await insertAlerts(
				trx,
				tenant,
				inquiry.id,
				recipients.map(({ userId }) => userId),
			);
			const alerted = recipients.filter(({ userId }) => inserted.has(userId));
			if (emails) {
				for (const recipient of alerted) {
					await sendMailInTransaction(
						new NewInquiryMail({
							to: recipient.email,
							recipientName: recipient.fullName,
							studioName: studio.name,
							intro: inquiryIntro({
								clientName: inquiry.contactName,
								studioName: studio.name,
								artistName: artist?.name ?? null,
								askedForYou: recipient.askedForYou,
							}),
							excerpt: excerpt(inquiry.idea),
							url:
								recipient.role === "owner"
									? dashboardUrl(
											env.get("APP_URL"),
											`/t/${studio.slug}/inbox/${inquiry.id}`,
										)
									: null,
						}),
						trx,
					);
				}
			}
			return alerted.map(({ userId }) => userId);
		});
	}
}

/** Inserts one new-inquiry alert per user, skipping those that exist; returns the users inserted now. */
async function insertAlerts(
	trx: TransactionClientContract,
	tenant: TenantRef,
	inquiryId: string,
	userIds: string[],
): Promise<Set<string>> {
	if (userIds.length === 0) return new Set();
	const { rows } = await trx.rawQuery(
		`insert into staff_alerts (tenant_id, user_id, kind, inquiry_id, created_at)
		 values ${userIds.map(() => "(?, ?, 'new_inquiry', ?, now())").join(", ")}
		 on conflict do nothing
		 returning user_id`,
		userIds.flatMap((userId) => [tenant.id, userId, inquiryId]),
	);
	return new Set((rows as { user_id: string }[]).map((row) => row.user_id));
}
```

Replace the whole of `apps/platform/app/modules/inquiries/jobs/new_inquiry_alert_job.ts` with:

```ts
import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import Inquiry from "#modules/inquiries/models/inquiry";
import AlertService from "#modules/notifications/services/alert_service";
import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string; inquiryId: string };

/**
 * Alerts a studio's staff to a new inquiry. IntakeService.submit (TAT-51)
 * queues it in the inquiry's transaction, so it exists exactly when the
 * inquiry does. It logs the two ids, then AlertService.newInquiry alerts
 * the owners and the preferred artist's member in the dashboard and by
 * email (TAT-52), once each however often the job runs. An inquiry that is
 * gone or already decided needs no alert.
 */
export default class NewInquiryAlertJob extends TenantJob<Payload> {
	protected async handle() {
		const { tenantId, inquiryId } = this.payload;
		const inquiry = await Inquiry.query()
			.where("tenant_id", tenantId)
			.where("id", inquiryId)
			.first();
		if (!inquiry || inquiry.status !== "new") return;
		logger.info({ tenantId, inquiryId }, "New inquiry received.");
		const alerts = await app.container.make(AlertService);
		await alerts.newInquiry({ id: tenantId }, inquiry);
	}

	async failed(error: Error): Promise<void> {
		const { jobId } = this.context;
		const { tenantId, inquiryId } = this.payload;
		logger.error(
			{ err: error, jobId, tenantId, inquiryId },
			"Alerting staff to a new inquiry failed.",
		);
	}
}
```

- [ ] **Step 8: Run them to see them pass**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=alerts.spec.ts --files=new_inquiry_mail.spec.ts --files=templates_in_build.spec.ts --files=job_classes.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=alert_service.spec.ts --files=new_inquiry_alert_flow.spec.ts --files=new_inquiry_alert_job.spec.ts --files=inquiries.spec.ts --files=intake_service.spec.ts`.
Expected: PASS (7 + 4 unit, 8 + 1 + 1 functional; TAT-51's job and intake tests unchanged). Then `typecheck`: clean.

- [ ] **Step 9: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/start/env.ts apps/platform/start/mail.ts apps/platform/start/view.ts apps/platform/app/modules/tenancy/services/tenancy_service.ts apps/platform/app/modules/notifications apps/platform/app/services/mail_in_transaction.ts apps/platform/app/modules/inquiries/jobs/new_inquiry_alert_job.ts apps/platform/tests/unit/modules/notifications apps/platform/tests/functional/notifications apps/platform/tests/functional/inquiries/new_inquiry_alert_job.spec.ts
git -C <repo> add apps/platform/start/env.ts apps/platform/.env.test apps/platform/.env.example apps/platform/start/mail.ts apps/platform/start/view.ts apps/platform/app/modules/tenancy/services/tenancy_service.ts apps/platform/app/modules/notifications apps/platform/app/services/mail_in_transaction.ts apps/platform/app/modules/inquiries/jobs/new_inquiry_alert_job.ts apps/platform/tests/unit/modules/notifications apps/platform/tests/functional/notifications apps/platform/tests/functional/inquiries/new_inquiry_alert_job.spec.ts
git -C <repo> commit -m "feat(platform): alert owners and the asked-for artist to new inquiries" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Alerts in the dashboard

**Files:**
- Modify: `apps/platform/app/modules/notifications/services/alert_service.ts` (`list`, `unreadCount`, `open`, `markAllRead`)
- Create: `apps/platform/app/controllers/alerts_controller.ts`
- Create: `apps/platform/inertia/pages/alerts/index.tsx`, `apps/platform/inertia/components/shell/alerts_link.tsx`
- Modify: `apps/platform/start/routes.ts` (the `/alerts` group), `apps/platform/app/middleware/inertia_middleware.ts` (`alertCount`), `apps/platform/inertia/components/shell/top_bar.tsx`, `apps/platform/inertia/components/shell/side_nav.tsx`
- Modify: `apps/platform/tests/helpers/tenants.ts` (the `alert` fixture), `apps/platform/tests/isolation/cases.ts` (three cases), `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts` (the area)
- Regenerated: `apps/platform/.adonisjs/`
- Test: `apps/platform/tests/functional/notifications/alerts_http.spec.ts` (create)

**Interfaces:**
- `AlertService.list(tenant, userId, page): Promise<{ alerts: StaffAlert[]; total; lastPage }>`, `unreadCount(tenant, userId): Promise<number>`, `open(tenant, userId, id): Promise<StaffAlert>` (E_ROW_NOT_FOUND for anyone else's), `markAllRead(tenant, userId): Promise<void>`.
- Page `alerts/index`, props `{ alerts: { id, title, detail, whenText, unread }[]; unread: number; page: { current, last, total } }`. Shared prop `alertCount: number | null`.
- `Studio.alert` (twoStudios): an unread `new_inquiry` alert of the owner about `newInquiry`.

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/notifications/alerts_http.spec.ts`:

```ts
import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import StaffAlert from "#modules/notifications/models/staff_alert";
import { makeClient, makeInquiry } from "#tests/helpers/pipeline";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

const alertsPage = (rest = "") => `/t/black-needle/alerts${rest}`;

/** An alert of `userId` about a fresh inquiry. */
async function alertFor(
	tenant: { id: string },
	userId: string,
	over: { readAt?: DateTime } = {},
) {
	return inTenant(tenant, async () => {
		const inquiry = await makeInquiry(tenant, await makeClient(tenant));
		return StaffAlert.create({
			tenantId: tenant.id,
			userId,
			kind: "new_inquiry",
			inquiryId: inquiry.id,
			...over,
		});
	});
}

const reload = (tenant: { id: string }, alert: StaffAlert) =>
	inTenant(tenant, () => StaffAlert.findOrFail(alert.id));

test.group("Alerts", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("the list shows the member's own alerts, newest first, with unread marked", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const older = await alertFor(tenant, owner.id, { readAt: DateTime.now() });
		const newer = await alertFor(tenant, owner.id);
		await alertFor(tenant, artist.id);

		const response = await client.get(alertsPage()).withInertia().loginAs(owner);

		response.assertStatus(200);
		response.assertInertiaComponent("alerts/index");
		const props = response.inertiaProps;
		assert.deepEqual(
			props.alerts.map(({ id, unread }: { id: string; unread: boolean }) => [
				id,
				unread,
			]),
			[
				[newer.id, true],
				[older.id, false],
			],
		);
		assert.deepInclude(props.alerts[0], {
			title: "New inquiry",
			detail: "Open it in the inbox.",
		});
		assert.match(props.alerts[0].whenText, /^Today, \d\d:\d\d$/);
		assert.equal(props.unread, 1);
		assert.deepEqual(props.page, { current: 1, last: 1, total: 2 });
	});

	test("opening an owner's alert marks it read once and opens its inquiry", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const alert = await alertFor(tenant, owner.id);
		const open = () =>
			client
				.post(alertsPage(`/${alert.id}/open`))
				.withCsrfToken()
				.loginAs(owner)
				.redirects(0);

		const response = await open();

		response.assertStatus(302);
		response.assertHeader("location", `/t/black-needle/inbox/${alert.inquiryId}`);
		const read = (await reload(tenant, alert)).readAt;
		assert.isNotNull(read);
		await open();
		assert.equal(
			(await reload(tenant, alert)).readAt?.toMillis(),
			read?.toMillis(),
			"opening it again keeps its first read time",
		);
	});

	test("an artist's alert has the artist's line and opens back to the list", async ({
		client,
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const alert = await alertFor(tenant, artist.id);

		const list = (await client.get(alertsPage()).withInertia().loginAs(artist))
			.inertiaProps;
		assert.deepInclude(list.alerts[0], {
			title: "A new inquiry asks for you",
			detail: "An owner reviews it in the inbox.",
		});

		const response = await client
			.post(alertsPage(`/${alert.id}/open`))
			.withCsrfToken()
			.loginAs(artist)
			.redirects(0);
		response.assertStatus(302);
		response.assertHeader("location", alertsPage());
		assert.isNotNull((await reload(tenant, alert)).readAt);
	});

	test("another member's alert is a 404 and stays unread", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const theirs = await alertFor(tenant, artist.id);

		const response = await client
			.post(alertsPage(`/${theirs.id}/open`))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(404);
		assert.isNull((await reload(tenant, theirs)).readAt);
	});

	test("Mark all as read clears the member's own alerts only", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		const mine = [
			await alertFor(tenant, owner.id),
			await alertFor(tenant, owner.id),
		];
		const theirs = await alertFor(tenant, artist.id);

		const response = await client
			.post(alertsPage("/read"))
			.withCsrfToken()
			.loginAs(owner)
			.redirects(0);

		response.assertStatus(302);
		response.assertHeader("location", alertsPage());
		response.assertFlashMessage("success", "All alerts marked as read.");
		for (const alert of mine) {
			assert.isNotNull((await reload(tenant, alert)).readAt);
		}
		assert.isNull((await reload(tenant, theirs)).readAt);
	});

	test("the shell counts each member's own unread alerts on every tenant page", async ({
		client,
		assert,
	}) => {
		const { owner, tenant } = await studioWithOwner();
		const artist = await artistIn(tenant);
		await alertFor(tenant, owner.id);
		await alertFor(tenant, owner.id);
		await alertFor(tenant, owner.id, { readAt: DateTime.now() });
		await alertFor(tenant, artist.id);

		const ownerProps = (
			await client.get("/t/black-needle/projects").withInertia().loginAs(owner)
		).inertiaProps;
		assert.equal(ownerProps.alertCount, 2);
		const artistProps = (
			await client.get("/t/black-needle/calendar").withInertia().loginAs(artist)
		).inertiaProps;
		assert.equal(artistProps.alertCount, 1);
	});
});
```

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`, replace

```ts
		{ area: "sessions", allow: ["owner", "artist"] },
```

with

```ts
		{ area: "sessions", allow: ["owner", "artist"] },
		{ area: "alerts", allow: ["owner", "artist"] },
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=alerts_http.spec.ts --files=tenant_routes.spec.ts`
Expected: the 6 alerts tests FAIL (404s, `alertCount` undefined); the new role-guard area test fails with "expected [] not to be empty" (no route in the area yet).

- [ ] **Step 3: The service's reads and writes**

In `apps/platform/app/modules/notifications/services/alert_service.ts`, add the imports

```ts
import { DateTime } from "luxon";
import StaffAlert from "#modules/notifications/models/staff_alert";
```

after the `AlertOptions` type add:

```ts
export type AlertPage = {
	alerts: StaffAlert[];
	total: number;
	lastPage: number;
};
```

and add these methods to the class, after `newInquiry`:

```ts
	/** The member's alerts in this studio, newest first, 25 a page. */
	async list(
		tenant: TenantRef,
		userId: string,
		page: number,
	): Promise<AlertPage> {
		const result = await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.orderBy("created_at", "desc")
			.orderBy("id", "desc")
			.paginate(page, ALERTS_PER_PAGE);
		return {
			alerts: result.all(),
			total: result.total,
			lastPage: result.lastPage,
		};
	}

	/** How many of the member's alerts here are unread: the shell's count. */
	async unreadCount(tenant: TenantRef, userId: string): Promise<number> {
		const [row] = await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.whereNull("read_at")
			.count("* as total");
		return Number(row.$extras.total);
	}

	/**
	 * The member's own alert, marked read (once: its first read time stays).
	 * Another member's, another studio's or an unknown id is E_ROW_NOT_FOUND
	 * (a 404).
	 */
	async open(
		tenant: TenantRef,
		userId: string,
		id: string,
	): Promise<StaffAlert> {
		const alert = await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.where("id", id)
			.firstOrFail();
		if (alert.readAt === null) {
			alert.readAt = DateTime.now();
			await alert.save();
		}
		return alert;
	}

	/** Marks every unread alert of the member in this studio read. */
	async markAllRead(tenant: TenantRef, userId: string): Promise<void> {
		await StaffAlert.query()
			.where("tenant_id", tenant.id)
			.where("user_id", userId)
			.whereNull("read_at")
			.update({ read_at: DateTime.now().toJSDate() });
	}
```

- [ ] **Step 4: The controller, the routes and the shared count**

Create `apps/platform/app/controllers/alerts_controller.ts`:

```ts
import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	alertCopy,
	alertTarget,
	alertTimeText,
} from "#modules/notifications/alerts";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import AlertService from "#modules/notifications/services/alert_service";

/**
 * Each member's own alerts (TAT-52), owners and artists. Every read and
 * write goes through AlertService with the member's user id, so another
 * member's or another studio's alert is a 404.
 */
@inject()
export default class AlertsController {
	constructor(private alerts: AlertService) {}

	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const page = Math.max(
			1,
			Number.parseInt(String(ctx.request.qs().page ?? 1), 10) || 1,
		);
		const { alerts, total, lastPage } = await this.alerts.list(
			tenant,
			membership.userId,
			page,
		);
		const isOwner = membership.role === "owner";

		return ctx.inertia.render("alerts/index", {
			alerts: alerts.map((alert) => ({
				id: alert.id,
				...alertCopy(alert.kind, isOwner),
				whenText: alertTimeText(alert.createdAt, tenant.timezone),
				unread: alert.readAt === null,
			})),
			unread: await this.alerts.unreadCount(tenant, membership.userId),
			page: { current: page, last: lastPage, total },
		});
	}

	/** Marks the alert read and goes where it points: never a URL from the request. */
	async open(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const alert = await this.alerts.open(
			tenant,
			membership.userId,
			ctx.params.id,
		);
		const target = alertTarget(alert, membership.role);
		if (target) {
			return ctx.response
				.redirect()
				.toRoute(target.route, { tenant: tenant.slug, id: target.id });
		}
		return ctx.response
			.redirect()
			.toRoute("tenant.alerts.index", { tenant: tenant.slug });
	}

	async readAll(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		await this.alerts.markAllRead(tenant, membership.userId);
		ctx.session.flash("success", "All alerts marked as read.");
		return ctx.response
			.redirect()
			.toRoute("tenant.alerts.index", { tenant: tenant.slug });
	}
}
```

In `apps/platform/start/routes.ts`, replace

```ts
		router
			.group(() => {
				router
					.get("/", [controllers.Calendar, "index"])
					.as("tenant.calendar.index");
			})
			.prefix("/calendar")
			.use(middleware.role({ allow: ["owner", "artist"] }));
```

with

```ts
		router
			.group(() => {
				router
					.get("/", [controllers.Calendar, "index"])
					.as("tenant.calendar.index");
			})
			.prefix("/calendar")
			.use(middleware.role({ allow: ["owner", "artist"] }));

		/**
		 * Each member's own alerts (TAT-52): owners and artists; AlertService
		 * scopes every read and write to the member. Every alerts route goes
		 * in this group (a test checks).
		 */
		router
			.group(() => {
				router
					.get("/", [controllers.Alerts, "index"])
					.as("tenant.alerts.index");
				router
					.post("read", [controllers.Alerts, "readAll"])
					.as("tenant.alerts.read");
				router
					.post(":id/open", [controllers.Alerts, "open"])
					.where("id", router.matchers.uuid())
					.as("tenant.alerts.open");
			})
			.prefix("/alerts")
			.use(middleware.role({ allow: ["owner", "artist"] }));
```

In `apps/platform/app/middleware/inertia_middleware.ts`, add the import

```ts
import AlertService from "#modules/notifications/services/alert_service";
```

after the `proofCount` block add:

```ts
		// The Alerts count (TAT-52): every member's own unread alerts here.
		const alertCount =
			tenant && membership && auth?.user
				? await ensureDbContext(
						{ userId: auth.user.id, tenantId: tenant.id },
						async () =>
							(await ctx.containerResolver.make(AlertService)).unreadCount(
								tenant,
								membership.userId,
							),
					)
				: null;
```

and in the returned props, after `proofCount: ctx.inertia.always(proofCount),` add:

```ts
			/** The member's unread alerts here (TAT-52); null unless on a tenant page. */
			alertCount: ctx.inertia.always(alertCount),
```

- [ ] **Step 5: The page and the shell**

Create `apps/platform/inertia/pages/alerts/index.tsx`:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { Link } from "@inertiajs/react";
import { cn } from "cn";
import { urlFor } from "~/client";
import Page from "~/components/page";
import { Button } from "~/components/ui/button";
import { useTenant } from "~/hooks/use-tenant";
import AppLayout from "~/layouts/app";

type AlertRow = {
	id: string;
	title: string;
	detail: string;
	whenText: string;
	unread: boolean;
};

/**
 * The member's alerts (TAT-52), newest first. Opening one marks it read and
 * goes to its inquiry (owners) or stays here.
 */
export default function AlertsIndex({
	alerts,
	unread,
	page,
}: {
	alerts: AlertRow[];
	unread: number;
	page: { current: number; last: number; total: number };
}) {
	const tenant = useTenant();
	const base = urlFor("tenant.alerts.index", { tenant: tenant.slug });
	const href = (pageNumber: number) =>
		pageNumber > 1 ? `${base}?page=${pageNumber}` : base;

	return (
		<Page
			title="Alerts"
			actions={
				unread > 0 ? (
					<Form
						route="tenant.alerts.read"
						routeParams={{ tenant: tenant.slug }}
					>
						{({ processing }) => (
							<Button
								type="submit"
								variant="outline"
								className="h-11"
								disabled={processing}
							>
								{processing ? "Saving…" : "Mark all as read"}
							</Button>
						)}
					</Form>
				) : undefined
			}
		>
			{alerts.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No alerts yet. New inquiries show up here.
				</p>
			) : (
				<ul className="flex max-w-2xl flex-col divide-y rounded-md border">
					{alerts.map((alert) => (
						<li key={alert.id}>
							<Link
								href={urlFor("tenant.alerts.open", {
									tenant: tenant.slug,
									id: alert.id,
								})}
								method="post"
								as="button"
								className="flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50"
							>
								<span
									aria-hidden="true"
									className={cn(
										"mt-1.5 size-2 shrink-0 rounded-full",
										alert.unread ? "bg-primary" : "bg-transparent",
									)}
								/>
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className={cn("text-sm", alert.unread && "font-semibold")}>
										{alert.title}
										{alert.unread && <span className="sr-only"> (Unread)</span>}
									</span>
									<span className="text-sm text-muted-foreground">
										{alert.detail}
									</span>
									<span className="text-xs text-muted-foreground">
										{alert.whenText}
									</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}

			{page.last > 1 && (
				<nav aria-label="Pages" className="flex justify-between text-sm">
					{page.current > 1 ? (
						<Link href={href(page.current - 1)}>Previous</Link>
					) : (
						<span />
					)}
					{page.current < page.last ? (
						<Link href={href(page.current + 1)}>Next</Link>
					) : (
						<span />
					)}
				</nav>
			)}
		</Page>
	);
}

AlertsIndex.layout = [AppLayout];
```

Create `apps/platform/inertia/components/shell/alerts_link.tsx`:

```tsx
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { Bell } from "lucide-react";
import NavLink from "~/components/nav_link";
import NavBadge from "~/components/shell/nav_badge";
import { buttonVariants } from "~/components/ui/button";

/**
 * The way to the member's alerts (TAT-52), with their unread count
 * (`alertCount`): a bell in the phone's top bar, a row above the account
 * menu in the desktop sidebar. Not a tab: the tab bar keeps its
 * destinations. Screen readers hear "Alerts, 3 unread".
 */
export default function AlertsLink({ variant }: { variant: "icon" | "row" }) {
	const { tenant, alertCount } = usePage().props;
	if (!tenant) return null;
	const count = alertCount ?? 0;
	const params = { tenant: tenant.slug };

	if (variant === "icon") {
		return (
			<NavLink
				route="tenant.alerts.index"
				params={params}
				className={cn(
					buttonVariants({ variant: "ghost", size: "icon" }),
					"relative size-11 rounded-full aria-[current=page]:bg-accent",
				)}
			>
				<Bell aria-hidden="true" />
				<span className="sr-only">Alerts</span>
				{count > 0 && (
					<NavBadge
						count={count}
						label="unread"
						className="absolute top-1 right-0.5"
					/>
				)}
			</NavLink>
		);
	}

	return (
		<NavLink
			route="tenant.alerts.index"
			params={params}
			className={cn(
				buttonVariants({ variant: "ghost" }),
				"w-full justify-start text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
			)}
		>
			<Bell data-icon="inline-start" />
			<span className="flex-1 text-left">Alerts</span>
			{count > 0 && <NavBadge count={count} label="unread" />}
		</NavLink>
	);
}
```

In `apps/platform/inertia/components/shell/top_bar.tsx`, add `import AlertsLink from "~/components/shell/alerts_link";` and replace

```tsx
				<AccountMenu />
```

with

```tsx
				<div className="flex items-center gap-1">
					<AlertsLink variant="icon" />
					<AccountMenu />
				</div>
```

In `apps/platform/inertia/components/shell/side_nav.tsx`, add `import AlertsLink from "~/components/shell/alerts_link";` and replace

```tsx
			<div className="mt-auto">
				<AccountMenu showName />
			</div>
```

with

```tsx
			<div className="mt-auto flex flex-col gap-1">
				<AlertsLink variant="row" />
				<AccountMenu showName />
			</div>
```

- [ ] **Step 6: The fixture and three isolation cases**

In `apps/platform/tests/helpers/tenants.ts`, add `import StaffAlert from "#modules/notifications/models/staff_alert";`, and after the `newInquiry` block add:

```ts
	// An unread alert of the owner about the new inquiry, for the alerts
	// routes (TAT-52).
	const alert = await inTenant(tenant, () =>
		StaffAlert.create({
			tenantId: tenant.id,
			userId: owner.id,
			kind: "new_inquiry",
			inquiryId: newInquiry.id,
		}),
	);
```

in the returned object, after `newInquiry,` add:

```ts
		// The :id resource of the alerts routes' isolation cases (TAT-52).
		alert,
```

and in the `twoStudios` doc comment, replace "is the session routes' resource (TAT-85). Later tickets add seed data" with "is the session routes' resource (TAT-85); an unread alert of the owner about the new inquiry (`alert`) is the alerts routes' (TAT-52). Later tickets add seed data".

In `apps/platform/tests/isolation/cases.ts`, add `import StaffAlert from "#modules/notifications/models/staff_alert";`, add `| "alert"` to the `resource` union (after `| "client"`), after the `templateRows` helper add:

```ts
// Every member's alerts (TAT-52): what reading or opening one could change.
const alertRows = (target: Studio) =>
	inTenant(target.tenant, async () =>
		(
			await StaffAlert.query()
				.where("tenant_id", target.tenant.id)
				.orderBy("id")
		).map((alert) => alert.serialize()),
	);
```

and at the end of `isolationCases`, replace

```ts
		body: () => ({ channel: "whatsapp", kind: "inquiry_received" }),
		ownStatus: 302,
		snapshot: inboxRows,
	},
];
```

with

```ts
		body: () => ({ channel: "whatsapp", kind: "inquiry_received" }),
		ownStatus: 302,
		snapshot: inboxRows,
	},
	{
		method: "GET",
		pattern: "/t/:tenant/alerts",
		actor: "owner",
		ownStatus: 200,
		snapshot: alertRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/alerts/read",
		actor: "owner",
		ownStatus: 302,
		snapshot: alertRows,
	},
	{
		method: "POST",
		pattern: "/t/:tenant/alerts/:id/open",
		resource: "alert",
		actor: "owner",
		ownStatus: 302,
		snapshot: alertRows,
	},
];
```

- [ ] **Step 7: Regenerate types, run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen`, then `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test functional --files=alerts_http.spec.ts --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=inbox.spec.ts --files=proof_badge.spec.ts` and `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform test unit --files=nav_items.spec.ts`.
Expected: PASS (6 alerts tests, the `alerts` area, 3 new isolation cases; the badges unchanged). Then `typecheck`: clean.

- [ ] **Step 8: Commit**

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check --write apps/platform/app/modules/notifications/services/alert_service.ts apps/platform/app/controllers/alerts_controller.ts apps/platform/start/routes.ts apps/platform/app/middleware/inertia_middleware.ts apps/platform/inertia/pages/alerts/index.tsx apps/platform/inertia/components/shell apps/platform/tests/helpers/tenants.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/tenancy/tenant_routes.spec.ts apps/platform/tests/functional/notifications/alerts_http.spec.ts
git -C <repo> add apps/platform/app apps/platform/start/routes.ts apps/platform/inertia apps/platform/tests/helpers/tenants.ts apps/platform/tests/isolation/cases.ts apps/platform/tests/functional/tenancy/tenant_routes.spec.ts apps/platform/tests/functional/notifications/alerts_http.spec.ts apps/platform/.adonisjs
git -C <repo> commit -m "feat(platform): show each member their alerts behind a bell with the unread count" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs

**Files:**
- Modify: `apps/platform/docs/jobs-and-email.md`, `apps/platform/docs/backend.md`, `apps/platform/docs/ui.md`, `apps/platform/docs/testing.md`, `apps/platform/docs/deploy.md`, `apps/platform/database/README.md`
- Modify: `docs/requirements.md`, `docs/architecture.md`, `docs/data-model.md`

`docs/README.md` needs no change (no new document).

- [ ] **Step 1: Jobs and email**

In `apps/platform/docs/jobs-and-email.md`:

- After the bullet that starts "- Send with `mail.sendLater(...)`", add:

```markdown
- To send an email only if a job's transaction commits, use `sendMailInTransaction(email, trx)` (`#services/mail_in_transaction`, TAT-52): it builds the mail and queues its `SendMailJob` with `dispatchInTransaction`, where `mail.sendLater` queues outside the transaction. Tie each email to the row that records it, and a retried job never sends twice.
```

- Replace the whole bullet that starts "- New-inquiry alerts (TAT-51):" with:

```markdown
- New-inquiry alerts (TAT-51, TAT-52): `IntakeService.submit` queues `NewInquiryAlertJob { tenantId, inquiryId }` (`#modules/inquiries/jobs/new_inquiry_alert_job`) in the inquiry's transaction, so it exists exactly when the inquiry does. For an inquiry still `new` it logs "New inquiry received." with the two ids and calls `AlertService.newInquiry` (`#modules/notifications/services/alert_service`): every live owner, and the member linked to the inquiry's live preferred artist, gets one `staff_alerts` row and one `NewInquiryMail`, once (unique `(user_id, inquiry_id)`, `insert … on conflict do nothing returning user_id`, and each email queued with `sendMailInTransaction` in the same transaction, so a rerun adds nothing and sends nothing again; a rollback leaves neither). The email holds the client's first name, 140 characters of the idea, the asked-for artist and, for owners, the inquiry's dashboard link (`APP_URL`); never the phone, the email address, the budget or the references, and its subject has no client data (`SendMailJob.failed()` logs it). `ALERT_EMAILS=false` keeps the in-app alerts and queues no email; `start/mail.ts` logs one warning at boot.
```

- In the bullet that starts "- Deposit proofs (TAT-65):", replace "TAT-52 sends the owners' email and in-app alert from it; until then the Projects badge (`proofCount`) is the owners' alert." with "Its owners' email and in-app alert are a follow-up (TAT-52, ruling 12); until then the Projects badge (`proofCount`) is the owners' alert."

- At the end of the bullet that starts "- Tests: fake the queue with `queue.fake()`", add: " A queued email is a `SendMailJob` payload: read it from `fake.getPushedJobs()` (`job.name`, `job.payload.mailMessage`). Through the real worker, use `mail.fake()` with `emitter.fake([\"mail:sent\"])`: the fake mailer doesn't track `sendCompiled`."

- [ ] **Step 2: Backend conventions**

In `apps/platform/docs/backend.md`:

- In the "Projects and quotes (TAT-64)" bullet, replace "`markContacted` (the chat links call it in the background)" with "`markContacted` (the chat links call it in the background, with the channel and the message: see Notifications)".
- At the end of the "Inquiries (TAT-46)" bullet, add: " The inquiry page's chat links record its last contact (`markContacted`, TAT-52), and accepting carries it to the project."
- In the "Clients (TAT-41)" bullet, replace "Chat and call links are in `#modules/clients/contact_links`." with "Chat and call links are in `#modules/clients/contact_links`; the dashboard's messages build on them (`#modules/notifications/chat`, TAT-52)."
- Before the "## Phone numbers" heading, add:

```markdown
## Notifications

- Staff alerts (TAT-52): the `notifications` module (`app/modules/notifications/`) owns `StaffAlert` (table `staff_alerts`: one member's alert about one event, ids only) and `AlertService` (`#modules/notifications/services/alert_service`). `newInquiry(tenant, inquiry)` (from `NewInquiryAlertJob`, see [jobs and email](jobs-and-email.md#jobs)) alerts every live owner and the member linked to the inquiry's live preferred artist (`inquiryRecipients` in `#modules/notifications/alerts`, from `TenancyService.members`), once each. `list`, `unreadCount` (the shared `alertCount`), `open` (marks the member's own alert read, else E_ROW_NOT_FOUND) and `markAllRead` serve the Alerts page (`/t/:tenant/alerts`, owners and artists, `AlertsController`); `alertTarget` decides where opening one goes from the row and the member's role, never from the request. The deposit-proof alert is a follow-up.
- Chat messages (TAT-52): the six kinds, their placeholders, the defaults and the one renderer are in `#modules/notifications/messages` (no imports). `renderMessage(kind, template, values)` replaces the kind's placeholders in one pass (a value is never read again; an empty one takes the space before it along), and `templateProblem` is the save rule (only the kind's placeholders and nothing else in braces, 1 to 1,000 characters after line endings become `\n`, the deposit link message keeps `{deposit_link}`). A studio's own texts are `MessageTemplate` rows (`message_templates`, one per changed kind; `MessageTemplateService.textsFor` fills the rest with `DEFAULT_TEMPLATES`, and saving a default deletes the row), edited in Settings, Messages (`/t/:tenant/settings/messages`, owners). `quoteMessage` and `depositMessage` take the studio's text (their defaults are TAT-64's and TAT-65's words). `#modules/notifications/chat` builds the links from the client's stored phone (`chatMessage`, `contactLinks`); `#modules/notifications/project_messages` decides what a project's "Message the client" card offers (`cardKinds`, `defaultCardKind`, `cardValues`: the next session still to come, aftercare after a completed tattoo or touch-up session). Nothing is sent automatically.
- Last contact (TAT-52): `tattoo_projects` and `inquiries` record `last_contacted_at`, `last_contact_channel` (`whatsapp`, `viber`, `call`, `copy`) and `last_contact_kind` (a message kind). The chat links post them in the background to `POST /t/:tenant/projects/:id/contacted` (`ProjectService.markContacted(…, via)`) or `POST /t/:tenant/inbox/:id/contacted` (`InquiryService.markContacted`, owners); "Mark contacted" sends neither (`contactValidator`, `toContactVia`). `lastContactText` (`#modules/projects/contact`) reads "contacted today on WhatsApp (Quote)". Accepting an inquiry copies its last contact to the project. Nothing records who made the contact, and never the text, a link or a token.
```

- [ ] **Step 3: UI, testing, deploy, database**

In `apps/platform/docs/ui.md`:

- At the end of the App shell's first bullet ("`AppLayout` is the shell…"), add: " The Alerts link (`inertia/components/shell/alerts_link.tsx`, TAT-52) is not a nav item: a bell with the member's unread count (the shared `alertCount`) next to the account menu in the top bar, and a row above the account menu in the sidebar."
- At the end of "## Components, forms and theme", add:

```markdown
- Chat links (TAT-52): `ChatMessage` and `ChatLinks` (`inertia/components/chat_message.tsx`) are the one way to draw a WhatsApp, Viber or Call link; each tap calls back with its channel so the page records the last contact. Hand an `onClick` a wrapper (`() => markContacted()`), never the recording function itself, or the click event becomes the request body. The "Message the client" card is `inertia/components/message_card.tsx`.
```

In `apps/platform/docs/testing.md`:

- In the `twoStudios()` bullet, replace "is the session routes' resource (TAT-85). Seed data for a new table goes there." with "is the session routes' resource (TAT-85); an unread alert of the owner about the new inquiry (`alert`) is the alerts routes' (TAT-52). Seed data for a new table goes there."
- At the end of "## Environment and test conventions", add:

```markdown
Staff alert emails (TAT-52) are on in tests: `.env.test` sets `ALERT_EMAILS=true` (an exported `ALERT_EMAILS` still wins: unset it). No test sends real mail: a queued email is a `SendMailJob` payload on `queue.fake()` (`fake.getPushedJobs()`), or a row in the test's transaction; through `processQueued()`, `mail.fake()` with `emitter.fake(["mail:sent"])` catches it. Render a mail class itself with `buildWithContents()` and its `message.assert*` helpers.
```

In `apps/platform/docs/deploy.md`:

- Under "### Platform settings", after the bullet that starts "- `DB_USER` / `DB_PASSWORD`", add:

```markdown
- Mail (TAT-52): new inquiries email the studio's owners and the asked-for artist from the worker. `MAIL_FROM_ADDRESS` must be on the platform's own sending domain with SPF, DKIM and DMARC (TAT-20), and `SMTP_*` a provider allowed to send for it. Until then set `ALERT_EMAILS=false`: the alerts reach the dashboard only, and every process logs one warning at boot. With mail on and SMTP failing, each email fails after 3 retries with one "Sending email failed." log line; the dashboard alerts don't depend on it.
```

- Under "### Accepted denial costs", replace "(429s and busy 503s are not logged on purpose; alerts are TAT-52)" with "(429s and busy 503s are not logged on purpose, and TAT-52's alerts cover new inquiries only, not a form at its limit)".
- Under "### After the first deploy", add: "- With `ALERT_EMAILS` on, send one inquiry to your own studio and check the owner's mailbox, spam folder included, for \"New inquiry for …\"; its button opens the inquiry."

In `apps/platform/database/README.md`:

- In the "**Guard triggers.**" bullet, replace "`inquiries_guard_update` (the submitted fields are frozen)" with "`inquiries_guard_update` (the submitted fields are frozen; besides the decision, `deleted_at`, `updated_at` and `anonymized_at`, TAT-52 frees the last contact: `last_contacted_at`, `last_contact_channel` and `last_contact_kind`)".
- In the soft-delete bullet, replace "deposit links (a credential replaced in place; a deleted project's link is dead because the deposit page loads only live projects), and queue tables." with "deposit links (a credential replaced in place; a deleted project's link is dead because the deposit page loads only live projects), message templates (a studio setting replaced in place: a row only for a changed text), staff alerts (ids only, kept read or unread), and queue tables."

- [ ] **Step 4: Requirements, architecture, data model**

In `docs/requirements.md`:

- Replace `- [ ] One tap opens the client's WhatsApp or Viber with a prefilled message: received, quote, deposit link, booking confirmation, reminder, aftercare` with:

```markdown
- [x] One tap opens the client's WhatsApp or Viber with a prefilled message: received, quote, deposit link, booking confirmation, reminder, aftercare
- Each studio writes its six messages once (Settings, Messages), with placeholders such as `{client_name}` and `{session_time}`, or keeps the defaults; nothing is sent automatically. The links open the client's stored number; Viber can't carry text, so the message is copied and pasted. Every tap records when the client was last contacted, on which channel and with which message, on the inquiry or the project; an accepted inquiry's last contact carries to its project.
```

- Replace `- [ ] Staff are alerted to new inquiries by email and in the app. No automatic customer messages in the MVP; replies go through the one-tap chat links` with:

```markdown
- [x] Staff are alerted to new inquiries by email and in the app. No automatic customer messages in the MVP; replies go through the one-tap chat links
- A new inquiry alerts each owner, and the artist the client asked for when that profile is linked to a member, once each: an email (the client's first name and the start of the idea, never the phone; owners get a link to the inquiry) and an alert under the dashboard's bell. Email can be switched off for the whole platform until its sending domain exists.
```

In `docs/architecture.md`, replace "4. A job alerts the studio's staff by email and in the app (queued with the inquiry since TAT-51; the alerts themselves are TAT-52)." with "4. A job, queued with the inquiry, alerts the studio's owners and the artist the client asked for, once each, by email and in the dashboard (TAT-52)."

In `docs/data-model.md`:

- In the mermaid diagram, after `  Tenant ||--|| StorefrontConfiguration : has`, add `  Tenant ||--o{ MessageTemplate : writes` and `  User ||--o{ StaffAlert : receives`.
- In the **TattooProject** row, replace "last-contacted time" with "last contact (when, on which channel, with which message)".
- In the **Inquiry** row, after "with the time of the decision.", add " Its last contact (when, on which channel, with which message) is recorded too."
- After the **ReferenceImage** row, add:

```markdown
| **MessageTemplate** | A studio's own text for one of its six chat messages (inquiry received, quote, deposit link, booking confirmation, session reminder, aftercare), with placeholders such as `{client_name}`. A row only for a message the studio changed; the defaults are in code |
| **StaffAlert** | One member's alert about one event (a new inquiry so far): the member, the kind, the event's id and when it was read. Ids only, no client data |
```

- [ ] **Step 5: Commit**

```bash
git -C <repo> add apps/platform/docs apps/platform/database/README.md docs/requirements.md docs/architecture.md docs/data-model.md
git -C <repo> commit -m "docs(platform): document staff alerts, message templates and the last contact" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Final verification

- [ ] **Step 1: Generated files are current**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo>/apps/platform exec node ace codegen && git -C <repo> status --short`
Expected: no changes (Tasks 4, 5 and 9 committed `.adonisjs/`). If `.adonisjs/` changed, commit it as `chore(platform): regenerate types` with the trailer.

- [ ] **Step 2: Root gates**

From the repo root: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> check`, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> typecheck`, `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> build`.
Expected: all clean. If `pnpm check` fails with "nested root configuration" because of another agent's `.claude/worktrees/*` checkout, run `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm -C <repo> exec biome check apps packages` instead and say so.

- [ ] **Step 3: Full suite**

Run in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3402 pnpm -C <repo>/apps/platform exec node ace test > <scratchpad>/full.log 2>&1` and wait for the notification.
Expected: all pass, 88 more than Task 0's baseline (Task 1: 14, Task 2: 3, Task 3: 9, Task 4: 4 + 5 + 1 + 2 isolation cases, Task 5: 1 + 2 + 2 + 1 + 1 isolation case, Task 6: 3 + 4 + 3, Task 7: 2, Task 8: 7 + 4 + 8 + 1 + 1, Task 9: 6 + 1 role-guard area + 3 isolation cases). Report the exact count from the log's `Tests` line. Also run the storefront's tests if any file under `apps/storefront` or `packages/` changed (none should).

- [ ] **Step 4: What changed, and a clean tree**

Run: `git -C <repo> log --format=%h -1 -- docs/superpowers/plans/2026-10-19-tat-52-staff-alerts-and-message-templates.md` (the design commit), then `git -C <repo> diff <that hash> --stat -- apps/platform/database` (expected: the three migrations, `schema.ts` and `README.md`), `git -C <repo> diff <that hash> --stat -- apps/storefront packages` (expected: empty) and `git -C <repo> status -sb` (expected: clean). `git -C <repo> log --oneline -11` lists the design commit and Tasks 1 to 10.

---

### Task 12: Browser pass

Do it after the reviews, at 375 px and 1280 px, light and dark. No real mail is ever sent: the worker below can only reach a local Mailpit.

- [ ] **Step 1: Start the dev server and the worker on this checkout**

Unset `ALERT_EMAILS`, `TURNSTILE_SECRET_KEY`, `STOREFRONT_SERVER_KEYS` and `TRUST_PROXY` in the shell first. Then, each with `run_in_background`:

```
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH PORT=3401 APP_URL=http://localhost:3401 TURNSTILE_SECRET_KEY= pnpm -C <repo>/apps/platform dev
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH APP_URL=http://localhost:3401 SMTP_HOST=127.0.0.1 SMTP_PORT=1025 SMTP_USERNAME= SMTP_PASSWORD= ALERT_EMAILS=true pnpm -C <repo>/apps/platform worker
```

The command line wins over `.env`: the email links point at this server and mail can only reach `127.0.0.1:1025`. Check Mailpit with `curl -s http://127.0.0.1:8025/api/v1/messages | head -c 300`; if the connection is refused, Mailpit isn't running (start it the README's way if you can; otherwise every email simply fails to send and the mail tests stand in for step 2's mailbox checks: say so in the report). Note the PIDs (`pgrep -af "ace serve"`, `pgrep -af "queue:work"`): stop exactly those afterwards, and never touch port 3333.

- [ ] **Step 2: An alert**

Sign in as a studio owner, link an artist profile to your account (Settings, Artists, "This is my profile") and send an inquiry naming it, through the public API (replace `<slug>` and `<artist id>`; the phone is any free Nepali mobile number):

```
curl -s -X POST http://localhost:3401/api/v1/tenants/<slug>/inquiries -F "idea=A koi on the calf, नमस्ते" -F placement=Forearm -F "approximateSize=10 cm" -F "preferredDates=Any weekday" -F sourceChannel=instagram -F "contactName=Maya Gurung" -F contactPhone=9812300001 -F preferredArtistId=<artist id>
```

Expected: `{"data":{"id":"…"}}`. Within a few seconds: the bell shows 1 (top bar at 375 px, the sidebar's "Alerts" row at 1280 px); the Alerts page lists "New inquiry", "Today, HH:MM", unread (bold, dot); Mailpit has one email "New inquiry for {studio}" with "Maya sent {studio} a new tattoo inquiry and asked for you:", the excerpt, "Open the inquiry" (it opens the inquiry on 3401) and no phone number. Exactly one email and one alert per recipient (a rerun adding none is the alert tests' job, not this pass's).

- [ ] **Step 3: Open and read**

Tap the alert: the inquiry opens and the count drops to 0. Send a second inquiry, then "Mark all as read" on the Alerts page: the flash "All alerts marked as read.", no bold rows, no count.

- [ ] **Step 4: Inquiry received**

On the new inquiry's page: the "Message the client" card shows "Inquiry received", the text, "Send on WhatsApp" (opens wa.me with the text in a new tab), "Open Viber chat", "Copy message" (toast "Message copied."), the Viber hint, and the plain WhatsApp, Viber and Call links; after a tap the flash "Marked as contacted." and the line under the card reads "contacted today on WhatsApp (Inquiry received)". The inbox's New list shows the same line. Accept the inquiry: the project's status card reads the same.

- [ ] **Step 5: Settings, Messages**

Settings has a "Messages" entry. Edit the booking confirmation (add a Nepali line and `{studio_address}`): its preview follows as you type; "Save messages", flash "Messages saved."; the text stays after a reload. Type `{client name}` into the aftercare and save: the error under that box only, nothing saved. "Reset to default" puts the default back (shown only while the text differs).

- [ ] **Step 6: Project messages**

On that project, schedule a session for tomorrow (Sessions card): the card offers Booking confirmation and Session reminder with the session's time and artist, and your edited text with the Nepali line intact in wa.me; on a booked project it starts on Booking confirmation. Mark a past session done on another project: Aftercare appears and is preselected. A project whose client was anonymized (if you have one) says "This client has no phone number to message."

- [ ] **Step 7: Quote and deposit**

A quoted project's quote message and a deposit-pending project's deposit message read exactly as before for a studio that never edited them, and record "(Quote)" / "(Deposit link)" in the contact line when tapped.

- [ ] **Step 8: Phone width, keyboard, theme**

At 375 px nothing is wider than the screen (the settings page's six boxes, the card's buttons wrap, the alerts list); every button is 44 px tall. Tab through the card, the settings form and the alerts list; the bell announces "Alerts, N unread". Dark mode: the select, the preview boxes and the unread dot read well.

- [ ] **Step 9: As an artist (if a second account can be set up)**

The bell and their own alert only ("A new inquiry asks for you"; opening it stays on the list); no Settings; the Message card on their own project.

- [ ] **Step 10: Stop**

Stop the two processes by their PIDs, then `git -C <repo> status --short`: if the dev server regenerated a tracked file (`.adonisjs/…`), restore it with `git -C <repo> checkout -- <file>`.

---

### Task 13: PR text (not committed)

- [ ] **Step 1: Write it**

Write `<scratchpad>/pr3-tat-52.md`. Say up front that the ticket grew from 3 to **about 5 points** and what was left out to keep it there (the deposit-proof alert, email preferences, alert pruning, who made a contact). Then a few "what and why" bullets per change (mentor mode): the alerts and why they can't double-send; what an email may contain; `ALERT_EMAILS` and the sending domain (TAT-20) before turning email on in production; the six templates, the placeholder rules and the byte-identical quote and deposit defaults; the "Message the client" card; the last contact and the inquiry guard's three freed columns; the three migrations (and that they change the shared dev database). The rulings the user should see first: recipients, email content, no preference yet, the bell named "Alerts", alerts kept, the default texts and their "Hi", braces always meaning a placeholder, the next session for confirmation and reminder, no "by whom", no automatic sending. The carry-forwards as tickets for the user to file (the spec's list). The spec's browser pass as a checklist with its results. Do not push and do not open a PR.

