# Email Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared Edge email layout and button for the platform, and Identity's verification email as the first email built on them, living in the first `app/modules/<module>/` folder.

**Architecture:** Shared email parts are Edge components in `resources/views/components/email/`, which Edge 6 turns into the `@email.layout` and `@email.button` tags. Each module's templates sit in `app/modules/<module>/` and are reached through a named Edge disk mounted in `start/view.ts`, one line per module (`identity::emails/verify_email`). Each email is a `BaseMail` subclass next to its HTML and plain-text templates.

**Tech Stack:** AdonisJS 7, `@adonisjs/mail` 10, Edge 6 (`edge.js` 6.5), Japa 5 with `@japa/assert`, Biome.

**Spec:** `docs/superpowers/specs/2026-10-04-email-templates-design.md`

## Global Constraints

- All commands run from `apps/platform` unless a step says otherwise.
- Email markup uses inline `style=""` attributes and `<table role="presentation">` layout only. No `<style>` blocks, no CSS inliner, no MJML, no dark-mode CSS.
- Colours are zinc hex values: `#f4f4f5` page background, `#ffffff` card, `#e4e4e7` border, `#18181b` text and button, `#fafafa` button text, `#71717a` muted text.
- Brand name in emails is the literal `Tattoo Drip`.
- Mail classes never set `from`. `config/mail.ts` always sends from the platform's domain.
- Edge prints `undefined` and `null` literally (`{{ x }}` with `x = undefined` renders `undefined`). Guard every optional value with `@if` or `||`.
- HTML templates print values with `{{ }}` (escaped). Plain-text templates print values with `{{{ }}}` (raw), because escaping would turn `&` into `&amp;` in the text version.
- Existing User code (`app/models/user.ts`, controllers, validator, transformer) does not move in this change. Import `User` from `#models/user`.
- Formatting: Biome, tabs, double quotes (`pnpm format:fix` from the repo root). Biome does not format `.edge` files; indent them with two spaces like `resources/views/inertia_layout.edge`.
- Commits: Conventional Commits, scope `platform`, body ends with `Refs: TAT-6` and the `Co-Authored-By` line. Never stage `apps/platform/.adonisjs/`.

## Review Focus

- A verification URL with a query string (`?token=abc&signature=xyz`, which any signed URL has) must stay a working link: `&amp;` inside the HTML `href`, a raw `&` in the text version. Pinned in Task 2.
- A `fullName` containing HTML (`<b>Tom</b> & Jerry`) must be escaped in the HTML version and shown as typed in the text version. Pinned in Task 2.
- A user with `fullName` `null` or `""` must be greeted "Hi there", never "Hi null" or "Hi ,". Pinned in Task 2.
- An email that passes no `preheader` must not show the word `undefined` or an empty hidden preview block. Pinned in Task 1.
- The production build must contain the module's `.edge` files, otherwise every send fails in production with a missing template. Pinned by the build check in Task 2.

---

### Task 1: Email layout and button components

**Files:**
- Create: `apps/platform/resources/views/components/email/layout.edge`
- Create: `apps/platform/resources/views/components/email/button.edge`
- Test: `apps/platform/tests/unit/emails/layout.spec.ts`

**Interfaces:**
- Consumes: nothing. The `edge.js` default disk is already mounted at `resources/views` by `@adonisjs/core`'s edge provider.
- Produces:
  - Tag `@email.layout({ title: string, preheader?: string })` … `@end`. Renders a full HTML document (`<!DOCTYPE html>`, `<title>`, a "Tattoo Drip" header, the main slot, a footer). The hidden preheader block is rendered only when `preheader` is truthy.
  - Tag `@!email.button({ href: string, text: string })`. Renders `<a href="{{ href }}" …>{{ text }}</a>` inside a presentation table.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/emails/layout.spec.ts`:

```ts
import { test } from "@japa/runner";
import edge from "edge.js";

test.group("Email layout", () => {
	test("wraps the body in a full document with title and preheader", async ({
		assert,
	}) => {
		const html = await edge.renderRaw(
			[
				"@email.layout({ title: 'Hello', preheader: 'Preview text' })",
				"<p>Body</p>",
				"@end",
			].join("\n"),
		);

		assert.include(html, "<!DOCTYPE html>");
		assert.include(html, "<title>Hello</title>");
		assert.include(html, "Preview text");
		assert.include(html, "<p>Body</p>");
		assert.include(html, "Tattoo Drip");
	});

	test("leaves the preheader block out when none is given", async ({
		assert,
	}) => {
		const html = await edge.renderRaw(
			["@email.layout({ title: 'Hello' })", "<p>Body</p>", "@end"].join("\n"),
		);

		assert.notInclude(html, "undefined");
		assert.notInclude(html, "display: none");
	});

	test("renders the button as an escaped link", async ({ assert }) => {
		const html = await edge.renderRaw(
			"@!email.button({ href: url, text: 'Go' })",
			{ url: "https://x.test/a?b=1&c=2" },
		);

		assert.include(html, 'href="https://x.test/a?b=1&amp;c=2"');
		assert.include(html, ">Go</a>");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ace test unit --files=emails/layout`
Expected: FAIL. `@email.layout` and `@email.button` are not registered tags yet, so Edge leaves them as plain text and the `<!DOCTYPE html>`, `<title>Hello</title>` and `href=` assertions fail. The "leaves the preheader block out" test may pass already; that's fine.

- [ ] **Step 3: Write the layout component**

Create `apps/platform/resources/views/components/email/layout.edge`:

```edge
{{--
  Root layout for every email: @email.layout({ title, preheader }) ... @end.
  Inline styles and tables only. Many clients strip <style> blocks and
  Outlook ignores most CSS layout. `preheader` is the inbox preview text
  and is optional.
--}}
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>{{ title }}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f4f4f5;">
    @if(preheader)
      <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">{{ preheader }}</div>
    @end
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f5;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px;">
            <tr>
              <td style="padding: 0 0 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 18px; font-weight: 600; line-height: 24px; color: #18181b;">
                Tattoo Drip
              </td>
            </tr>
            <tr>
              <td style="padding: 32px; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 24px; color: #18181b;">
                {{{ await $slots.main() }}}
              </td>
            </tr>
            <tr>
              <td style="padding: 24px 0 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 18px; color: #71717a;">
                You received this email because of activity on your Tattoo Drip account.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```

- [ ] **Step 4: Write the button component**

Create `apps/platform/resources/views/components/email/button.edge`. Keep `{{ text }}</a>` on one line so no whitespace lands inside the link:

```edge
{{--
  Call-to-action button: @!email.button({ href, text }).
  A table cell carries the background so Outlook shows it too.
--}}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
  <tr>
    <td style="border-radius: 6px; background-color: #18181b;">
      <a href="{{ href }}" target="_blank" style="display: inline-block; padding: 12px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 600; line-height: 20px; color: #fafafa; text-decoration: none; border-radius: 6px;">{{ text }}</a>
    </td>
  </tr>
</table>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node ace test unit --files=emails/layout`
Expected: PASS, 3 tests.

- [ ] **Step 6: Lint and typecheck**

Run from the repo root: `pnpm format:fix && pnpm check && pnpm --filter @tattoo-drip/platform typecheck`
Expected: all exit 0. `format:fix` may rewrap the test file to Biome's line width; that's expected.

- [ ] **Step 7: Commit**

```bash
git add apps/platform/resources/views/components/email apps/platform/tests/unit/emails/layout.spec.ts
git commit -F - <<'EOF'
feat(platform): add the shared email layout and button

Edge components in resources/views/components/email, used as
@email.layout and @email.button. Inline styles and tables only, so
Outlook and clients that strip <style> render them the same.

Refs: TAT-6

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: First module and Identity's verification email

**Files:**
- Modify: `apps/platform/package.json` (the `imports` map)
- Modify: `apps/platform/adonisrc.ts` (`preloads` and `metaFiles`)
- Create: `apps/platform/start/view.ts`
- Create: `apps/platform/app/modules/identity/emails/verify_email_mail.ts`
- Create: `apps/platform/app/modules/identity/emails/verify_email.edge`
- Create: `apps/platform/app/modules/identity/emails/verify_email_text.edge`
- Modify: `apps/platform/AGENTS.md` (Layout section, new Emails section)
- Modify: `docs/architecture.md` (Backend modules section)
- Test: `apps/platform/tests/unit/modules/identity/verify_email_mail.spec.ts`

**Interfaces:**
- Consumes: `@email.layout({ title, preheader })` and `@!email.button({ href, text })` from Task 1. `User` from `#models/user` (`email: string`, `fullName: string | null`).
- Produces:
  - Import alias `#modules/*` → `./app/modules/*.js`.
  - Edge disk `identity` mounted at `app/modules/identity`.
  - `export default class VerifyEmailMail extends BaseMail` at `#modules/identity/emails/verify_email_mail`, with `constructor(user: User, verifyUrl: string)` and `subject = "Verify your email"`. The future Identity service sends it with `mail.send(new VerifyEmailMail(user, url))`.

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/modules/identity/verify_email_mail.spec.ts`:

```ts
import { test } from "@japa/runner";
import User from "#models/user";
import VerifyEmailMail from "#modules/identity/emails/verify_email_mail";

// Signed URLs always carry several query parameters, so the `&` matters.
const verifyUrl =
	"https://app.tattoo-drip.test/verify-email?token=abc&signature=xyz";

function makeUser(fullName: string | null) {
	const user = new User();
	user.email = "ink@example.com";
	user.fullName = fullName;
	return user;
}

async function render(user: User) {
	const mail = new VerifyEmailMail(user, verifyUrl);
	await mail.buildWithContents();
	return mail.message;
}

test.group("VerifyEmailMail", () => {
	test("is addressed to the user and leaves the sender to the config", async ({
		assert,
	}) => {
		const message = await render(makeUser("Ada Ink"));

		message.assertTo("ink@example.com");
		message.assertSubject("Verify your email");
		// config/mail.ts fills in the platform's from address when sending.
		assert.isUndefined(message.nodeMailerMessage.from);
	});

	test("renders the html inside the shared layout", async () => {
		const message = await render(makeUser("Ada Ink"));

		message.assertHtmlIncludes("<!DOCTYPE html>");
		message.assertHtmlIncludes("Tattoo Drip");
		message.assertHtmlIncludes("Hi Ada Ink,");
		message.assertHtmlIncludes(
			'href="https://app.tattoo-drip.test/verify-email?token=abc&amp;signature=xyz"',
		);
	});

	test("prints the name and url as typed in the text version", async () => {
		const message = await render(makeUser("<b>Tom</b> & Jerry"));

		message.assertTextIncludes("Hi <b>Tom</b> & Jerry,");
		message.assertTextIncludes(verifyUrl);
	});

	test("escapes the name in the html version", async ({ assert }) => {
		const message = await render(makeUser("<b>Tom</b> & Jerry"));

		message.assertHtmlIncludes("Hi &lt;b&gt;Tom&lt;/b&gt; &amp; Jerry,");
		assert.notInclude(String(message.nodeMailerMessage.html), "<b>Tom</b>");
	});

	test("greets 'there' when the user has no name", async ({ assert }) => {
		for (const fullName of [null, ""]) {
			const message = await render(makeUser(fullName));

			message.assertHtmlIncludes("Hi there,");
			message.assertTextIncludes("Hi there,");
			assert.notInclude(String(message.nodeMailerMessage.html), "null");
		}
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node ace test unit --files=identity/verify_email_mail`
Expected: FAIL before any test runs, with `ERR_PACKAGE_IMPORT_NOT_DEFINED` for `#modules/identity/emails/verify_email_mail` (the alias doesn't exist yet).

- [ ] **Step 3: Add the `#modules/*` alias**

In `apps/platform/package.json`, add this line to `imports` directly after `"#services/*": "./app/services/*.js",`:

```json
		"#modules/*": "./app/modules/*.js",
```

- [ ] **Step 4: Mount the module's Edge disk**

Create `apps/platform/start/view.ts`:

```ts
/*
|--------------------------------------------------------------------------
| Module views
|--------------------------------------------------------------------------
|
| Each module with Edge templates gets a named disk at its own folder, so
| its templates are `<module>::emails/<name>`. Add one line per module.
|
*/

import app from "@adonisjs/core/services/app";
import edge from "edge.js";

edge.mount("identity", app.makePath("app/modules/identity"));
```

In `apps/platform/adonisrc.ts`, add the preload as the last entry of `preloads`:

```ts
	preloads: [
		() => import("#start/routes"),
		() => import("#start/kernel"),
		() => import("#start/validator"),
		() => import("#start/view"),
	],
```

And add the module templates to `metaFiles`, directly after the `resources/views/**/*.edge` entry, so `node ace build` copies them:

```ts
	metaFiles: [
		{
			pattern: "resources/views/**/*.edge",
			reloadServer: false,
		},
		{
			pattern: "app/modules/**/*.edge",
			reloadServer: false,
		},
		{
			pattern: "public/**",
			reloadServer: false,
		},
	],
```

- [ ] **Step 5: Write the mail class**

Create `apps/platform/app/modules/identity/emails/verify_email_mail.ts`:

```ts
import { BaseMail } from "@adonisjs/mail";
import type User from "#models/user";

/**
 * Asks a new user to confirm their email address. The caller makes and
 * signs `verifyUrl`; this mail only renders it.
 */
export default class VerifyEmailMail extends BaseMail {
	subject = "Verify your email";

	constructor(
		private user: User,
		private verifyUrl: string,
	) {
		super();
	}

	prepare() {
		const data = { user: this.user, verifyUrl: this.verifyUrl };

		this.message
			.to(this.user.email)
			.htmlView("identity::emails/verify_email", data)
			// The text template prints values raw ({{{ }}}): escaping would
			// show `&amp;` in the URL.
			.textView("identity::emails/verify_email_text", data);
	}
}
```

- [ ] **Step 6: Write the HTML template**

Create `apps/platform/app/modules/identity/emails/verify_email.edge`:

```edge
@email.layout({ title: 'Verify your email', preheader: 'Confirm your email address to finish setting up your Tattoo Drip account.' })
  <p style="margin: 0 0 16px;">Hi {{ user.fullName || 'there' }},</p>
  <p style="margin: 0;">Confirm your email address to finish setting up your Tattoo Drip account.</p>
  @!email.button({ href: verifyUrl, text: 'Verify email' })
  <p style="margin: 0 0 16px; font-size: 14px; line-height: 20px; color: #71717a;">
    If the button doesn't work, copy this link into your browser:<br />
    <a href="{{ verifyUrl }}" style="color: #18181b; word-break: break-all;">{{ verifyUrl }}</a>
  </p>
  <p style="margin: 0; font-size: 14px; line-height: 20px; color: #71717a;">
    If you didn't create an account, you can ignore this email.
  </p>
@end
```

- [ ] **Step 7: Write the text template**

Create `apps/platform/app/modules/identity/emails/verify_email_text.edge`. No Edge comment at the top: it would leave a blank first line in the email.

```edge
Hi {{{ user.fullName || 'there' }}},

Confirm your email address to finish setting up your Tattoo Drip account:

{{{ verifyUrl }}}

If you didn't create an account, you can ignore this email.
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node ace test unit`
Expected: PASS, 8 tests (3 from Task 1, 5 from this task).

- [ ] **Step 9: Check the production build keeps the templates**

Run: `node ace build && ls build/app/modules/identity/emails && rm -rf build`
Expected: the listing shows `verify_email.edge`, `verify_email_mail.js` and `verify_email_text.edge`. If the two `.edge` files are missing, the `metaFiles` entry from Step 4 is wrong. `build/` is git-ignored.

- [ ] **Step 10: Update the docs**

In `apps/platform/AGENTS.md`, in the `## Layout` section, add this bullet directly after the `app/controllers`, `app/models`, … bullet:

```markdown
- `app/modules/<module>/`: one folder per backend module from `docs/architecture.md`, owning its `models/`, `services/`, `controllers/`, `validators/` and `emails/`. Import with `#modules/*`. New module code goes here; code still in the flat `app/*` folders moves when its module is built.
```

Then add this section directly before `## Commands`:

```markdown
## Emails

- Emails are Edge templates with inline styles and table layout: no `<style>` blocks, CSS inliner or MJML.
- Shared parts are components in `resources/views/components/email/`. Wrap every email in `@email.layout({ title, preheader })` and use `@!email.button({ href, text })` for calls to action.
- Each email is a `BaseMail` class in `app/modules/<module>/emails/`, next to an HTML template and a `_text` template. HTML templates print with `{{ }}`; text templates print with `{{{ }}}` so URLs keep their `&`. Guard optional values: Edge prints `undefined` and `null` literally.
- Mail classes never set `from`; `config/mail.ts` always sends from the platform's domain.
- A module with templates needs one `edge.mount("<module>", …)` line in `start/view.ts`; its templates are then `<module>::emails/<name>`. `metaFiles` in `adonisrc.ts` copies `app/modules/**/*.edge` into the build.
```

In `docs/architecture.md`, in `## Backend modules`, add this sentence to the end of the first paragraph (the one ending "so every rule lives in one place."):

```markdown
In `apps/platform`, each module is a folder in `app/modules/<module>/` (see `apps/platform/AGENTS.md`).
```

- [ ] **Step 11: Lint and typecheck**

Run from the repo root: `pnpm format:fix && pnpm check && pnpm --filter @tattoo-drip/platform typecheck`
Expected: all exit 0.

- [ ] **Step 12: Manual check in Mailpit (not committed)**

Start Mailpit from the repo root with `pnpm podman:up`, then from `apps/platform` run `node ace repl` and enter:

```js
const { default: mail } = await import("@adonisjs/mail/services/main")
const { default: User } = await import("#models/user")
const { default: VerifyEmailMail } = await import("#modules/identity/emails/verify_email_mail")
const user = new User(); user.email = "ink@example.com"; user.fullName = "Ada Ink"
await mail.send(new VerifyEmailMail(user, "http://localhost:3333/verify-email?token=abc&signature=xyz"))
```

Open `http://localhost:8025`. Expected: one email from `MAIL_FROM_ADDRESS` to `ink@example.com`, with the layout, the greeting, a working button, the fallback link, and a text tab with the raw URL. Look over Mailpit's HTML Check tab for anything unexpected; report what it flags rather than chasing a perfect score.

- [ ] **Step 13: Commit**

```bash
git add apps/platform/package.json apps/platform/adonisrc.ts apps/platform/start/view.ts apps/platform/app/modules apps/platform/tests/unit/modules apps/platform/AGENTS.md docs/architecture.md
git commit -F - <<'EOF'
feat(platform): add identity's verification email in the first module

Start app/modules/<module>/ with Identity. Module templates are reached
through a named Edge disk mounted in start/view.ts, and metaFiles copies
them into the production build. VerifyEmailMail renders the link it is
given in both HTML and plain text; making and signing the link stays
with the Identity service.

Refs: TAT-6

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```
