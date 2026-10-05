# Email templates and the first platform module

Date: 2026-10-04
Refs: TAT-6 (follow-on; the ticket's checklist is done in `de1daac`)

## Goal

Give the platform one way to write transactional emails, and use it for the first real email: Identity's email verification. The same change starts the `app/modules/<module>/` folder convention that every later module follows.

## Decisions

- Emails are Edge templates with hand-written inline styles and table layout. No MJML, no CSS inliner, no dark-mode CSS.
- The root layout and other shared email parts are Edge components in `resources/views/components/email/`.
- Each module lives in `app/modules/<module>/` and owns everything in it: models, services, controllers, validators and emails. Only new code goes there now. Existing User code (model, controllers, validator, transformer) moves when Identity is built, not in this change.
- Each email is a `BaseMail` subclass next to its templates. The module's own domain service sends it (`mail.send`, later `mail.sendLater`). No per-module mail service wraps it.
- Module templates are reached through a named Edge disk per module, mounted explicitly, one line per module.

## Layout and plumbing

```text
apps/platform/
  package.json                         + "#modules/*": "./app/modules/*.js"
  adonisrc.ts                          + metaFiles pattern "app/modules/**/*.edge"
                                       + preload () => import("#start/view")
  start/view.ts                        edge.mount("identity", app.makePath("app/modules/identity"))
  resources/views/components/email/
    layout.edge                        @email.layout({ title, preheader }) … @end
    button.edge                        @!email.button({ href, text })
```

- `start/view.ts` mounts each module that has views at the module's root, so templates are named `<module>::emails/<name>`. A module without a mount fails with Edge's `"<module>" namespace is not mounted`, which the module's render test catches.
- `metaFiles` matters: the production build only copies files that match a `metaFiles` pattern, and today only `resources/views/**/*.edge` does. Without the new pattern, module templates are missing in production.
- Edge 6 registers every file under a mounted disk's `components/` folder as a tag, so `components/email/layout.edge` is `@email.layout` with no registration code.

### `layout.edge`

The full HTML document: doctype, `charset` and `viewport` metas, the `title` prop, a hidden preheader from the `preheader` prop, a centred 600px table container, a "Tattoo Drip" header, the main slot, and a footer. All styles are inline. Colours are hard-coded hex values from the zinc palette. Tables are used so Outlook renders it correctly.

### `button.edge`

A table-based call-to-action button with inline styles, taking `href` and `text`. It is a component because nearly every transactional email has one.

## Identity's verification email

```text
app/modules/identity/emails/
  verify_email_mail.ts      class VerifyEmailMail extends BaseMail
  verify_email.edge         HTML, wrapped in @email.layout
  verify_email_text.edge    plain-text version
tests/unit/modules/identity/verify_email_mail.spec.ts
```

### `VerifyEmailMail`

- `constructor(user: User, verifyUrl: string)`. Making and signing the URL is the future Identity service's job; the mail only renders it.
- `subject = "Verify your email"`.
- `prepare()` sets `to(user.email)`, `htmlView("identity::emails/verify_email", data)` and `textView("identity::emails/verify_email_text", data)`, where `data` is `{ user, verifyUrl }`.
- It sets no `from`. The global `from` in `config/mail.ts` is always used, so mail always comes from the platform's domain.
- It imports `User` from `#models/user` until User moves into the module.

### Templates

- HTML: greets `user.fullName` when set and "Hi there" when it is null, one line of copy, `@!email.button({ href: verifyUrl, text: "Verify email" })`, the URL printed as a copy-paste fallback, and "If you didn't create an account, you can ignore this email."
- Text: the same copy with the bare URL.
- No expiry wording. It is added when the Identity ticket decides the expiry.

## Testing

`tests/unit/modules/identity/verify_email_mail.spec.ts`, the first test in the repo. It builds an unsaved `User` in memory, calls `buildWithContents()`, and asserts on the message:

- `assertTo(user.email)` and `assertSubject("Verify your email")`
- `assertHtmlIncludes(verifyUrl)` and `assertTextIncludes(verifyUrl)`
- `assertHtmlIncludes("Tattoo Drip")`, which proves the layout wrapped the template
- the greeting uses `fullName`, and falls back to "Hi there" when `fullName` is null

Rendering through `identity::` also proves the preload mount and the `#modules` alias work.

Manual check, not committed: send one email to Mailpit from `node ace repl`, look at it at `http://localhost:8025`, and check Mailpit's HTML check tab.

## Docs

- `apps/platform/AGENTS.md`, Layout section: add `app/modules/<module>/` and the email conventions (shared layout and components in `resources/views/components/email/`, module emails in `emails/`, one mount line in `start/view.ts`, `.edge` files covered by `metaFiles`, import with `#modules/*`).
- `docs/architecture.md`, Backend modules: one line pointing to the folder convention.

## Commits

Scoped `platform`, with `Refs: TAT-6`:

1. Layout and button components, with a render test.
2. Module plumbing (`#modules/*`, `metaFiles`, `start/view.ts`), `VerifyEmailMail`, its templates, its test and the docs. The plumbing ships with the first module because nothing can exercise it before one exists.

## Out of scope

- Moving existing User code into `app/modules/identity/`.
- Generating or signing verification URLs, and sending the email from a signup flow.
- A queue or `mail.sendLater`.
- An automated test against Mailpit. CI has no Mailpit service.
