# Intake form on the studio page (TAT-57) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the studio page's `#inquiry` section (TAT-48) with the intake form: the contract's fields, up to 5 reference photos re-encoded in the browser, a lazy Cloudflare Turnstile check and the honeypot (TAT-55), sent straight to the API with `useCreateInquiry()` (TAT-51), with fixed, kind copy for every refusal and a success screen that says the studio will reply on WhatsApp or Viber.

**Architecture:** Pure modules in `apps/storefront/src/intake/` (copy, rules, image pipeline, photo reducer, SDK input, error mapping, Turnstile controller, submit flow) carry every decision and are tested with `node:test` through seams (`ImageCodec`, `ChallengeHost`, `send`). Components in `src/intake/components/` wire them with TanStack Form (`useAppForm`) and are rendered in tests with `react-dom/server`. `IntakeMount` loads the form only after hydration, from its own chunk; until then TAT-48's chat-link fallback shows. The public Turnstile site key (`TURNSTILE_SITE_KEY`) is read by TAT-12's settings parser and reaches the browser in TAT-48's `SiteRef`.

**Tech Stack:** TanStack Start 1.168, TanStack Router 1.170, TanStack Form 1.33 (`useAppForm`, `revalidateLogic`, `errorMap.onServer`, form `listeners`), TanStack Query 5.104 (via `@tattoo-drip/react`'s `useCreateInquiry`), React 19 (`lazy`, `useSyncExternalStore`, refs as props), `@tattoo-drip/sdk` (`inquiries.create`, `INQUIRY_CHALLENGE_ACTION`, `INQUIRY_HONEYPOT_FIELD`, `TattooApiError`), Cloudflare Turnstile (explicit render, loaded at runtime, no package), `createImageBitmap` and canvas, Tailwind CSS v4, `node:test` with `tsx`, TypeScript 6, Biome.

**Spec:** `docs/superpowers/specs/2026-10-18-tat-57-intake-form-design.md` (read its Rulings first: they decide every open question).

## Global Constraints

- Storefront and docs only. No change to `apps/platform`, `packages/*` or `openapi.yaml`. The storefront never imports from `apps/platform` (tests may read platform or contract files as text). Never edit a real `.env`/`.env.local`; only `apps/storefront/.env.local.example`.
- **No dependency change: never run `pnpm add`, `pnpm remove` or a non-frozen `pnpm install`** (they re-resolve every `latest` specifier of the storefront in `pnpm-lock.yaml`). `apps/storefront/package.json` and `pnpm-lock.yaml` stay byte-for-byte as on the base. Everything used is already installed: `@tanstack/react-form`, `@tattoo-drip/react`, `@tattoo-drip/sdk`, `lucide-react`, `cn`, `radix-ui`.
- No new route: `src/routeTree.gen.ts` must not change (never hand-edit it).
- Wire names, verbatim: SDK input `challengeToken` (sent by the SDK as `X-Challenge-Token`), `honeypot` (sent as `website`); constants `INQUIRY_CHALLENGE_ACTION`, `INQUIRY_HONEYPOT_FIELD` from `@tattoo-drip/sdk`; field names `idea`, `placement`, `approximateSize`, `preferredDates`, `preferredArtistId`, `budget`, `sourceChannel`, `contactName`, `contactPhone`, `contactEmail`, `referenceImages`.
- Images, verbatim: `ACCEPT = "image/jpeg,image/png,image/webp"`; `MAX_REFERENCES = 5`; sources over 50 MiB refused; steps `1600 px @ 0.85`, `1600 px @ 0.72`, `1280 px @ 0.72` until at most 1 MiB; refused over 3.5 MiB; output `image/jpeg` named `reference.jpg` on `#ffffff`.
- Turnstile render options, verbatim: `sitekey`, `action: INQUIRY_CHALLENGE_ACTION`, `execution: "execute"`, `appearance: "interaction-only"`, `size: "flexible"`, `theme: "auto"`, `retry: "never"`, `"refresh-expired": "manual"`, `"response-field": false`, `"feedback-enabled": false`. Script `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=tattooDripTurnstileReady`. Script wait 20 s, token wait 30 s (none while the checkbox shows).
- Setting: `TURNSTILE_SITE_KEY`, read only in `src/tenancy/config.ts`, shape `/^[A-Za-z0-9_-]{10,100}$/`, required when `NODE_ENV=production`, optional otherwise, never echoed in an error, never `VITE_`.
- Every string the form shows comes from `src/intake/copy.ts` (Task 1 has the whole file). Names inside sentences render in `<bdi>` through `<Fill>`.
- Markup: no `dangerouslySetInnerHTML`, no `style` props, no `target`; every `href` passes TAT-48's `isAllowedHref`; `https:` links get `rel="noopener noreferrer"` (`linkRel`). No `localStorage`, `sessionStorage`, IndexedDB, cookies or analytics anywhere in `src/intake/`.
- `src/intake/{copy,rules,images,references,submission,problems,challenge,submit-flow}.ts` import no React, no TanStack package and touch no DOM global. Only `browser-codec.ts` and `challenge-host.ts` touch the DOM, inside their functions. Modules and tests import each other by relative path with the `.ts`/`.tsx` extension.
- Tests live in `apps/storefront/test/intake/` (and `test/ui/` for the toolkit), named `*.test.ts` (the runner's glob is `test/**/*.test.ts`); a `.tsx` helper in `test/` is fine for JSX.
- Run every `pnpm`/`node` command with Node 24.3.0 first on PATH, exactly as written (`PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH …`); the machine's default Node is 26. Commands run from the repository root (this worktree). `<scratchpad>` is the session's scratchpad directory; temp files go there, never `/tmp`. Never `sh -c`. Ports: 3402 platform tests, 3403 fake API, 3404 built storefront (3333 is taken). Start servers in the background and stop them by exact PID (never `pkill -f`).
- The NUL escape stays an escape: `"\u0000"` in rules.ts and rules.test.ts must be the six characters backslash, u, 0, 0, 0, 0, never a raw NUL byte (TAT-48's builder found its tool input turning such escapes into raw characters; a raw NUL breaks the file). After writing Tasks 2 and 5, run `rg -a -c "\x00" apps/storefront/src/intake apps/storefront/test/intake; echo "exit $?"` and expect `exit 1`. The Devanagari digit range in `asciiDigits` is written raw in this plan (`०` U+0966 to `९` U+096F, the same characters an escape would give) and may stay raw; with `0x0966` it maps each digit to 0 to 9. The Devanagari text in tests (`९८१२३४५६७८`, `मीना गुरुङ`) is meant to be raw.
- commitlint caps a commit's header and body lines at 100 characters; the messages below fit.
- The pre-commit hook runs Biome on staged files and may rewrite them: re-read a file before editing it again. Commits are Conventional Commits with the `storefront` scope (`docs` for the docs task) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or the attribution line of your own session's reminder). Never push, never open a PR.

## Review Focus

1. A phone number typed on a Nepali keyboard (Devanagari digits, `९८१२३४५६७८`) must be accepted and sent as ASCII digits, not refused. Tests: Task 2 "turns Devanagari digits into ASCII ones", "reads phone numbers the way the API does"; Task 5 "sends Devanagari digits as ASCII ones".
2. A long idea pasted into the box must never be cut off silently. Tests: Task 2 "takes each field up to its column's length, and no more" (4001 is an error, not a truncation); Task 11 "the idea box has no maxlength, so a paste is never cut".
3. A photo removed while it is being prepared must not come back, must not let a second decode start alongside, and must leave no preview URL behind. Tests: Task 4 "a photo removed mid-work stays gone and the next one waits", "makes no URL for a photo that isn't ready, and revokes the ones that went".
4. The API's error on `referenceImages.<i>` must mark the photo that was sent at index `i`, even if photos were added or removed after the send. Test: Task 4 "puts the API's photo errors on the photos that were sent, by their index then".
5. A rate limit of hours (the phone limit is per day) must say hours and block Send that long, and a 429 without `Retry-After` must still block for a minute. Tests: Task 7 "rate limits say how long", "formatWait".

---

## Task 0: Preconditions

- [ ] **Step 1: The base has the built TAT-44, TAT-48 and TAT-55.** This branch was designed on c103fa0 (designs only). Run:

```bash
rg -n "acceptingInquiries|closedMessage" packages/types/src/openapi.gen.ts
rg -n "export const INQUIRY_CHALLENGE_ACTION|export const INQUIRY_HONEYPOT_FIELD|honeypot\?: string|X-Challenge-Token" packages/sdk/src/client.ts
rg -n "INQUIRY_CHALLENGE_ACTION|INQUIRY_HONEYPOT_FIELD" packages/sdk/src/index.ts
rg -n "TURNSTILE_SECRET_KEY" apps/platform/start/env.ts
rg -n "export type InquiryState|export interface InquiryChannels|export interface InquiryArtist" apps/storefront/src/studio/inquiry.ts
rg -n "export function InquirySection|function InquiryFallback" apps/storefront/src/studio/components/inquiry.tsx
rg -n "export function (StudioPage|ArtistPage)" apps/storefront/src/studio/components/pages.tsx
rg -n "export function (linkRel|isAllowedHref)" apps/storefront/src/studio/links.ts
rg -n "export class SiteRef|export function (dehydrateSite|hydrateSite|parseSiteOrigin)|export interface DehydratedSite" apps/storefront/src/site/context.ts
rg -n "site.connect\(" apps/storefront/src/site/request.ts
rg -n "function (StudioRoute|ArtistRoute)" apps/storefront/src/routes/index.tsx "apps/storefront/src/routes/artists/\$slug.tsx"
ls apps/storefront/src/features/intake/booking-form.tsx apps/storefront/src/features/intake/booking-schema.ts apps/storefront/test/studio/prototype-removed.test.ts apps/storefront/test/site/context.test.ts apps/storefront/test/studio/render.test.ts apps/storefront/test/tenancy/config.test.ts apps/storefront/test/scripts/check-client-bundle.test.ts apps/storefront/scripts/check-page.mjs
```

Expected: every pattern found and every file listed. If anything is missing, STOP: the branch must first be rebased onto the newest built tip that holds TAT-44, TAT-48 and TAT-55 (on TAT-12, TAT-23 and the public API chain); that is the coordinator's call, and only the spec and plan commit sits on top. If a review renamed one of these, use the real name everywhere below.

- [ ] **Step 2: Check two signatures this plan relies on.** Run `rg -n "export function linkRel" -A4 apps/storefront/src/studio/links.ts` and `rg -n "challengeToken|honeypot" -B1 -A6 packages/sdk/src/client.ts`. Expected: `linkRel(href: string)` returns `"noopener noreferrer"` for `http(s)` links and `undefined` otherwise; `CreateInquiryInput` has `challengeToken?: string` and `honeypot?: string`; `inquiries.create` sets the `X-Challenge-Token` header when `challengeToken` is set and the `website` field only when `honeypot` is non-empty. If either differs, adapt the calls below to the real signature and say so in the report.

- [ ] **Step 3: Clean tree and Node.** `git status -sb` shows no changes; `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node --version` prints `v24.3.0`.

- [ ] **Step 4: Baselines.** Run and note the `# pass` count:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck
```

Expected: `# fail 0`; typecheck passes. Note `git rev-parse HEAD` as `<base>` (Task 14 checks that the dependency files and the route tree are unchanged since).

- [ ] **Step 5: Read the code you will edit or use.** `apps/storefront/src/components/ui/form.tsx`, `src/components/ui/field.tsx`, `src/studio/inquiry.ts`, `src/studio/components/inquiry.tsx`, `src/studio/components/pages.tsx`, `src/studio/links.ts`, `src/site/context.ts`, `src/site/request.ts`, `src/tenancy/config.ts`, `src/routes/index.tsx`, `src/routes/artists/$slug.tsx`, `src/styles.css`, `scripts/check-client-bundle.mjs`, `scripts/check-page.mjs`, `test/site/context.test.ts`, `test/studio/prototype-removed.test.ts`, `packages/sdk/src/client.ts` (`inquiries.create`), `packages/react/src/hooks.ts` (`useCreateInquiry`). The edits below are written against TAT-48's and TAT-55's plans; if a review changed these files, apply the same change to the code as it is now.

---

### Task 1: Every word the form shows

**Files:**
- Create: `apps/storefront/src/intake/copy.ts`
- Test: `apps/storefront/test/intake/copy.test.ts`

**Interfaces:**
- Consumes: `type SourceChannel` from `@tattoo-drip/sdk`; `type IntakeField` from `./rules.ts` (a type-only import of a file Task 2 creates; type imports are erased, so this task's test runs before it exists, and Task 2's typecheck covers it).
- Produces: `copy` (the whole object below), `fill(template, values?): string`, `fillParts(template, values): Part[]`, `type Part = { text: string } | { value: string }`, `NOTICE_CODES`, `type NoticeCode`, `PHOTO_PROBLEMS`, `type PhotoProblem`, `interface Notice { title: string; body: string }`, `interface FieldCopy { label: string; hint?: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/copy.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	copy,
	fill,
	fillParts,
	NOTICE_CODES,
	PHOTO_PROBLEMS,
} from "../../src/intake/copy.ts";

/** The placeholders the form fills somewhere. */
const PLACEHOLDERS = new Set([
	"studio",
	"phone",
	"max",
	"count",
	"size",
	"index",
	"name",
	"message",
	"artist",
	"wait",
	"photos",
]);

/** Every string in the copy, with its path. */
function strings(value: unknown, path = "copy"): Array<[string, string]> {
	if (typeof value === "string") return [[path, value]];
	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([key, child]) =>
			strings(child, `${path}.${key}`),
		);
	}
	return [];
}

describe("fill", () => {
	test("puts each value in its placeholder", () => {
		assert.equal(
			fill("{studio} will reply at {phone}.", {
				studio: "Black Needle",
				phone: "9812345678",
			}),
			"Black Needle will reply at 9812345678.",
		);
		assert.equal(fill("{count} of {max}", { count: 2, max: 5 }), "2 of 5");
	});

	test("leaves a placeholder it has no value for", () => {
		assert.equal(fill("Hi {studio}", {}), "Hi {studio}");
	});

	test("inserts values as they are, never as more placeholders", () => {
		assert.equal(
			fill("{name} isn't a photo", { name: "{studio}.png" }),
			"{studio}.png isn't a photo",
		);
	});
});

describe("fillParts", () => {
	test("splits a template into text and values", () => {
		assert.deepEqual(
			fillParts("Tell {studio} about it, {name}.", {
				studio: "अर्जुन",
				name: "Sita",
			}),
			[
				{ text: "Tell " },
				{ value: "अर्जुन" },
				{ text: " about it, " },
				{ value: "Sita" },
				{ text: "." },
			],
		);
	});

	test("keeps text without placeholders whole, and an unknown placeholder as text", () => {
		assert.deepEqual(fillParts("Send inquiry", {}), [{ text: "Send inquiry" }]);
		assert.deepEqual(fillParts("Hi {who}", {}), [{ text: "Hi {who}" }]);
	});
});

describe("the copy", () => {
	test("uses only the placeholders the form fills, and no stray braces", () => {
		for (const [path, text] of strings(copy)) {
			for (const match of text.matchAll(/\{(\w+)\}/g)) {
				assert.ok(PLACEHOLDERS.has(match[1]), `${path}: {${match[1]}}`);
			}
			assert.doesNotMatch(text.replace(/\{\w+\}/g, ""), /[{}]/, path);
		}
	});

	test("has no empty string", () => {
		for (const [path, text] of strings(copy)) {
			assert.ok(text.trim().length > 0, path);
		}
	});

	test("explains every notice and every photo problem", () => {
		for (const code of NOTICE_CODES) {
			assert.ok(copy.notices[code].title.length > 0, code);
			assert.ok(copy.notices[code].body.length > 0, code);
		}
		for (const problem of PHOTO_PROBLEMS) {
			assert.match(copy.photos.problems[problem], /\{name\}/, problem);
		}
	});

	test("labels every source channel, in the contract's order", () => {
		assert.deepEqual(Object.keys(copy.channels), [
			"instagram",
			"facebook",
			"tiktok",
			"google",
			"friend",
			"other",
		]);
	});

	test("tells the person the studio replies on WhatsApp or Viber, at their number", () => {
		assert.match(copy.sent.body, /WhatsApp or Viber/);
		assert.match(copy.sent.body, /\{phone\}/);
		assert.match(copy.sent.body, /\{studio\}/);
	});

	test("names Cloudflare in the privacy line", () => {
		assert.match(copy.privacy, /Cloudflare/);
		assert.match(copy.privacy, /\{studio\}/);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/copy.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/copy.ts`.

- [ ] **Step 3: Write `copy.ts`**

Create `apps/storefront/src/intake/copy.ts`:

```ts
import type { SourceChannel } from "@tattoo-drip/sdk";
import type { IntakeField } from "./rules.ts";

/*
 * Every word the intake form shows (TAT-57), in English. Templates hold
 * named placeholders ({studio}, {phone}…) that `fill` replaces; components
 * render the values in <bdi> through <Fill> (components/fill.tsx), because
 * names may be Nepali or right-to-left. A Nepali version would be a second
 * object of the same shape: nothing else would change.
 */

/** The refusals the form explains with a notice (problems.ts). */
export const NOTICE_CODES = [
	"already-waiting",
	"studio-closed",
	"challenge-failed",
	"challenge-unavailable",
	"challenge-blocked",
	"challenge-expired",
	"challenge-unsupported",
	"rate-limited",
	"too-large",
	"cut-off",
	"page-outdated",
	"timeout",
	"offline",
	"invalid",
	"server",
] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

/** Why a picked photo wasn't added (images.ts). */
export const PHOTO_PROBLEMS = [
	"unsupported",
	"heic",
	"too-big",
	"unreadable",
	"too-heavy",
] as const;
export type PhotoProblem = (typeof PHOTO_PROBLEMS)[number];

export interface Notice {
	readonly title: string;
	readonly body: string;
}

export interface FieldCopy {
	readonly label: string;
	readonly hint?: string;
}

const fields: Readonly<Record<IntakeField, FieldCopy>> = {
	idea: {
		label: "Your idea",
		hint: "What you'd like, its style, and anything that matters to you.",
	},
	placement: { label: "Where on your body", hint: "For example, left forearm" },
	approximateSize: {
		label: "Rough size",
		hint: "For example, about 10 cm, or palm-sized",
	},
	preferredDates: {
		label: "When would suit you",
		hint: "For example, any weekday in November",
	},
	preferredArtistId: { label: "Artist" },
	budget: { label: "Budget (optional)", hint: "For example, NPR 15,000" },
	sourceChannel: { label: "How did you find {studio}?" },
	contactName: { label: "Your name" },
	contactPhone: {
		label: "WhatsApp or Viber number",
		hint: "{studio} replies here. A Nepali number needs no +977.",
	},
	contactEmail: { label: "Email (optional)" },
};

/** What a required field says when it is left empty. */
const required: Readonly<Partial<Record<IntakeField, string>>> = {
	idea: "Describe the tattoo you'd like.",
	placement: "Say where on your body it goes.",
	approximateSize: "Give a rough size.",
	preferredDates: "Say when would suit you.",
	sourceChannel: "Choose how you found {studio}.",
	contactName: "Enter your name.",
	contactPhone: "Enter your WhatsApp or Viber number.",
};

const channels: Readonly<Record<SourceChannel, string>> = {
	instagram: "Instagram",
	facebook: "Facebook",
	tiktok: "TikTok",
	google: "Google",
	friend: "A friend",
	other: "Somewhere else",
};

const photoProblems: Readonly<Record<PhotoProblem, string>> = {
	unsupported:
		"{name} isn't a photo this form can use. Add a JPEG, PNG or WebP image.",
	heic: "{name} is a HEIC photo, which this browser can't convert. Add a screenshot of it or a JPEG copy instead.",
	"too-big":
		"{name} is too big to prepare (over 50 MB). Add a smaller copy or a screenshot.",
	unreadable:
		"{name} couldn't be opened. Try another photo, or a screenshot of it.",
	"too-heavy":
		"{name} couldn't be made small enough to send. Try a screenshot of it instead.",
};

const notices: Readonly<Record<NoticeCode, Notice>> = {
	"already-waiting": {
		title: "You already have inquiries waiting",
		body: "{studio} has your earlier inquiries and will reply on WhatsApp or Viber. To add something, message them.",
	},
	"studio-closed": {
		title: "{studio} isn't taking new inquiries right now",
		body: "They closed their inquiries while you were writing. You can still message them.",
	},
	"challenge-failed": {
		title: "We couldn't confirm you're a person",
		body: "Send again. If it keeps happening, message {studio} instead.",
	},
	"challenge-unavailable": {
		title: "The security check isn't working right now",
		body: "Send again in a minute, or message {studio} instead.",
	},
	"challenge-blocked": {
		title: "The security check didn't finish",
		body: "An ad blocker or a weak connection may be stopping it. Send again, or message {studio} instead.",
	},
	"challenge-expired": {
		title: "The security check timed out",
		body: "Send again, and tick the box when it appears.",
	},
	"challenge-unsupported": {
		title: "This browser can't run the security check",
		body: "Try another browser, or message {studio} instead.",
	},
	"rate-limited": {
		title: "Too many tries",
		body: "Wait {wait} before sending again, or message {studio} instead.",
	},
	"too-large": {
		title: "Your photos are too large to send together",
		body: "Remove a photo or two, then send again.",
	},
	"cut-off": {
		title: "The upload was cut off",
		body: "Check your connection, then send again. Everything you entered is still here.",
	},
	"page-outdated": {
		title: "This page is out of date",
		body: "Reload it to send your inquiry. Copy your idea first: reloading clears the form.",
	},
	timeout: {
		title: "Sending took too long",
		body: "Your connection may be slow. Everything you entered is still here: send again, perhaps with fewer photos or on Wi-Fi. If {studio} got it already, they'll reply on WhatsApp or Viber.",
	},
	offline: {
		title: "Your inquiry wasn't sent",
		body: "We couldn't reach Tattoo Drip. Check your connection, then send again. Everything you entered is still here.",
	},
	invalid: {
		title: "Some answers weren't accepted",
		body: "Check the form, then send again.",
	},
	server: {
		title: "Something went wrong on our side",
		body: "Send again in a minute. If it keeps happening, message {studio} instead.",
	},
};

export const copy = {
	required: "Everything is needed unless it says (optional).",
	privacy:
		"Only {studio} sees what you send, photos included; Tattoo Drip runs this page for them. To keep spam bots out, a Cloudflare check starts when you begin filling this in. Cloudflare sees your connection and device, not your answers.",
	privacyLink: "Cloudflare's privacy notice",
	tattooLegend: "Your tattoo",
	contactLegend: "How {studio} reaches you",
	fields,
	noPreference: "No preference",
	channels,
	photos: {
		legend: "Reference photos (optional)",
		hint: "Up to {max} photos: designs you like, or the spot on your body. Only {studio} sees them.",
		add: "Add photos",
		count: "{count} of {max} photos, {size} in total",
		full: "That's {max} photos, the most you can send. Remove one to add another.",
		alt: "Reference photo {index}",
		remove: "Remove reference photo {index}",
		preparing: "Preparing…",
		tooManyOne: "You can send up to {max} photos, so one wasn't added.",
		tooMany: "You can send up to {max} photos, so {count} weren't added.",
		problems: photoProblems,
		refused: "This photo wasn't accepted: {message} Remove it, then send again.",
		itemError: "Reference photo {index}: {message}",
		fixPhotos: "Remove the photo marked with a problem.",
	},
	honeypot: "Leave this empty",
	send: "Send inquiry",
	sending: "Sending…",
	sendAgain: "Send again",
	reload: "Reload the page",
	chat: "Prefer to chat?",
	chatLinks: {
		whatsapp: "Message on WhatsApp",
		email: "Send an email",
		instagram: "Message on Instagram",
	},
	status: {
		preparing: "Preparing your photos…",
		checking: "Running a quick security check…",
		interactive: "Tick the box above to send.",
		sending: "Sending your inquiry…",
		sendingPhotos: "Sending your inquiry with {photos} ({size})…",
		stillSending:
			"Still sending. On a slow connection this can take up to 2 minutes; keep this page open.",
		photoOne: "1 photo",
		photoMany: "{count} photos",
	},
	errors: {
		required,
		tooLong: "Use at most {max} characters.",
		nul: "Remove the unsupported characters.",
		phone: "Enter a phone number, like 9812345678 or +977 1 4123456.",
		email: "Enter a valid email address, or leave it empty.",
		artist: "Choose an artist from the list, or No preference.",
		artistClosed:
			"{artist} just stopped taking new inquiries. Choose another artist, or No preference.",
		artistClosedUnnamed:
			"That artist just stopped taking new inquiries. Choose another artist, or No preference.",
		summaryOne: "Check this answer before sending",
		summaryMany: "Check these {count} answers before sending",
	},
	notices,
	wait: {
		minute: "a minute",
		minutes: "{count} minutes",
		hour: "an hour",
		hours: "{count} hours",
	},
	sent: {
		title: "Inquiry sent",
		body: "{studio} will reply on WhatsApp or Viber at {phone}.",
		more: "Want to add something? Message them:",
		back: "Back to the studio page",
	},
};

type Values = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

/** `template` with each {name} replaced by `values[name]`; a placeholder without a value stays. */
export function fill(template: string, values: Values = {}): string {
	return template.replace(PLACEHOLDER, (match, name: string) =>
		name in values ? String(values[name]) : match,
	);
}

export type Part = { readonly text: string } | { readonly value: string };

/** `template` as text and values, so a component can put the values in <bdi>. */
export function fillParts(template: string, values: Values): Part[] {
	const parts: Part[] = [];
	let text = "";
	let last = 0;
	for (const match of template.matchAll(PLACEHOLDER)) {
		const name = match[1];
		if (!(name in values)) continue;
		text += template.slice(last, match.index);
		if (text) parts.push({ text });
		text = "";
		parts.push({ value: String(values[name]) });
		last = match.index + match[0].length;
	}
	text += template.slice(last);
	if (text) parts.push({ text });
	return parts;
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/copy.test.ts`
Expected: PASS. (The typecheck runs after Task 2, which creates `rules.ts`.)

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/intake/copy.ts apps/storefront/test/intake/copy.test.ts
git commit -m "feat(storefront): write the intake form's copy in one place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The rules the form checks before sending

**Files:**
- Create: `apps/storefront/src/intake/rules.ts`
- Test: `apps/storefront/test/intake/rules.test.ts`

**Interfaces:**
- Consumes: `copy`, `fill` (Task 1); `type SourceChannel` from `@tattoo-drip/sdk`.
- Produces: `INTAKE_LIMITS` (`{ idea: 4000, placement: 120, approximateSize: 120, preferredDates: 500, budget: 120, contactName: 120, contactPhone: 40, contactEmail: 254 }`), `SOURCE_CHANNELS`, `REQUIRED_FIELDS`, `interface IntakeValues`, `type IntakeField = keyof IntakeValues`, `type FieldErrors = Partial<Record<IntakeField, string>>`, `FIELD_ORDER: readonly IntakeField[]`, `interface IntakeRules { studioName: string; artistIds: readonly string[] }`, `initialValues(preferredArtistId: string | null): IntakeValues`, `asciiDigits(value: string): string`, `normalizePhone(value: string): string | undefined`, `validateIntake(values: IntakeValues, rules: IntakeRules): FieldErrors`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/rules.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
	asciiDigits,
	FIELD_ORDER,
	INTAKE_LIMITS,
	type IntakeValues,
	initialValues,
	normalizePhone,
	REQUIRED_FIELDS,
	SOURCE_CHANNELS,
	validateIntake,
} from "../../src/intake/rules.ts";

const SITA_ID = "0199f000-0000-7000-8000-000000000048";
const RULES = { studioName: "Black Needle", artistIds: [SITA_ID] };
const VALID: IntakeValues = {
	idea: "A fine-line peony with two leaves",
	placement: "Left forearm",
	approximateSize: "About 10 cm",
	preferredDates: "Any weekday in November",
	preferredArtistId: "",
	budget: "",
	sourceChannel: "instagram",
	contactName: "Asha Gurung",
	contactPhone: "98-1234-5678",
	contactEmail: "",
};

const CONTRACT = readFileSync(
	new URL("../../../../packages/types/openapi.yaml", import.meta.url),
	"utf8",
);

/** The lines of InquiryInput's property `name` in the contract. */
function contractProperty(name: string): string {
	const start = CONTRACT.indexOf("\n    InquiryInput:");
	const end = CONTRACT.indexOf("\n    InquiryForm:", start);
	assert.ok(start > 0 && end > start, "InquiryInput in openapi.yaml");
	const lines = CONTRACT.slice(start, end).split("\n");
	const at = lines.findIndex((line) => line.startsWith(`        ${name}:`));
	assert.ok(at >= 0, `InquiryInput.${name} in openapi.yaml`);
	const own = [lines[at]];
	for (const line of lines.slice(at + 1)) {
		if (!line.startsWith("          ")) break;
		own.push(line);
	}
	return own.join("\n");
}

describe("normalizePhone (a copy of the platform's)", () => {
	// The table of apps/platform/tests/unit/validators/phone.spec.ts.
	for (const [input, expected] of [
		["9812345678", "+9779812345678"],
		["98-1234-5678", "+9779812345678"],
		["01 4123456", "+97714123456"],
		["+977 981 234 5678", "+9779812345678"],
		["00977 9812345678", "+9779812345678"],
		["9779812345678", "+9779812345678"],
		["977-1-4123456", "+97714123456"],
		["+1 (415) 555-0100", "+14155550100"],
	] as const) {
		test(`"${input}" becomes ${expected}`, () => {
			assert.equal(normalizePhone(input), expected);
		});
	}

	for (const input of [
		"",
		"12345",
		"98123456781234567",
		"call me",
		"+0 123 456 789",
	]) {
		test(`"${input}" is not a phone number`, () => {
			assert.equal(normalizePhone(input), undefined);
		});
	}
});

describe("asciiDigits", () => {
	test("turns Devanagari digits into ASCII ones and leaves the rest", () => {
		assert.equal(asciiDigits("९८१२३४५६७८"), "9812345678");
		assert.equal(asciiDigits("+९७७ ९८-१२३४"), "+977 98-1234");
		assert.equal(asciiDigits("98 1234"), "98 1234");
	});
});

describe("validateIntake", () => {
	test("accepts a whole inquiry", () => {
		assert.deepEqual(validateIntake(VALID, RULES), {});
	});

	test("asks for each required answer, in words that fit it", () => {
		const blank = {
			...VALID,
			idea: " ",
			placement: "",
			approximateSize: "\n",
			preferredDates: "",
			sourceChannel: "",
			contactName: "  ",
			contactPhone: "",
		} satisfies IntakeValues;

		assert.deepEqual(validateIntake(blank, RULES), {
			idea: "Describe the tattoo you'd like.",
			placement: "Say where on your body it goes.",
			approximateSize: "Give a rough size.",
			preferredDates: "Say when would suit you.",
			sourceChannel: "Choose how you found Black Needle.",
			contactName: "Enter your name.",
			contactPhone: "Enter your WhatsApp or Viber number.",
		});
	});

	test("lets the optional answers stay empty", () => {
		assert.deepEqual(
			validateIntake(
				{ ...VALID, budget: " ", contactEmail: "", preferredArtistId: "" },
				RULES,
			),
			{},
		);
	});

	test("takes each field up to its column's length, and no more", () => {
		for (const field of [
			"idea",
			"placement",
			"approximateSize",
			"preferredDates",
			"budget",
			"contactName",
		] as const) {
			const max = INTAKE_LIMITS[field];
			assert.equal(
				validateIntake({ ...VALID, [field]: "a".repeat(max) }, RULES)[field],
				undefined,
				field,
			);
			assert.equal(
				validateIntake({ ...VALID, [field]: "a".repeat(max + 1) }, RULES)[field],
				`Use at most ${max} characters.`,
				field,
			);
		}
		assert.equal(
			validateIntake({ ...VALID, contactPhone: `98${" ".repeat(37)}12345678` }, RULES)
				.contactPhone,
			"Use at most 40 characters.",
		);
		assert.equal(
			validateIntake({ ...VALID, contactEmail: `${"a".repeat(243)}@example.com` }, RULES)
				.contactEmail,
			"Use at most 254 characters.",
		);
	});

	test("counts what is left after trimming, as the API does", () => {
		assert.equal(
			validateIntake({ ...VALID, placement: ` ${"a".repeat(120)} ` }, RULES).placement,
			undefined,
		);
	});

	test("refuses a NUL character anywhere", () => {
		for (const field of ["idea", "placement", "budget", "contactName"] as const) {
			assert.equal(
				validateIntake({ ...VALID, [field]: "fine\u0000line" }, RULES)[field],
				"Remove the unsupported characters.",
				field,
			);
		}
	});

	test("reads phone numbers the way the API does", () => {
		for (const phone of [
			"9812345678",
			"+977 981 234 5678",
			"01 4123456",
			"९८१२३४५६७८",
			"+1 (415) 555-0100",
		]) {
			assert.equal(
				validateIntake({ ...VALID, contactPhone: phone }, RULES).contactPhone,
				undefined,
				phone,
			);
		}
		for (const phone of ["12345", "call me", "+0 123 456 789"]) {
			assert.equal(
				validateIntake({ ...VALID, contactPhone: phone }, RULES).contactPhone,
				"Enter a phone number, like 9812345678 or +977 1 4123456.",
				phone,
			);
		}
	});

	test("takes an email or none", () => {
		assert.equal(
			validateIntake({ ...VALID, contactEmail: "asha@example.com" }, RULES).contactEmail,
			undefined,
		);
		for (const email of ["asha", "asha@", "a b@example.com"]) {
			assert.equal(
				validateIntake({ ...VALID, contactEmail: email }, RULES).contactEmail,
				"Enter a valid email address, or leave it empty.",
				email,
			);
		}
	});

	test("takes an artist from the list, or no preference", () => {
		assert.equal(
			validateIntake({ ...VALID, preferredArtistId: SITA_ID }, RULES).preferredArtistId,
			undefined,
		);
		assert.equal(
			validateIntake(
				{ ...VALID, preferredArtistId: "0199f000-0000-7000-8000-000000000099" },
				RULES,
			).preferredArtistId,
			"Choose an artist from the list, or No preference.",
		);
	});

	test("takes only the contract's source channels", () => {
		for (const channel of SOURCE_CHANNELS) {
			assert.equal(
				validateIntake({ ...VALID, sourceChannel: channel }, RULES).sourceChannel,
				undefined,
			);
		}
		assert.equal(
			validateIntake(
				{ ...VALID, sourceChannel: "twitter" as IntakeValues["sourceChannel"] },
				RULES,
			).sourceChannel,
			"Choose how you found Black Needle.",
		);
	});

	test("knows every field, in the form's order", () => {
		assert.deepEqual([...FIELD_ORDER], Object.keys(VALID));
	});

	test("starts empty, with the artist an artist's page asks for", () => {
		assert.deepEqual(initialValues(null), {
			idea: "",
			placement: "",
			approximateSize: "",
			preferredDates: "",
			preferredArtistId: "",
			budget: "",
			sourceChannel: "",
			contactName: "",
			contactPhone: "",
			contactEmail: "",
		});
		assert.equal(initialValues(SITA_ID).preferredArtistId, SITA_ID);
	});
});

describe("pinned to the contract (packages/types/openapi.yaml)", () => {
	test("each limit is InquiryInput's maxLength", () => {
		for (const [field, max] of Object.entries(INTAKE_LIMITS)) {
			assert.match(contractProperty(field), new RegExp(`maxLength: ${max}\\b`), field);
		}
	});

	test("the source channels are the contract's, in its order", () => {
		const match = /\n {4}SourceChannel:\n[\s\S]*?enum: \[([^\]]*)\]/.exec(CONTRACT);
		assert.ok(match, "SourceChannel's enum");
		assert.deepEqual(
			match[1].split(",").map((value) => value.trim()),
			[...SOURCE_CHANNELS],
		);
	});

	test("the required fields are the contract's", () => {
		const match = /\n {4}InquiryInput:[\s\S]*?required: \[([^\]]*)\]/.exec(CONTRACT);
		assert.ok(match, "InquiryInput's required list");
		assert.deepEqual(
			match[1].split(",").map((value) => value.trim()).sort(),
			[...REQUIRED_FIELDS].sort(),
		);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/rules.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/rules.ts`.

- [ ] **Step 3: Write `rules.ts`**

Create `apps/storefront/src/intake/rules.ts`:

```ts
import type { SourceChannel } from "@tattoo-drip/sdk";
import { copy, fill } from "./copy.ts";

/*
 * What the intake form checks before it sends (TAT-57, spec ruling 4). The
 * API is the authority (TAT-51's intakeValidator); this mirrors its common
 * cases so a person sees a problem before a slow upload, not after.
 */

/** The longest each text field may be: the inquiry columns', pinned to openapi.yaml by its test. */
export const INTAKE_LIMITS = {
	idea: 4000,
	placement: 120,
	approximateSize: 120,
	preferredDates: 500,
	budget: 120,
	contactName: 120,
	contactPhone: 40,
	contactEmail: 254,
} as const;

/** How a person found the studio, in the contract's order. */
export const SOURCE_CHANNELS = [
	"instagram",
	"facebook",
	"tiktok",
	"google",
	"friend",
	"other",
] as const satisfies readonly SourceChannel[];

export interface IntakeValues {
	idea: string;
	placement: string;
	approximateSize: string;
	preferredDates: string;
	/** An artist's id, or "" for no preference. */
	preferredArtistId: string;
	budget: string;
	/** "" until the person picks one. */
	sourceChannel: SourceChannel | "";
	contactName: string;
	contactPhone: string;
	contactEmail: string;
}

export type IntakeField = keyof IntakeValues;
export type FieldErrors = Partial<Record<IntakeField, string>>;

/** The fields in the order the form shows them (the error summary keeps it). */
export const FIELD_ORDER: readonly IntakeField[] = [
	"idea",
	"placement",
	"approximateSize",
	"preferredDates",
	"preferredArtistId",
	"budget",
	"sourceChannel",
	"contactName",
	"contactPhone",
	"contactEmail",
];

/** The contract's required fields (InquiryInput), pinned by the test. */
export const REQUIRED_FIELDS: readonly IntakeField[] = [
	"idea",
	"placement",
	"approximateSize",
	"preferredDates",
	"sourceChannel",
	"contactName",
	"contactPhone",
];

/** What validateIntake needs besides the values. */
export interface IntakeRules {
	readonly studioName: string;
	/** The artists the person can choose (TAT-48's InquiryState.artists). */
	readonly artistIds: readonly string[];
}

export function initialValues(preferredArtistId: string | null): IntakeValues {
	return {
		idea: "",
		placement: "",
		approximateSize: "",
		preferredDates: "",
		preferredArtistId: preferredArtistId ?? "",
		budget: "",
		sourceChannel: "",
		contactName: "",
		contactPhone: "",
		contactEmail: "",
	};
}

/** Devanagari digits (a Nepali keyboard's) as ASCII ones; everything else unchanged. */
export function asciiDigits(value: string): string {
	return value.replace(/[०-९]/g, (digit) =>
		String(digit.charCodeAt(0) - 0x0966),
	);
}

// A copy of apps/platform/app/validators/phone.ts (the storefront can't
// import the platform); test/intake/rules.test.ts runs the platform's table.
const DEFAULT_COUNTRY_CODE = "977";
const E164 = /^\+[1-9]\d{7,14}$/;
const NEPALI_NATIONAL = /^\d{8,10}$/;
const NEPALI_WITH_CODE = /^977\d{8,10}$/;

/** The phone in E.164, or undefined if it can't be one (the platform's rule). */
export function normalizePhone(value: string): string | undefined {
	const compact = value.replace(/[\s\-.()]/g, "");
	if (compact.startsWith("+")) {
		return E164.test(compact) ? compact : undefined;
	}
	if (compact.startsWith("00")) {
		const international = `+${compact.slice(2)}`;
		return E164.test(international) ? international : undefined;
	}
	if (compact.length > 10 && NEPALI_WITH_CODE.test(compact)) {
		return `+${compact}`;
	}
	const national = compact.replace(/^0/, "");
	return NEPALI_NATIONAL.test(national)
		? `+${DEFAULT_COUNTRY_CODE}${national}`
		: undefined;
}

/** Loose on purpose: the API checks the address properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Every problem with the values, one message per field. */
export function validateIntake(
	values: IntakeValues,
	rules: IntakeRules,
): FieldErrors {
	const errors: FieldErrors = {};
	for (const field of FIELD_ORDER) {
		const message = fieldError(field, values[field].trim(), rules);
		if (message) errors[field] = message;
	}
	return errors;
}

function fieldError(
	field: IntakeField,
	value: string,
	rules: IntakeRules,
): string | undefined {
	const studio = { studio: rules.studioName };
	if (value.includes("\u0000")) return copy.errors.nul;
	if (value === "") {
		const message = copy.errors.required[field];
		return message ? fill(message, studio) : undefined;
	}
	const max =
		field in INTAKE_LIMITS
			? INTAKE_LIMITS[field as keyof typeof INTAKE_LIMITS]
			: undefined;
	if (max !== undefined && value.length > max) {
		return fill(copy.errors.tooLong, { max });
	}
	switch (field) {
		case "contactPhone":
			return normalizePhone(asciiDigits(value)) ? undefined : copy.errors.phone;
		case "contactEmail":
			return EMAIL.test(value) ? undefined : copy.errors.email;
		case "preferredArtistId":
			return rules.artistIds.includes(value) ? undefined : copy.errors.artist;
		case "sourceChannel":
			return (SOURCE_CHANNELS as readonly string[]).includes(value)
				? undefined
				: fill(copy.errors.required.sourceChannel ?? "", studio);
		default:
			return undefined;
	}
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/copy.test.ts test/intake/rules.test.ts`
Expected: PASS.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS (copy.ts's type import of `IntakeField` now resolves). If TypeScript says `IntakeField` isn't assignable as a `Record` key in `copy.ts`, check that `rules.ts` exports `IntakeField` exactly as above.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/intake/rules.ts apps/storefront/test/intake/rules.test.ts
git commit -m "feat(storefront): check intake answers the way the API does, before the upload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Photos shrunk in the browser, behind a codec seam

**Files:**
- Create: `apps/storefront/src/intake/images.ts`
- Create: `apps/storefront/src/intake/browser-codec.ts` (DOM; no node test: the browser pass covers it)
- Test: `apps/storefront/test/intake/images.test.ts`

**Interfaces:**
- Consumes: `type PhotoProblem` (Task 1).
- Produces: `ACCEPT`, `MAX_REFERENCES = 5`, `MAX_SOURCE_BYTES`, `TARGET_BYTES`, `MAX_PREPARED_BYTES`, `ENCODE_STEPS`, `PREPARED_TYPE = "image/jpeg"`, `PREPARED_NAME = "reference.jpg"`, `BACKGROUND = "#ffffff"`; `interface DecodedImage { width; height; close(): void }`; `interface EncodeRequest { width; height; quality; type; background }`; `interface ImageCodec<Image extends DecodedImage = DecodedImage> { decode(source: Blob): Promise<Image>; encode(image: Image, request: EncodeRequest): Promise<Blob> }`; `type SourceKind = "supported" | "heic" | "unsupported"`; `classifySource(file: { name: string; type: string }): SourceKind`; `fitWithin(width, height, edge): { width; height }`; `type PreparedReference = { ok: true; file: File; width; height } | { ok: false; problem: PhotoProblem }`; `prepareReference(source: File, codec): Promise<PreparedReference>`; `browserCodec: ImageCodec` (from `browser-codec.ts`).

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/images.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	ACCEPT,
	classifySource,
	type DecodedImage,
	type EncodeRequest,
	fitWithin,
	type ImageCodec,
	MAX_REFERENCES,
	prepareReference,
} from "../../src/intake/images.ts";

const MIB = 1024 * 1024;

interface FakeImage extends DecodedImage {
	closed: boolean;
}

interface FakeOptions {
	/** The decoded size, the right way up (EXIF orientation applied). */
	width?: number;
	height?: number;
	/** What each encode returns, in bytes, in order. */
	sizes?: number[];
	decode?: "fail" | "empty";
	encode?: "fail";
}

/** A codec that decodes to the size it is told and encodes blobs of chosen sizes. */
function fakeCodec(options: FakeOptions = {}) {
	const encoded: EncodeRequest[] = [];
	const images: FakeImage[] = [];
	let decoded = 0;
	const codec: ImageCodec<FakeImage> = {
		async decode() {
			decoded += 1;
			if (options.decode === "fail") throw new Error("can't decode");
			const empty = options.decode === "empty";
			const image: FakeImage = {
				width: empty ? 0 : (options.width ?? 4032),
				height: empty ? 0 : (options.height ?? 3024),
				closed: false,
				close: () => {
					image.closed = true;
				},
			};
			images.push(image);
			return image;
		},
		async encode(_image, request) {
			encoded.push(request);
			if (options.encode === "fail") throw new Error("no canvas");
			const size = options.sizes?.[encoded.length - 1] ?? 400_000;
			return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
		},
	};
	return { codec, encoded, images, decodedCount: () => decoded };
}

/** A picked file whose size is `size` without allocating it. */
function picked(name = "IMG_0042.JPG", type = "image/jpeg", size = 3_000_000) {
	const file = new File([new Uint8Array(8)], name, { type });
	Object.defineProperty(file, "size", { value: size });
	return file;
}

describe("the picker", () => {
	test("asks for JPEG, PNG or WebP, so iOS converts HEIC itself", () => {
		assert.equal(ACCEPT, "image/jpeg,image/png,image/webp");
		assert.equal(MAX_REFERENCES, 5);
	});
});

describe("classifySource", () => {
	test("by type", () => {
		for (const type of ["image/jpeg", "image/jpg", "image/png", "image/webp", "IMAGE/PNG"]) {
			assert.equal(classifySource({ name: "x", type }), "supported", type);
		}
		for (const type of ["image/heic", "image/heif", "image/heic-sequence"]) {
			assert.equal(classifySource({ name: "x", type }), "heic", type);
		}
		for (const type of ["image/gif", "image/avif", "image/svg+xml", "video/mp4", "application/pdf"]) {
			assert.equal(classifySource({ name: "x.jpg", type }), "unsupported", type);
		}
	});

	test("by extension when the phone gives no type", () => {
		assert.equal(classifySource({ name: "a.JPG", type: "" }), "supported");
		assert.equal(classifySource({ name: "a.webp", type: "application/octet-stream" }), "supported");
		assert.equal(classifySource({ name: "a.HEIC", type: "" }), "heic");
		assert.equal(classifySource({ name: "a.gif", type: "" }), "unsupported");
		assert.equal(classifySource({ name: "photo", type: "" }), "unsupported");
	});
});

describe("fitWithin", () => {
	test("shrinks the long edge to the limit and keeps the shape", () => {
		assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200 });
		assert.deepEqual(fitWithin(3024, 4032, 1600), { width: 1200, height: 1600 });
		assert.deepEqual(fitWithin(5000, 5000, 1280), { width: 1280, height: 1280 });
		assert.deepEqual(fitWithin(16000, 9, 1600), { width: 1600, height: 1 });
	});

	test("never enlarges", () => {
		assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
		assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600 });
	});
});

describe("prepareReference", () => {
	test("makes a 1600 px JPEG on white, named reference.jpg, from one decode", async () => {
		const { codec, encoded, images, decodedCount } = fakeCodec();
		const result = await prepareReference(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.name, "reference.jpg");
		assert.equal(result.file.type, "image/jpeg");
		assert.equal(result.file.size, 400_000);
		assert.deepEqual([result.width, result.height], [1600, 1200]);
		assert.deepEqual(encoded, [
			{ width: 1600, height: 1200, quality: 0.85, type: "image/jpeg", background: "#ffffff" },
		]);
		assert.equal(decodedCount(), 1);
		assert.equal(images[0].closed, true);
	});

	test("goes by the decoded size, so a portrait phone photo stays portrait", async () => {
		const { codec, encoded } = fakeCodec({ width: 3024, height: 4032 });
		const result = await prepareReference(picked(), codec);

		assert.ok(result.ok);
		assert.deepEqual([encoded[0].width, encoded[0].height], [1200, 1600]);
	});

	test("never enlarges a small photo", async () => {
		const { codec, encoded } = fakeCodec({ width: 800, height: 600 });
		await prepareReference(picked("a.png", "image/png"), codec);

		assert.deepEqual([encoded[0].width, encoded[0].height], [800, 600]);
	});

	test("lowers the quality, then the size, until a photo is at most 1 MiB", async () => {
		const { codec, encoded } = fakeCodec({ sizes: [2 * MIB, 1.5 * MIB, 0.9 * MIB] });
		const result = await prepareReference(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.size, 0.9 * MIB);
		assert.deepEqual(
			encoded.map(({ width, quality }) => [width, quality]),
			[
				[1600, 0.85],
				[1600, 0.72],
				[1280, 0.72],
			],
		);
		assert.deepEqual([result.width, result.height], [1280, 960]);
	});

	test("stops at the first step under 1 MiB", async () => {
		const { codec, encoded } = fakeCodec({ sizes: [1.2 * MIB, 0.8 * MIB] });
		await prepareReference(picked(), codec);

		assert.equal(encoded.length, 2);
	});

	test("keeps the last step when it is over 1 MiB but at most 3.5 MiB", async () => {
		const { codec } = fakeCodec({ sizes: [3 * MIB, 3 * MIB, 3.5 * MIB] });
		const result = await prepareReference(picked(), codec);

		assert.ok(result.ok);
		assert.equal(result.file.size, 3.5 * MIB);
	});

	test("refuses a photo that stays over 3.5 MiB, so five stay under the API's 20 MB", async () => {
		const { codec, images } = fakeCodec({ sizes: [5 * MIB, 4 * MIB, 3.6 * MIB] });

		assert.deepEqual(await prepareReference(picked(), codec), { ok: false, problem: "too-heavy" });
		assert.equal(images[0].closed, true);
	});

	test("refuses other types and huge files without decoding them", async () => {
		const { codec, decodedCount } = fakeCodec();

		assert.deepEqual(await prepareReference(picked("clip.mp4", "video/mp4"), codec), {
			ok: false,
			problem: "unsupported",
		});
		assert.deepEqual(await prepareReference(picked("big.jpg", "image/jpeg", 50 * MIB + 1), codec), {
			ok: false,
			problem: "too-big",
		});
		assert.equal(decodedCount(), 0);
	});

	test("takes a file of exactly 50 MiB", async () => {
		const { codec } = fakeCodec();
		const result = await prepareReference(picked("big.jpg", "image/jpeg", 50 * MIB), codec);

		assert.equal(result.ok, true);
	});

	test("converts a HEIC the browser can decode, and names one it can't", async () => {
		const heic = () => picked("IMG_0001.HEIC", "image/heic");

		const converted = await prepareReference(heic(), fakeCodec().codec);
		assert.ok(converted.ok);
		assert.equal(converted.file.type, "image/jpeg");

		assert.deepEqual(await prepareReference(heic(), fakeCodec({ decode: "fail" }).codec), {
			ok: false,
			problem: "heic",
		});
	});

	test("a JPEG that won't decode, or decodes to nothing, is unreadable", async () => {
		assert.deepEqual(await prepareReference(picked(), fakeCodec({ decode: "fail" }).codec), {
			ok: false,
			problem: "unreadable",
		});
		const empty = fakeCodec({ decode: "empty" });
		assert.deepEqual(await prepareReference(picked(), empty.codec), {
			ok: false,
			problem: "unreadable",
		});
		assert.equal(empty.images[0].closed, true);
	});

	test("a failed encode is unreadable, and the decoded image is still released", async () => {
		const { codec, images } = fakeCodec({ encode: "fail" });

		assert.deepEqual(await prepareReference(picked(), codec), { ok: false, problem: "unreadable" });
		assert.equal(images[0].closed, true);
	});

	test("never sends the original: the result is always a new file", async () => {
		const original = picked();
		const result = await prepareReference(original, fakeCodec().codec);

		assert.ok(result.ok);
		assert.notEqual(result.file, original);
		assert.notEqual(result.file.name, original.name);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/images.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/images.ts`.

- [ ] **Step 3: Write `images.ts`**

Create `apps/storefront/src/intake/images.ts`:

```ts
import type { PhotoProblem } from "./copy.ts";

/*
 * Reference photos, prepared in the browser before the upload (TAT-57, spec
 * ruling 5): each one decoded once, shrunk and re-encoded as a JPEG, so an
 * upload on a slow connection stays small and no EXIF or GPS data leaves the
 * phone. The decoder and the canvas sit behind ImageCodec: browser-codec.ts
 * in the page, a fake in test/intake/images.test.ts.
 */

/** The picker's types: with exactly these, iOS hands over a JPEG for a HEIC photo. */
export const ACCEPT = "image/jpeg,image/png,image/webp";
/** At most this many photos per inquiry (the API's limit, TAT-51). */
export const MAX_REFERENCES = 5;

const MIB = 1024 * 1024;
/** Picked files over this are refused before decoding (memory on low-end phones). */
export const MAX_SOURCE_BYTES = 50 * MIB;
/** A prepared photo at most this big is done. */
export const TARGET_BYTES = MIB;
/** A prepared photo over this is refused: five of them stay under the API's 20 MB. */
export const MAX_PREPARED_BYTES = 3.5 * MIB;
/** Tried in order until one gives at most TARGET_BYTES. */
export const ENCODE_STEPS = [
	{ edge: 1600, quality: 0.85 },
	{ edge: 1600, quality: 0.72 },
	{ edge: 1280, quality: 0.72 },
] as const;
export const PREPARED_TYPE = "image/jpeg";
/** The sent file's name, never the picked file's own. */
export const PREPARED_NAME = "reference.jpg";
/** JPEG has no transparency: transparent pixels become white, not black. */
export const BACKGROUND = "#ffffff";

export interface DecodedImage {
	readonly width: number;
	readonly height: number;
	/** Frees the decoded pixels. */
	close(): void;
}

export interface EncodeRequest {
	readonly width: number;
	readonly height: number;
	readonly quality: number;
	readonly type: typeof PREPARED_TYPE;
	readonly background: typeof BACKGROUND;
}

export interface ImageCodec<Image extends DecodedImage = DecodedImage> {
	/** Decodes the file the right way up (EXIF orientation applied). */
	decode(source: Blob): Promise<Image>;
	/** Draws the image at the requested size on the background and encodes it. */
	encode(image: Image, request: EncodeRequest): Promise<Blob>;
}

export type SourceKind = "supported" | "heic" | "unsupported";

export type PreparedReference =
	| {
			readonly ok: true;
			readonly file: File;
			readonly width: number;
			readonly height: number;
	  }
	| { readonly ok: false; readonly problem: PhotoProblem };

const SUPPORTED_TYPES = new Set([
	"image/jpeg",
	"image/jpg",
	"image/pjpeg",
	"image/png",
	"image/webp",
]);
const HEIC_TYPES = new Set([
	"image/heic",
	"image/heif",
	"image/heic-sequence",
	"image/heif-sequence",
]);
const SUPPORTED_EXTENSION = /\.(jpe?g|png|webp)$/i;
const HEIC_EXTENSION = /\.(heic|heif)$/i;

/** What a picked file is, by its type, or by its name when the phone gives no type. */
export function classifySource(file: {
	readonly name: string;
	readonly type: string;
}): SourceKind {
	const type = file.type.toLowerCase();
	if (SUPPORTED_TYPES.has(type)) return "supported";
	if (HEIC_TYPES.has(type)) return "heic";
	if (type === "" || type === "application/octet-stream") {
		if (SUPPORTED_EXTENSION.test(file.name)) return "supported";
		if (HEIC_EXTENSION.test(file.name)) return "heic";
	}
	return "unsupported";
}

/** The size with the long edge at most `edge`, the same shape, never enlarged. */
export function fitWithin(
	width: number,
	height: number,
	edge: number,
): { width: number; height: number } {
	const longest = Math.max(width, height);
	if (longest <= edge) return { width, height };
	const scale = edge / longest;
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** One picked file as the JPEG the form sends, or why it can't be. */
export async function prepareReference<Image extends DecodedImage>(
	source: File,
	codec: ImageCodec<Image>,
): Promise<PreparedReference> {
	const kind = classifySource(source);
	if (kind === "unsupported") return { ok: false, problem: "unsupported" };
	if (source.size > MAX_SOURCE_BYTES) return { ok: false, problem: "too-big" };

	let image: Image;
	try {
		image = await codec.decode(source);
	} catch {
		return { ok: false, problem: kind === "heic" ? "heic" : "unreadable" };
	}

	try {
		if (!(image.width > 0 && image.height > 0)) {
			return { ok: false, problem: "unreadable" };
		}
		let best: { blob: Blob; width: number; height: number } | null = null;
		for (const step of ENCODE_STEPS) {
			const size = fitWithin(image.width, image.height, step.edge);
			const blob = await codec.encode(image, {
				...size,
				quality: step.quality,
				type: PREPARED_TYPE,
				background: BACKGROUND,
			});
			best = { blob, ...size };
			if (blob.size <= TARGET_BYTES) break;
		}
		if (!best || best.blob.size > MAX_PREPARED_BYTES) {
			return { ok: false, problem: "too-heavy" };
		}
		return {
			ok: true,
			file: new File([best.blob], PREPARED_NAME, { type: PREPARED_TYPE }),
			width: best.width,
			height: best.height,
		};
	} catch {
		return { ok: false, problem: "unreadable" };
	} finally {
		image.close();
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/images.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the browser codec**

Create `apps/storefront/src/intake/browser-codec.ts`:

```ts
import type { DecodedImage, EncodeRequest, ImageCodec } from "./images.ts";

/*
 * The browser's side of the photo pipeline (TAT-57): its own decoder and a
 * canvas. Node tests can't run it (no DOM); the browser pass checks an
 * upright portrait photo, a transparent PNG on white and the memory of five
 * large photos on a low-end phone.
 */

interface BrowserImage extends DecodedImage {
	readonly drawable: CanvasImageSource;
}

/** createImageBitmap applies EXIF orientation; an <img> is the fallback for browsers whose bitmap can't. */
async function decode(source: Blob): Promise<BrowserImage> {
	try {
		const bitmap = await createImageBitmap(source, {
			imageOrientation: "from-image",
		});
		return {
			width: bitmap.width,
			height: bitmap.height,
			drawable: bitmap,
			close: () => bitmap.close(),
		};
	} catch {
		return decodeWithImage(source);
	}
}

async function decodeWithImage(source: Blob): Promise<BrowserImage> {
	const url = URL.createObjectURL(source);
	const image = new Image();
	image.decoding = "async";
	image.src = url;
	try {
		await image.decode();
	} catch (error) {
		URL.revokeObjectURL(url);
		throw error;
	}
	return {
		width: image.naturalWidth,
		height: image.naturalHeight,
		drawable: image,
		close: () => {
			URL.revokeObjectURL(url);
			image.removeAttribute("src");
		},
	};
}

async function encode(
	image: BrowserImage,
	request: EncodeRequest,
): Promise<Blob> {
	const canvas = document.createElement("canvas");
	canvas.width = request.width;
	canvas.height = request.height;
	try {
		const context = canvas.getContext("2d", { alpha: false });
		if (!context) throw new Error("This browser has no 2D canvas.");
		context.fillStyle = request.background;
		context.fillRect(0, 0, request.width, request.height);
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.drawImage(image.drawable, 0, 0, request.width, request.height);
		const blob = await new Promise<Blob | null>((done) =>
			canvas.toBlob(done, request.type, request.quality),
		);
		if (!blob || blob.type !== request.type) {
			throw new Error("The canvas didn't make a JPEG.");
		}
		return blob;
	} finally {
		// Free the canvas's memory at once (Safari keeps it otherwise).
		canvas.width = 0;
		canvas.height = 0;
	}
}

export const browserCodec: ImageCodec<BrowserImage> = { decode, encode };
```

- [ ] **Step 6: Typecheck**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS. If the installed DOM types reject `imageOrientation: "from-image"` (older lib names it `"none" | "flipY"` only), keep the option and add the narrowest cast the error asks for, `{ imageOrientation: "from-image" } as ImageBitmapOptions`, and say so in the report: the option is what keeps phone photos upright in Chrome.

- [ ] **Step 7: Commit**

```bash
git add apps/storefront/src/intake/images.ts apps/storefront/src/intake/browser-codec.ts apps/storefront/test/intake/images.test.ts
git commit -m "feat(storefront): shrink reference photos to JPEG in the browser before the upload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The photo tray's state

**Files:**
- Create: `apps/storefront/src/intake/references.ts`
- Test: `apps/storefront/test/intake/references.test.ts`

**Interfaces:**
- Consumes: `type PhotoProblem` (Task 1); `MAX_REFERENCES` (Task 3).
- Produces: `interface ReferenceItem { id; name; status: "queued" | "ready"; source: File | null; file: File | null; error: string | null }`; `type PhotoNotice = { kind: "too-many"; count: number } | { kind: PhotoProblem; name: string }`; `interface ReferencesState { items; workingId: string | null; notices; error: string | null }`; `EMPTY_REFERENCES`; `type ReferencesAction` (`picked`, `started`, `prepared`, `refused`, `removed`, `rejected`, `cleared`); `referencesReducer(state, action)`; selectors `nextToPrepare`, `isPreparing`, `readyItems` (items with their `file`), `totalBytes`, `canAdd`, `hasPhotoErrors`; `interface PreviewUrls { create(file: File): string; revoke(url: string): void }`; `syncPreviews(previous: ReadonlyMap<string, string>, state, urls): ReadonlyMap<string, string>`; `formatBytes(bytes): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/references.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	canAdd,
	EMPTY_REFERENCES,
	formatBytes,
	hasPhotoErrors,
	isPreparing,
	nextToPrepare,
	type ReferencesAction,
	type ReferencesState,
	readyItems,
	referencesReducer,
	syncPreviews,
	totalBytes,
} from "../../src/intake/references.ts";

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: "image/jpeg" });
const jpeg = (size: number) => new File([new Uint8Array(size)], "reference.jpg", { type: "image/jpeg" });

function run(...actions: ReferencesAction[]): ReferencesState {
	return actions.reduce(referencesReducer, EMPTY_REFERENCES);
}

const pick = (...names: string[]): ReferencesAction => ({
	type: "picked",
	files: names.map((name) => ({ id: `id-${name}`, file: file(name) })),
});

describe("picking photos", () => {
	test("queues them in order", () => {
		const state = run(pick("a.jpg", "b.jpg"));

		assert.deepEqual(
			state.items.map(({ id, name, status }) => [id, name, status]),
			[
				["id-a.jpg", "a.jpg", "queued"],
				["id-b.jpg", "b.jpg", "queued"],
			],
		);
		assert.deepEqual(state.notices, []);
	});

	test("takes at most 5, across picks, and says how many weren't added", () => {
		const state = run(pick("a", "b"), pick("c", "d", "e", "f", "g"));

		assert.deepEqual(state.items.map((item) => item.name), ["a", "b", "c", "d", "e"]);
		assert.deepEqual(state.notices, [{ kind: "too-many", count: 2 }]);
		assert.equal(canAdd(state), false);

		const full = referencesReducer(state, pick("h"));
		assert.equal(full.items.length, 5);
		assert.deepEqual(full.notices, [{ kind: "too-many", count: 1 }]);
	});

	test("a new pick replaces the old messages", () => {
		const state = run(pick("a", "b", "c", "d", "e", "f"), { type: "removed", id: "id-a" }, pick("g"));

		assert.deepEqual(state.notices, []);
		assert.equal(state.items.length, 5);
	});
});

describe("preparing photos one at a time", () => {
	test("offers the first queued photo, and nothing while one is in work", () => {
		const queued = run(pick("a", "b"));
		assert.equal(nextToPrepare(queued)?.id, "id-a");

		const working = referencesReducer(queued, { type: "started", id: "id-a" });
		assert.equal(working.workingId, "id-a");
		assert.equal(nextToPrepare(working), undefined);
		assert.equal(isPreparing(working), true);
	});

	test("a prepared photo is ready, drops its source, and frees the queue", () => {
		const prepared = jpeg(300);
		const state = run(pick("a", "b"), { type: "started", id: "id-a" }, { type: "prepared", id: "id-a", file: prepared });

		assert.equal(state.workingId, null);
		assert.equal(state.items[0].status, "ready");
		assert.equal(state.items[0].source, null);
		assert.equal(state.items[0].file, prepared);
		assert.equal(nextToPrepare(state)?.id, "id-b");
	});

	test("a refused photo leaves the tray with a message naming it", () => {
		const state = run(pick("IMG_1.HEIC", "b"), { type: "started", id: "id-IMG_1.HEIC" }, { type: "refused", id: "id-IMG_1.HEIC", problem: "heic" });

		assert.deepEqual(state.items.map((item) => item.name), ["b"]);
		assert.deepEqual(state.notices, [{ kind: "heic", name: "IMG_1.HEIC" }]);
		assert.equal(state.workingId, null);
	});

	test("a photo removed mid-work stays gone and the next one waits", () => {
		const removed = run(pick("a", "b"), { type: "started", id: "id-a" }, { type: "removed", id: "id-a" });

		assert.deepEqual(removed.items.map((item) => item.id), ["id-b"]);
		assert.equal(nextToPrepare(removed), undefined, "no second decode alongside the first");
		assert.equal(isPreparing(removed), true);

		const settled = referencesReducer(removed, { type: "prepared", id: "id-a", file: jpeg(5) });
		assert.deepEqual(settled.items.map((item) => item.id), ["id-b"], "it doesn't come back");
		assert.equal(settled.workingId, null);
		assert.equal(nextToPrepare(settled)?.id, "id-b");
	});

	test("starting is only for the first queued photo, once", () => {
		const state = run(pick("a", "b"), { type: "started", id: "id-a" });

		assert.equal(referencesReducer(state, { type: "started", id: "id-b" }), state);
		assert.equal(referencesReducer(run(pick("a")), { type: "started", id: "nope" }).workingId, null);
	});
});

describe("what is sent", () => {
	const ready = run(
		pick("a", "b", "c"),
		{ type: "started", id: "id-a" },
		{ type: "prepared", id: "id-a", file: jpeg(1_000) },
		{ type: "started", id: "id-b" },
		{ type: "prepared", id: "id-b", file: jpeg(2_000) },
	);

	test("only ready photos, in the tray's order, with their sizes", () => {
		assert.deepEqual(readyItems(ready).map((item) => item.id), ["id-a", "id-b"]);
		assert.equal(totalBytes(ready), 3_000);
		assert.equal(isPreparing(ready), true, "c is still queued");
		assert.equal(canAdd(ready), true);
	});

	test("puts the API's photo errors on the photos that were sent, by their index then", () => {
		const sentIds = readyItems(ready).map((item) => item.id);
		const changed = run(
			pick("a", "b", "c"),
			{ type: "started", id: "id-a" },
			{ type: "prepared", id: "id-a", file: jpeg(1_000) },
			{ type: "started", id: "id-b" },
			{ type: "prepared", id: "id-b", file: jpeg(2_000) },
			{ type: "removed", id: "id-a" },
			pick("z"),
		);
		const rejected = referencesReducer(changed, {
			type: "rejected",
			sentIds,
			byIndex: { 0: "first", 1: "second" },
			error: null,
		});

		assert.deepEqual(
			rejected.items.map(({ id, error }) => [id, error]),
			[
				["id-b", "second"],
				["id-c", null],
				["id-z", null],
			],
		);
		assert.equal(hasPhotoErrors(rejected), true);
	});

	test("an error about the photos as a whole sits on the tray until the next change", () => {
		const rejected = referencesReducer(ready, { type: "rejected", sentIds: [], byIndex: {}, error: "Attach up to 5 images." });
		assert.equal(rejected.error, "Attach up to 5 images.");
		assert.equal(hasPhotoErrors(rejected), true);
		assert.equal(referencesReducer(rejected, { type: "removed", id: "id-c" }).error, null);
	});

	test("cleared after a sent inquiry", () => {
		assert.deepEqual(referencesReducer(ready, { type: "cleared" }), EMPTY_REFERENCES);
	});
});

describe("preview URLs", () => {
	function fakeUrls() {
		const created: string[] = [];
		const revoked: string[] = [];
		return {
			created,
			revoked,
			urls: {
				create: (photo: File) => {
					const url = `blob:${created.length}-${photo.size}`;
					created.push(url);
					return url;
				},
				revoke: (url: string) => {
					revoked.push(url);
				},
			},
		};
	}

	test("makes one URL per ready photo and keeps it while the photo stays", () => {
		const { created, urls } = fakeUrls();
		const state = run(pick("a", "b"), { type: "started", id: "id-a" }, { type: "prepared", id: "id-a", file: jpeg(7) });
		const first = syncPreviews(new Map(), state, urls);
		const again = syncPreviews(first, state, urls);

		assert.deepEqual([...again], [["id-a", "blob:0-7"]]);
		assert.deepEqual(created, ["blob:0-7"]);
	});

	test("makes no URL for a photo that isn't ready, and revokes the ones that went", () => {
		const { created, revoked, urls } = fakeUrls();
		const state = run(pick("a", "b"), { type: "started", id: "id-a" }, { type: "prepared", id: "id-a", file: jpeg(7) });
		const shown = syncPreviews(new Map(), state, urls);
		const removed = referencesReducer(state, { type: "removed", id: "id-a" });

		assert.deepEqual([...syncPreviews(shown, removed, urls)], []);
		assert.deepEqual(revoked, ["blob:0-7"]);
		assert.equal(created.length, 1, "nothing for the queued photo");

		const { revoked: cleared, urls: other } = fakeUrls();
		syncPreviews(new Map([["id-x", "blob:x"]]), EMPTY_REFERENCES, other);
		assert.deepEqual(cleared, ["blob:x"]);
	});
});

describe("formatBytes", () => {
	test("in MB with one decimal, never 0.0", () => {
		assert.equal(formatBytes(0), "0.1 MB");
		assert.equal(formatBytes(1024 * 1024), "1.0 MB");
		assert.equal(formatBytes(2_202_009), "2.1 MB");
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/references.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/references.ts`.

- [ ] **Step 3: Write `references.ts`**

Create `apps/storefront/src/intake/references.ts`:

```ts
import type { PhotoProblem } from "./copy.ts";
import { MAX_REFERENCES } from "./images.ts";

/*
 * The photo tray (TAT-57, spec ruling 5): what was picked, which photo is
 * being prepared (one at a time, even after it was removed, so two decodes
 * never run together on a low-end phone), what is ready to send, and why a
 * photo wasn't added. Pure: the form runs prepareReference and makes the
 * preview URLs (syncPreviews) around it.
 */

export interface ReferenceItem {
	readonly id: string;
	/** The picked file's name, for messages only (never sent). */
	readonly name: string;
	readonly status: "queued" | "ready";
	/** The picked file, until it is prepared. */
	readonly source: File | null;
	/** The re-encoded JPEG that is sent. */
	readonly file: File | null;
	/** What the API said about this photo when it was sent. */
	readonly error: string | null;
}

export type PhotoNotice =
	| { readonly kind: "too-many"; readonly count: number }
	| { readonly kind: PhotoProblem; readonly name: string };

export interface ReferencesState {
	readonly items: readonly ReferenceItem[];
	/** The photo being prepared, kept even if it was removed meanwhile. */
	readonly workingId: string | null;
	readonly notices: readonly PhotoNotice[];
	/** What the API said about the photos as a whole (`referenceImages`). */
	readonly error: string | null;
}

export const EMPTY_REFERENCES: ReferencesState = {
	items: [],
	workingId: null,
	notices: [],
	error: null,
};

export type ReferencesAction =
	| {
			readonly type: "picked";
			readonly files: readonly { readonly id: string; readonly file: File }[];
	  }
	| { readonly type: "started"; readonly id: string }
	| { readonly type: "prepared"; readonly id: string; readonly file: File }
	| {
			readonly type: "refused";
			readonly id: string;
			readonly problem: PhotoProblem;
	  }
	| { readonly type: "removed"; readonly id: string }
	| {
			readonly type: "rejected";
			/** The ids of the photos sent, in the order they were sent. */
			readonly sentIds: readonly string[];
			/** The API's message per sent index (`referenceImages.<i>`). */
			readonly byIndex: Readonly<Record<number, string>>;
			readonly error: string | null;
	  }
	| { readonly type: "cleared" };

export function referencesReducer(
	state: ReferencesState,
	action: ReferencesAction,
): ReferencesState {
	switch (action.type) {
		case "picked": {
			const room = Math.max(0, MAX_REFERENCES - state.items.length);
			const taken = action.files.slice(0, room);
			const left = action.files.length - taken.length;
			return {
				...state,
				items: [
					...state.items,
					...taken.map(
						({ id, file }): ReferenceItem => ({
							id,
							name: file.name,
							status: "queued",
							source: file,
							file: null,
							error: null,
						}),
					),
				],
				notices: left > 0 ? [{ kind: "too-many", count: left }] : [],
				error: null,
			};
		}
		case "started":
			return state.workingId === null &&
				nextToPrepare(state)?.id === action.id
				? { ...state, workingId: action.id }
				: state;
		case "prepared":
			return {
				...state,
				workingId: settled(state, action.id),
				items: state.items.map(
					(item): ReferenceItem =>
						item.id === action.id
							? { ...item, status: "ready", source: null, file: action.file }
							: item,
				),
			};
		case "refused": {
			const refused = state.items.find((item) => item.id === action.id);
			return {
				...state,
				workingId: settled(state, action.id),
				items: state.items.filter((item) => item.id !== action.id),
				notices: refused
					? [...state.notices, { kind: action.problem, name: refused.name }]
					: state.notices,
			};
		}
		case "removed":
			return {
				...state,
				items: state.items.filter((item) => item.id !== action.id),
				error: null,
			};
		case "rejected":
			return {
				...state,
				error: action.error,
				items: state.items.map((item): ReferenceItem => {
					const index = action.sentIds.indexOf(item.id);
					const message = index === -1 ? undefined : action.byIndex[index];
					return message ? { ...item, error: message } : item;
				}),
			};
		case "cleared":
			return EMPTY_REFERENCES;
	}
}

function settled(state: ReferencesState, id: string): string | null {
	return state.workingId === id ? null : state.workingId;
}

/** The next photo to prepare: the first queued one, and none while one is in work. */
export function nextToPrepare(state: ReferencesState): ReferenceItem | undefined {
	return state.workingId === null
		? state.items.find((item) => item.status === "queued")
		: undefined;
}

/** Whether a send must wait for photos. */
export function isPreparing(state: ReferencesState): boolean {
	return (
		state.workingId !== null ||
		state.items.some((item) => item.status === "queued")
	);
}

type ReadyItem = ReferenceItem & { readonly file: File };

/** The photos that go with a send, in the tray's order. */
export function readyItems(state: ReferencesState): readonly ReadyItem[] {
	return state.items.filter(
		(item): item is ReadyItem => item.status === "ready" && item.file !== null,
	);
}

export function totalBytes(state: ReferencesState): number {
	return readyItems(state).reduce((sum, item) => sum + item.file.size, 0);
}

export function canAdd(state: ReferencesState): boolean {
	return state.items.length < MAX_REFERENCES;
}

export function hasPhotoErrors(state: ReferencesState): boolean {
	return state.error !== null || state.items.some((item) => item.error !== null);
}

export interface PreviewUrls {
	create(file: File): string;
	revoke(url: string): void;
}

/**
 * The preview URL of each ready photo: keeps the ones it has, makes the
 * missing ones, and revokes every URL whose photo is gone.
 */
export function syncPreviews(
	previous: ReadonlyMap<string, string>,
	state: ReferencesState,
	urls: PreviewUrls,
): ReadonlyMap<string, string> {
	const next = new Map<string, string>();
	for (const item of readyItems(state)) {
		next.set(item.id, previous.get(item.id) ?? urls.create(item.file));
	}
	for (const [id, url] of previous) {
		if (next.get(id) !== url) urls.revoke(url);
	}
	return next;
}

/** "2.1 MB": megabytes (MiB, as the API counts them) with one decimal, at least 0.1. */
export function formatBytes(bytes: number): string {
	return `${Math.max(0.1, bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/references.test.ts`
Expected: PASS.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/intake/references.ts apps/storefront/test/intake/references.test.ts
git commit -m "feat(storefront): keep the photo tray: five at most, one prepared at a time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The SDK input, checked on the wire

**Files:**
- Create: `apps/storefront/src/intake/submission.ts`
- Test: `apps/storefront/test/intake/submission.test.ts`

**Interfaces:**
- Consumes: `type IntakeValues`, `asciiDigits` (Task 2); `type CreateInquiryInput`, `type SourceChannel`, `createTattooClient` from `@tattoo-drip/sdk`; `fakeFetch`, `json` from `test/tenancy/helpers.ts`.
- Produces: `toInquiryInput(values: IntakeValues, referenceImages: readonly File[], honeypot: string): CreateInquiryInput` (no `challengeToken`: Task 8 adds it per attempt).

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/submission.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createTattooClient } from "@tattoo-drip/sdk";
import type { IntakeValues } from "../../src/intake/rules.ts";
import { toInquiryInput } from "../../src/intake/submission.ts";
import { fakeFetch, json } from "../tenancy/helpers.ts";

const API = "http://api.test";
const SITA_ID = "0199f000-0000-7000-8000-000000000048";
const FULL: IntakeValues = {
	idea: "  A fine-line peony with two leaves\n",
	placement: " Left forearm ",
	approximateSize: "About 10 cm",
	preferredDates: "Any weekday in November",
	preferredArtistId: SITA_ID,
	budget: " NPR 15000 ",
	sourceChannel: "instagram",
	contactName: " Asha Gurung ",
	contactPhone: " 98-1234-5678 ",
	contactEmail: " asha@example.com ",
};
const SHORT: IntakeValues = { ...FULL, preferredArtistId: "", budget: " ", contactEmail: "" };
const photo = (size: number) => new File([new Uint8Array(size)], "reference.jpg", { type: "image/jpeg" });

describe("toInquiryInput", () => {
	test("names every answer as the contract does, trimmed, the photos in order", () => {
		const images = [photo(3), photo(5)];

		assert.deepEqual(toInquiryInput(FULL, images, ""), {
			idea: "A fine-line peony with two leaves",
			placement: "Left forearm",
			approximateSize: "About 10 cm",
			preferredDates: "Any weekday in November",
			preferredArtistId: SITA_ID,
			budget: "NPR 15000",
			sourceChannel: "instagram",
			contactName: "Asha Gurung",
			contactPhone: "98-1234-5678",
			contactEmail: "asha@example.com",
			referenceImages: images,
			honeypot: "",
		});
	});

	test("leaves the empty optional answers out", () => {
		const input = toInquiryInput(SHORT, [], "");

		assert.equal(input.preferredArtistId, undefined);
		assert.equal(input.budget, undefined);
		assert.equal(input.contactEmail, undefined);
		assert.deepEqual(input.referenceImages, []);
	});

	test("sends Devanagari digits as ASCII ones", () => {
		assert.equal(toInquiryInput({ ...FULL, contactPhone: "९८१२३४५६७८" }, [], "").contactPhone, "9812345678");
	});

	test("passes the honeypot's value through as it is", () => {
		assert.equal(toInquiryInput(FULL, [], "https://spam.example").honeypot, "https://spam.example");
	});

	test("refuses to build an inquiry without a source channel", () => {
		assert.throws(() => toInquiryInput({ ...FULL, sourceChannel: "" }, [], ""), /validateIntake/);
	});
});

describe("on the wire (the SDK's real inquiries.create)", () => {
	async function sent(values: IntakeValues, images: File[], honeypot: string, challengeToken?: string) {
		const { calls, fetch } = fakeFetch(() => json(201, { data: { id: "0199f000-0000-7000-8000-000000000057" } }));
		const client = createTattooClient({ baseUrl: API, tenant: "black-needle-48", fetch });
		await client.inquiries.create({ ...toInquiryInput(values, images, honeypot), challengeToken });
		const [call] = calls;
		return { call, form: call.init.body as FormData, headers: new Headers(call.init.headers) };
	}

	test("one multipart POST with exactly the contract's fields and the token in a header", async () => {
		const { call, form, headers } = await sent(FULL, [photo(3), photo(5)], "", "token-57");

		assert.equal(call.url, `${API}/api/v1/tenants/black-needle-48/inquiries`);
		assert.equal(call.init.method, "POST");
		assert.equal(call.init.credentials, "omit");
		assert.equal(headers.get("x-challenge-token"), "token-57");
		assert.deepEqual(
			[...form.keys()],
			[
				"idea",
				"placement",
				"approximateSize",
				"preferredDates",
				"preferredArtistId",
				"budget",
				"sourceChannel",
				"contactName",
				"contactPhone",
				"contactEmail",
				"referenceImages",
				"referenceImages",
			],
		);
		const images = form.getAll("referenceImages") as File[];
		assert.deepEqual(images.map((image) => [image.name, image.size, image.type]), [
			["reference.jpg", 3, "image/jpeg"],
			["reference.jpg", 5, "image/jpeg"],
		]);
		assert.equal(form.get("contactPhone"), "98-1234-5678");
	});

	test("no optional field when empty, no website when the honeypot is empty, no token field ever", async () => {
		const { form, headers } = await sent(SHORT, [], "");

		for (const name of ["preferredArtistId", "budget", "contactEmail", "referenceImages", "website", "challengeToken", "honeypot"]) {
			assert.equal(form.has(name), false, name);
		}
		assert.equal(headers.get("x-challenge-token"), null, "no token in development");
	});

	test("a filled honeypot goes as website, for the API to refuse", async () => {
		const { form } = await sent(SHORT, [], "https://spam.example");

		assert.equal(form.get("website"), "https://spam.example");
		assert.equal(form.has("honeypot"), false);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/submission.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/submission.ts`.

- [ ] **Step 3: Write `submission.ts`**

Create `apps/storefront/src/intake/submission.ts`:

```ts
import type { CreateInquiryInput } from "@tattoo-drip/sdk";
import { asciiDigits, type IntakeValues } from "./rules.ts";

/**
 * The SDK input for one attempt (TAT-57): the contract's field names, values
 * trimmed, empty optional answers left out, the phone with ASCII digits but
 * otherwise as typed (the API stores E.164), the photos in the tray's order
 * and the honeypot input's own value. createSubmitter adds the challenge
 * token per attempt. Call it only after validateIntake passed.
 */
export function toInquiryInput(
	values: IntakeValues,
	referenceImages: readonly File[],
	honeypot: string,
): CreateInquiryInput {
	if (values.sourceChannel === "") {
		throw new Error("toInquiryInput() needs answers validateIntake passed.");
	}
	const optional = (value: string) => value.trim() || undefined;
	return {
		idea: values.idea.trim(),
		placement: values.placement.trim(),
		approximateSize: values.approximateSize.trim(),
		preferredDates: values.preferredDates.trim(),
		preferredArtistId: optional(values.preferredArtistId),
		budget: optional(values.budget),
		sourceChannel: values.sourceChannel,
		contactName: values.contactName.trim(),
		contactPhone: asciiDigits(values.contactPhone).trim(),
		contactEmail: optional(values.contactEmail),
		referenceImages: [...referenceImages],
		honeypot,
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/submission.test.ts`
Expected: PASS. If the key list differs only because TAT-55's SDK appends the `website` part or the images in another place than `[...fields, ...images]`, the SDK is the contract: keep the SDK, and change only this test's expected order, saying so in the report. A missing `x-challenge-token` header or a `challengeToken` field means the base lacks TAT-55's SDK: stop (Task 0).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/intake/submission.ts apps/storefront/test/intake/submission.test.ts
git commit -m "feat(storefront): build the inquiry the SDK sends, checked against its real request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Turnstile, loaded late and run per attempt

**Files:**
- Create: `apps/storefront/src/intake/challenge.ts`
- Create: `apps/storefront/src/intake/challenge-host.ts` (DOM; no node test: the browser pass covers it)
- Test: `apps/storefront/test/intake/challenge.test.ts`

**Interfaces:**
- Consumes: `INQUIRY_CHALLENGE_ACTION` from `@tattoo-drip/sdk`.
- Produces: `TURNSTILE_ORIGIN`, `TURNSTILE_READY_CALLBACK = "tattooDripTurnstileReady"`, `TURNSTILE_SCRIPT_URL`, `TURNSTILE_PRIVACY_URL = "https://www.cloudflare.com/turnstile-privacy-policy/"`, `SCRIPT_TIMEOUT_MS = 20_000`, `TOKEN_TIMEOUT_MS = 30_000`; `interface TurnstileRenderOptions`; `interface TurnstileApi { render(container, options): string | null | undefined; execute(widget: string): void; reset(widget: string): void; remove(widget: string): void }`; `interface ChallengeHost { loadScript(url, ready, failed): void; turnstile(): TurnstileApi | undefined; setTimer(run, ms): () => void }`; `type ChallengeFailure = "blocked" | "expired" | "unsupported"`; `type ChallengeResult = { ok: true; token: string } | { ok: false; reason: ChallengeFailure }`; `class Challenge` (`constructor(siteKey, host, onInteractive?)`, `preload(): void`, `load(): Promise<boolean>`, `attach(container: HTMLElement | null): void`, `token(): Promise<ChallengeResult>`, `reset(): void`, `dispose(): void`); `browserChallengeHost(): ChallengeHost` (from `challenge-host.ts`).

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/challenge.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	Challenge,
	type ChallengeHost,
	SCRIPT_TIMEOUT_MS,
	TOKEN_TIMEOUT_MS,
	TURNSTILE_SCRIPT_URL,
	type TurnstileApi,
	type TurnstileRenderOptions,
} from "../../src/intake/challenge.ts";

const SITE_KEY = "1x00000000000000000000AA";
/** Stands in for the form's box; Challenge only passes it to Turnstile. */
const BOX = {} as HTMLElement;
const tick = () => new Promise((done) => setImmediate(done));

/** A page with a fake script loader, a fake `turnstile` and timers fired by hand. */
function fakePage() {
	const scripts: { url: string; ready: () => void; failed: () => void }[] = [];
	const widgets: { container: HTMLElement; options: TurnstileRenderOptions }[] = [];
	const calls: string[] = [];
	const timers: { run: () => void; ms: number; live: boolean }[] = [];
	const interactive: boolean[] = [];
	let loaded = false;
	const api: TurnstileApi = {
		render(container, options) {
			widgets.push({ container, options });
			calls.push("render");
			return `widget-${widgets.length}`;
		},
		execute: (widget) => calls.push(`execute ${widget}`),
		reset: (widget) => calls.push(`reset ${widget}`),
		remove: (widget) => calls.push(`remove ${widget}`),
	};
	const host: ChallengeHost = {
		loadScript(url, ready, failed) {
			scripts.push({
				url,
				ready: () => {
					loaded = true;
					ready();
				},
				failed,
			});
		},
		turnstile: () => (loaded ? api : undefined),
		setTimer(run, ms) {
			const timer = { run, ms, live: true };
			timers.push(timer);
			return () => {
				timer.live = false;
			};
		},
	};
	/** Fires every live timer of `ms`. */
	const fire = (ms: number) => {
		for (const timer of timers) {
			if (timer.live && timer.ms === ms) {
				timer.live = false;
				timer.run();
			}
		}
	};
	const challenge = new Challenge(SITE_KEY, host, (value) => interactive.push(value));
	const options = () => {
		const widget = widgets.at(-1);
		assert.ok(widget, "a widget was rendered");
		return widget.options;
	};
	return { challenge, scripts, widgets, calls, fire, interactive, options };
}

/** Attached, script loaded, widget rendered. */
async function ready() {
	const page = fakePage();
	page.challenge.attach(BOX);
	const loading = page.challenge.load();
	page.scripts[0].ready();
	assert.equal(await loading, true);
	return page;
}

describe("loading", () => {
	test("loads nothing until the form asks", () => {
		const { challenge, scripts } = fakePage();
		challenge.attach(BOX);

		assert.equal(scripts.length, 0);
	});

	test("loads Cloudflare's script once, however often asked", () => {
		const { challenge, scripts } = fakePage();
		challenge.preload();
		challenge.preload();
		void challenge.load();

		assert.equal(scripts.length, 1);
		assert.equal(
			TURNSTILE_SCRIPT_URL,
			"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=tattooDripTurnstileReady",
		);
		assert.equal(scripts[0].url, TURNSTILE_SCRIPT_URL);
	});

	test("renders once ready, in the form's box, with the options the spec asks for", async () => {
		const { widgets, options } = await ready();

		assert.equal(widgets.length, 1);
		assert.equal(widgets[0].container, BOX);
		const { callback, ...rest } = options();
		assert.equal(typeof callback, "function");
		assert.deepEqual(
			Object.fromEntries(Object.entries(rest).filter(([, value]) => typeof value !== "function")),
			{
				sitekey: SITE_KEY,
				action: "inquiry",
				execution: "execute",
				appearance: "interaction-only",
				size: "flexible",
				theme: "auto",
				retry: "never",
				"refresh-expired": "manual",
				"response-field": false,
				"feedback-enabled": false,
			},
		);
	});

	test("a script that fails is blocked, and the next send loads it again", async () => {
		const { challenge, scripts } = fakePage();
		challenge.attach(BOX);
		const first = challenge.token();
		scripts[0].failed();

		assert.deepEqual(await first, { ok: false, reason: "blocked" });
		void challenge.token();
		assert.equal(scripts.length, 2);
	});

	test("a script that hasn't come in 20 s is blocked, but may still arrive", async () => {
		const { challenge, scripts, fire, calls } = fakePage();
		challenge.attach(BOX);
		const first = challenge.token();
		fire(SCRIPT_TIMEOUT_MS);

		assert.deepEqual(await first, { ok: false, reason: "blocked" });
		scripts[0].ready();
		void challenge.token();
		await tick();
		assert.equal(scripts.length, 1, "no second script");
		assert.deepEqual(calls, ["render", "execute widget-1"]);
	});

	test("without the form's box there is nothing to run", async () => {
		const { challenge, scripts } = fakePage();
		const result = challenge.token();
		await tick();
		scripts[0].ready();

		assert.deepEqual(await result, { ok: false, reason: "blocked" });
	});
});

describe("a token per attempt", () => {
	test("runs the widget and answers with its token", async () => {
		const { challenge, calls, options } = await ready();
		const result = challenge.token();
		await tick();

		assert.deepEqual(calls, ["render", "execute widget-1"]);
		options().callback("XXXX.DUMMY.TOKEN.XXXX");
		assert.deepEqual(await result, { ok: true, token: "XXXX.DUMMY.TOKEN.XXXX" });
	});

	test("names each way it fails", async () => {
		for (const [fail, reason] of [
			["error-callback", "blocked"],
			["timeout-callback", "expired"],
			["unsupported-callback", "unsupported"],
		] as const) {
			const { challenge, options } = await ready();
			const result = challenge.token();
			await tick();
			const callbacks = options();
			if (fail === "error-callback") {
				assert.equal(callbacks[fail]("300030"), true, "handled: no console noise");
			} else {
				callbacks[fail]();
			}

			assert.deepEqual(await result, { ok: false, reason }, fail);
		}
	});

	test("no answer in 30 s is blocked; a showing checkbox waits for the person", async () => {
		const silent = await ready();
		const unanswered = silent.challenge.token();
		await tick();
		silent.fire(TOKEN_TIMEOUT_MS);
		assert.deepEqual(await unanswered, { ok: false, reason: "blocked" });

		const page = await ready();
		const result = page.challenge.token();
		await tick();
		page.options()["before-interactive-callback"]();
		page.fire(TOKEN_TIMEOUT_MS);
		page.options()["after-interactive-callback"]();
		page.options().callback("ticked");

		assert.deepEqual(await result, { ok: true, token: "ticked" });
		assert.deepEqual(page.interactive, [true, false, false]);
	});

	test("two sends at once share one attempt", async () => {
		const { challenge, calls, options } = await ready();
		const first = challenge.token();
		const second = challenge.token();
		await tick();
		options().callback("once");

		assert.deepEqual(await first, { ok: true, token: "once" });
		assert.deepEqual(await second, { ok: true, token: "once" });
		assert.equal(calls.filter((call) => call.startsWith("execute")).length, 1);
	});

	test("reset after an attempt clears the widget; the next attempt runs it again", async () => {
		const { challenge, calls, options } = await ready();
		const first = challenge.token();
		await tick();
		options().callback("first");
		await first;
		challenge.reset();
		const second = challenge.token();
		await tick();
		options().callback("second");

		assert.deepEqual(await second, { ok: true, token: "second" });
		assert.deepEqual(calls, ["render", "execute widget-1", "reset widget-1", "execute widget-1"]);
	});

	test("a callback with no attempt waiting is ignored", async () => {
		const { challenge, options } = await ready();
		options().callback("stray");
		const result = challenge.token();
		await tick();
		options().callback("fresh");

		assert.deepEqual(await result, { ok: true, token: "fresh" });
	});

	test("dispose removes the widget and ends a waiting attempt", async () => {
		const { challenge, calls } = await ready();
		const result = challenge.token();
		await tick();
		challenge.dispose();

		assert.deepEqual(await result, { ok: false, reason: "blocked" });
		assert.equal(calls.at(-1), "remove widget-1");
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/challenge.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/challenge.ts`.

- [ ] **Step 3: Write `challenge.ts`**

Create `apps/storefront/src/intake/challenge.ts`:

```ts
import { INQUIRY_CHALLENGE_ACTION } from "@tattoo-drip/sdk";

/*
 * Cloudflare Turnstile for the intake form (TAT-55/57, spec ruling 6): the
 * one third-party script the studio page loads, only once someone starts
 * filling in the form. Rendered in execute mode, run at Send, reset after
 * every attempt (a token is single-use). The page's side (the script tag,
 * the global `turnstile`, timers) sits behind ChallengeHost:
 * challenge-host.ts in the browser, a fake in the tests.
 */

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
/** The global function Turnstile calls once it is ready (its `onload` parameter). */
export const TURNSTILE_READY_CALLBACK = "tattooDripTurnstileReady";
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit&onload=${TURNSTILE_READY_CALLBACK}`;
/** Cloudflare's Turnstile Privacy Addendum, linked from the form's privacy line. */
export const TURNSTILE_PRIVACY_URL =
	"https://www.cloudflare.com/turnstile-privacy-policy/";
/** How long a send waits for the script (about 50 KB on a slow phone). */
export const SCRIPT_TIMEOUT_MS = 20_000;
/** How long a send waits for a token while no checkbox is showing. */
export const TOKEN_TIMEOUT_MS = 30_000;

export interface TurnstileRenderOptions {
	sitekey: string;
	action: string;
	execution: "execute";
	appearance: "interaction-only";
	size: "flexible";
	theme: "auto";
	retry: "never";
	"refresh-expired": "manual";
	"response-field": false;
	"feedback-enabled": false;
	callback: (token: string) => void;
	"error-callback": (code: string) => boolean;
	"expired-callback": () => void;
	"timeout-callback": () => void;
	"unsupported-callback": () => void;
	"before-interactive-callback": () => void;
	"after-interactive-callback": () => void;
}

/** The part of Cloudflare's `turnstile` global the form uses. */
export interface TurnstileApi {
	render(
		container: HTMLElement,
		options: TurnstileRenderOptions,
	): string | null | undefined;
	execute(widget: string): void;
	reset(widget: string): void;
	remove(widget: string): void;
}

export interface ChallengeHost {
	/** Adds the script; `ready` once Turnstile is ready, `failed` if the script can't load (it is then removed). */
	loadScript(url: string, ready: () => void, failed: () => void): void;
	/** Cloudflare's global, once the script ran. */
	turnstile(): TurnstileApi | undefined;
	/** Runs `run` after `ms`; returns a function that cancels it. */
	setTimer(run: () => void, ms: number): () => void;
}

export type ChallengeFailure = "blocked" | "expired" | "unsupported";

export type ChallengeResult =
	| { readonly ok: true; readonly token: string }
	| { readonly ok: false; readonly reason: ChallengeFailure };

interface Attempt {
	readonly promise: Promise<ChallengeResult>;
	readonly resolve: (result: ChallengeResult) => void;
	cancelTimer: (() => void) | null;
}

export class Challenge {
	readonly #siteKey: string;
	readonly #host: ChallengeHost;
	readonly #onInteractive: (interactive: boolean) => void;
	#script: "none" | "loading" | "ready" = "none";
	#waiters: Array<(ready: boolean) => void> = [];
	#container: HTMLElement | null = null;
	#widget: string | null = null;
	#attempt: Attempt | null = null;

	/** `onInteractive` hears when Cloudflare shows its checkbox, and when that ends. */
	constructor(
		siteKey: string,
		host: ChallengeHost,
		onInteractive: (interactive: boolean) => void = () => {},
	) {
		this.#siteKey = siteKey;
		this.#host = host;
		this.#onInteractive = onInteractive;
	}

	/** Starts loading the script, once (the form's first focus or tap). */
	preload(): void {
		if (this.#script !== "none") return;
		this.#script = "loading";
		this.#host.loadScript(
			TURNSTILE_SCRIPT_URL,
			() => this.#loaded(true),
			() => this.#loaded(false),
		);
	}

	/** Whether Turnstile is ready: false after SCRIPT_TIMEOUT_MS or a failed load (a later call tries again). */
	load(): Promise<boolean> {
		if (this.#script === "ready") return Promise.resolve(true);
		this.preload();
		return new Promise((resolve) => {
			let done = false;
			const finish = (ready: boolean) => {
				if (done) return;
				done = true;
				cancel();
				resolve(ready);
			};
			const cancel = this.#host.setTimer(
				() => finish(false),
				SCRIPT_TIMEOUT_MS,
			);
			this.#waiters.push(finish);
		});
	}

	/** Where the widget goes: it stays empty unless Cloudflare needs a tap. */
	attach(container: HTMLElement | null): void {
		this.#container = container;
		this.#render();
	}

	/** A fresh token for one attempt; two calls at once share it. */
	async token(): Promise<ChallengeResult> {
		if (this.#attempt) return this.#attempt.promise;
		if (!(await this.load())) return { ok: false, reason: "blocked" };
		if (this.#attempt) return this.#attempt.promise;
		const widget = this.#render();
		const api = this.#host.turnstile();
		if (widget === null || !api) return { ok: false, reason: "blocked" };
		let resolve: (result: ChallengeResult) => void = () => {};
		const promise = new Promise<ChallengeResult>((done) => {
			resolve = done;
		});
		this.#attempt = { promise, resolve, cancelTimer: null };
		this.#armTimer();
		api.execute(widget);
		return promise;
	}

	/** After every attempt, whatever the answer: a token is single-use. */
	reset(): void {
		this.#settle({ ok: false, reason: "blocked" });
		const api = this.#host.turnstile();
		if (this.#widget !== null && api) api.reset(this.#widget);
	}

	/** When the form goes away. */
	dispose(): void {
		this.#settle({ ok: false, reason: "blocked" });
		const api = this.#host.turnstile();
		if (this.#widget !== null && api) api.remove(this.#widget);
		this.#widget = null;
		this.#container = null;
	}

	#loaded(ready: boolean): void {
		this.#script = ready ? "ready" : "none";
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const waiter of waiters) waiter(ready);
		if (ready) this.#render();
	}

	#render(): string | null {
		if (this.#widget !== null) return this.#widget;
		const api = this.#script === "ready" ? this.#host.turnstile() : undefined;
		if (!api || !this.#container) return null;
		this.#widget = api.render(this.#container, this.#options()) ?? null;
		return this.#widget;
	}

	#options(): TurnstileRenderOptions {
		return {
			sitekey: this.#siteKey,
			action: INQUIRY_CHALLENGE_ACTION,
			execution: "execute",
			appearance: "interaction-only",
			size: "flexible",
			theme: "auto",
			retry: "never",
			"refresh-expired": "manual",
			"response-field": false,
			"feedback-enabled": false,
			callback: (token) => this.#settle({ ok: true, token }),
			"error-callback": () => {
				this.#settle({ ok: false, reason: "blocked" });
				return true;
			},
			"expired-callback": () => {},
			"timeout-callback": () =>
				this.#settle({ ok: false, reason: "expired" }),
			"unsupported-callback": () =>
				this.#settle({ ok: false, reason: "unsupported" }),
			"before-interactive-callback": () => {
				if (this.#attempt) {
					this.#attempt.cancelTimer?.();
					this.#attempt.cancelTimer = null;
				}
				this.#onInteractive(true);
			},
			"after-interactive-callback": () => {
				this.#onInteractive(false);
				this.#armTimer();
			},
		};
	}

	#armTimer(): void {
		const attempt = this.#attempt;
		if (!attempt) return;
		attempt.cancelTimer?.();
		attempt.cancelTimer = this.#host.setTimer(
			() => this.#settle({ ok: false, reason: "blocked" }),
			TOKEN_TIMEOUT_MS,
		);
	}

	#settle(result: ChallengeResult): void {
		const attempt = this.#attempt;
		if (!attempt) return;
		this.#attempt = null;
		attempt.cancelTimer?.();
		this.#onInteractive(false);
		attempt.resolve(result);
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/challenge.test.ts`
Expected: PASS. Note the interactive test's expected `[true, false, false]`: `after-interactive-callback` reports `false`, then settling the attempt reports `false` again (the form treats both the same).

- [ ] **Step 5: Write the browser host**

Create `apps/storefront/src/intake/challenge-host.ts`:

```ts
import {
	type ChallengeHost,
	TURNSTILE_READY_CALLBACK,
	type TurnstileApi,
} from "./challenge.ts";

/**
 * The page's side of Challenge (TAT-57): one script tag from
 * challenges.cloudflare.com, Cloudflare's `turnstile` global and the
 * window's timers. Browser only, and only called from the form's handlers
 * and effects; the browser pass covers it.
 */
export function browserChallengeHost(): ChallengeHost {
	return {
		loadScript(url, ready, failed) {
			const globals = window as unknown as Record<string, unknown>;
			globals[TURNSTILE_READY_CALLBACK] = () => {
				delete globals[TURNSTILE_READY_CALLBACK];
				ready();
			};
			const script = document.createElement("script");
			script.src = url;
			script.async = true;
			script.addEventListener(
				"error",
				() => {
					script.remove();
					delete globals[TURNSTILE_READY_CALLBACK];
					failed();
				},
				{ once: true },
			);
			document.head.append(script);
		},
		turnstile: () =>
			(window as unknown as { turnstile?: TurnstileApi }).turnstile,
		setTimer(run, ms) {
			const handle = window.setTimeout(run, ms);
			return () => window.clearTimeout(handle);
		},
	};
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

```bash
git add apps/storefront/src/intake/challenge.ts apps/storefront/src/intake/challenge-host.ts apps/storefront/test/intake/challenge.test.ts
git commit -m "feat(storefront): run Cloudflare Turnstile per attempt, loaded only once the form is used

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Every refusal, in words a person can act on

**Files:**
- Create: `apps/storefront/src/intake/problems.ts`
- Test: `apps/storefront/test/intake/problems.test.ts`

**Interfaces:**
- Consumes: `copy`, `fill`, `type NoticeCode` (Task 1); `FIELD_ORDER`, `type FieldErrors`, `type IntakeField` (Task 2); `type ChallengeFailure` (Task 6); `isTattooApiError`, `TattooApiError` from `@tattoo-drip/sdk`.
- Produces: `type SubmitProblem = { kind: "fields"; fields: FieldErrors; photos: Readonly<Record<number, string>>; photosError: string | null } | { kind: "notice"; code: NoticeCode; retry: boolean; contact: boolean; reload: boolean; waitSeconds: number | null }`; `interface ProblemContext { sentArtistId: string | null; artistName(id: string): string | null }`; `describeSubmitError(error: unknown, context: ProblemContext): SubmitProblem`; `describeChallengeFailure(reason: ChallengeFailure): SubmitProblem`; `formatWait(seconds: number): string`; `noticeValues(problem, studioName): { studio: string; wait: string }`; `DEFAULT_WAIT_SECONDS = 60`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/problems.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TattooApiError } from "@tattoo-drip/sdk";
import {
	describeChallengeFailure,
	describeSubmitError,
	formatWait,
	noticeValues,
	type ProblemContext,
	type SubmitProblem,
} from "../../src/intake/problems.ts";

const SITA_ID = "0199f000-0000-7000-8000-000000000048";
const CONTEXT: ProblemContext = {
	sentArtistId: null,
	artistName: (id) => (id === SITA_ID ? "Sita Rai" : null),
};
/** The API's message, which the form must never show for these codes. */
const DETAIL = "internal-detail-never-shown";

function notice(
	code: Extract<SubmitProblem, { kind: "notice" }>["code"],
	flags: { retry?: boolean; contact?: boolean; reload?: boolean; waitSeconds?: number } = {},
): SubmitProblem {
	return {
		kind: "notice",
		code,
		retry: flags.retry ?? false,
		contact: flags.contact ?? false,
		reload: flags.reload ?? false,
		waitSeconds: flags.waitSeconds ?? null,
	};
}

const apiError = (status: number, code?: string, extra: { fields?: Record<string, string[]>; retryAfter?: number } = {}) =>
	new TattooApiError(status, code ? { code, message: DETAIL, fields: extra.fields } : undefined, {
		retryAfter: extra.retryAfter,
	});

describe("describeSubmitError", () => {
	test("every code the API or the SDK can give becomes its notice", () => {
		const table: Array<[TattooApiError | Error, SubmitProblem]> = [
			[apiError(409, "too_many_open_inquiries"), notice("already-waiting", { contact: true })],
			[apiError(409, "studio_not_accepting"), notice("studio-closed", { contact: true })],
			[apiError(403, "challenge_failed"), notice("challenge-failed", { retry: true, contact: true })],
			[apiError(503, "challenge_unavailable"), notice("challenge-unavailable", { retry: true, contact: true })],
			[apiError(413, "payload_too_large"), notice("too-large")],
			[apiError(413), notice("too-large")],
			[apiError(400, "bad_request"), notice("cut-off", { retry: true })],
			[apiError(404, "not_found"), notice("page-outdated", { reload: true })],
			[apiError(0, "timeout"), notice("timeout", { retry: true })],
			[apiError(0, "network_error"), notice("offline", { retry: true })],
			[apiError(415, "unsupported_media_type"), notice("server", { retry: true, contact: true })],
			[apiError(405, "method_not_allowed"), notice("server", { retry: true, contact: true })],
			[apiError(500, "internal_error"), notice("server", { retry: true, contact: true })],
			[apiError(502), notice("server", { retry: true, contact: true })],
			[apiError(404), notice("server", { retry: true, contact: true })],
			[apiError(200, "invalid_response"), notice("server", { retry: true, contact: true })],
			[new TypeError("x is not a function"), notice("server", { retry: true, contact: true })],
			[new DOMException("The operation was aborted.", "AbortError") as Error, notice("server", { retry: true, contact: true })],
		];
		for (const [error, expected] of table) {
			const problem = describeSubmitError(error, CONTEXT);
			assert.deepEqual(problem, expected, `${(error as TattooApiError).code ?? error.name} ${(error as TattooApiError).status ?? ""}`);
			assert.doesNotMatch(JSON.stringify(problem), new RegExp(DETAIL));
		}
	});

	test("rate limits say how long", () => {
		assert.deepEqual(
			describeSubmitError(apiError(429, "rate_limited", { retryAfter: 86_400 }), CONTEXT),
			notice("rate-limited", { contact: true, waitSeconds: 86_400 }),
		);
		assert.deepEqual(
			describeSubmitError(apiError(429, "rate_limited"), CONTEXT),
			notice("rate-limited", { contact: true, waitSeconds: 60 }),
		);
		assert.deepEqual(
			describeSubmitError(apiError(429, undefined, { retryAfter: 30 }), CONTEXT),
			notice("rate-limited", { contact: true, waitSeconds: 30 }),
		);
	});

	test("field errors land on their fields, with the API's own words", () => {
		const problem = describeSubmitError(
			apiError(422, "validation_failed", {
				fields: {
					contactPhone: ["Enter a phone number, like 9812345678 or +977 1 4123456."],
					preferredArtistId: ["Choose an artist from the list, or none.", "second"],
					"referenceImages.1": ["Upload a JPEG, PNG or WebP image."],
					referenceImages: ["Attach up to 5 images."],
					website: ["ignored"],
					challengeToken: ["ignored"],
					idea: [""],
				},
			}),
			CONTEXT,
		);

		assert.deepEqual(problem, {
			kind: "fields",
			fields: {
				contactPhone: "Enter a phone number, like 9812345678 or +977 1 4123456.",
				preferredArtistId: "Choose an artist from the list, or none.",
			},
			photos: { 1: "This photo wasn't accepted: Upload a JPEG, PNG or WebP image. Remove it, then send again." },
			photosError: "Attach up to 5 images.",
		});
	});

	test("a validation error the form can't place says some answers weren't accepted", () => {
		assert.deepEqual(
			describeSubmitError(apiError(422, "validation_failed", { fields: { website: ["x"] } }), CONTEXT),
			notice("invalid"),
		);
		assert.deepEqual(describeSubmitError(apiError(422, "validation_failed"), CONTEXT), notice("invalid"));
	});

	test("an artist who just closed is named on the artist choice", () => {
		assert.deepEqual(describeSubmitError(apiError(409, "artist_not_accepting"), { ...CONTEXT, sentArtistId: SITA_ID }), {
			kind: "fields",
			fields: { preferredArtistId: "Sita Rai just stopped taking new inquiries. Choose another artist, or No preference." },
			photos: {},
			photosError: null,
		});
		assert.deepEqual(describeSubmitError(apiError(409, "artist_not_accepting"), CONTEXT), {
			kind: "fields",
			fields: { preferredArtistId: "That artist just stopped taking new inquiries. Choose another artist, or No preference." },
			photos: {},
			photosError: null,
		});
	});
});

describe("describeChallengeFailure", () => {
	test("each widget failure has its notice", () => {
		assert.deepEqual(describeChallengeFailure("blocked"), notice("challenge-blocked", { retry: true, contact: true }));
		assert.deepEqual(describeChallengeFailure("expired"), notice("challenge-expired", { retry: true }));
		assert.deepEqual(describeChallengeFailure("unsupported"), notice("challenge-unsupported", { contact: true }));
	});
});

describe("formatWait", () => {
	test("in minutes, then hours, rounded up", () => {
		for (const [seconds, words] of [
			[0, "a minute"],
			[45, "a minute"],
			[60, "a minute"],
			[61, "2 minutes"],
			[1_200, "20 minutes"],
			[3_599, "an hour"],
			[3_600, "an hour"],
			[3_601, "2 hours"],
			[86_400, "24 hours"],
		] as const) {
			assert.equal(formatWait(seconds), words, String(seconds));
		}
	});
});

describe("noticeValues", () => {
	test("the studio's name and the wait", () => {
		assert.deepEqual(noticeValues(notice("rate-limited", { waitSeconds: 1_200 }) as Extract<SubmitProblem, { kind: "notice" }>, "Black Needle"), {
			studio: "Black Needle",
			wait: "20 minutes",
		});
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/problems.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/problems.ts`.

- [ ] **Step 3: Write `problems.ts`**

Create `apps/storefront/src/intake/problems.ts`:

```ts
import { isTattooApiError } from "@tattoo-drip/sdk";
import type { ChallengeFailure } from "./challenge.ts";
import { copy, fill, type NoticeCode } from "./copy.ts";
import { FIELD_ORDER, type FieldErrors, type IntakeField } from "./rules.ts";

/*
 * What the form says when a send doesn't go through (TAT-57, spec ruling
 * 11): an error on the field it is about, or a notice with fixed copy
 * (copy.notices) and the way on: send again, reload, or the studio's chat
 * links. Branches on the API's code, never its message; the only API words
 * shown are validation_failed's field messages.
 */

export type SubmitProblem =
	| {
			readonly kind: "fields";
			readonly fields: FieldErrors;
			/** The API's message per sent photo index (`referenceImages.<i>`). */
			readonly photos: Readonly<Record<number, string>>;
			/** The API's message about the photos as a whole (`referenceImages`). */
			readonly photosError: string | null;
	  }
	| {
			readonly kind: "notice";
			readonly code: NoticeCode;
			/** "Send again" can help. */
			readonly retry: boolean;
			/** Show the studio's chat links. */
			readonly contact: boolean;
			/** Offer to reload the page. */
			readonly reload: boolean;
			/** Block Send this long (rate_limited). */
			readonly waitSeconds: number | null;
	  };

export interface ProblemContext {
	/** The artist the attempt asked for, if any. */
	readonly sentArtistId: string | null;
	artistName(id: string): string | null;
}

/** How long a 429 without Retry-After blocks Send. */
export const DEFAULT_WAIT_SECONDS = 60;
/** The most of an API field message the form shows. */
const MAX_MESSAGE = 300;
const FIELDS = new Set<string>(FIELD_ORDER);
const PHOTO_KEY = /^referenceImages\.(\d+)$/;

type Flags = {
	retry?: boolean;
	contact?: boolean;
	reload?: boolean;
	waitSeconds?: number;
};

function notice(code: NoticeCode, flags: Flags = {}): SubmitProblem {
	return {
		kind: "notice",
		code,
		retry: flags.retry ?? false,
		contact: flags.contact ?? false,
		reload: flags.reload ?? false,
		waitSeconds: flags.waitSeconds ?? null,
	};
}

export function describeSubmitError(
	error: unknown,
	context: ProblemContext,
): SubmitProblem {
	if (!isTattooApiError(error)) {
		return notice("server", { retry: true, contact: true });
	}
	const { retryAfter } = error;
	const rateLimited = () =>
		notice("rate-limited", {
			contact: true,
			waitSeconds: retryAfter ?? DEFAULT_WAIT_SECONDS,
		});
	switch (error.code) {
		case "validation_failed":
			return fieldProblem(error.fields);
		case "artist_not_accepting": {
			const name = context.sentArtistId
				? context.artistName(context.sentArtistId)
				: null;
			return {
				kind: "fields",
				fields: {
					preferredArtistId: name
						? fill(copy.errors.artistClosed, { artist: name })
						: copy.errors.artistClosedUnnamed,
				},
				photos: {},
				photosError: null,
			};
		}
		case "too_many_open_inquiries":
			return notice("already-waiting", { contact: true });
		case "studio_not_accepting":
			return notice("studio-closed", { contact: true });
		case "challenge_failed":
			return notice("challenge-failed", { retry: true, contact: true });
		case "challenge_unavailable":
			return notice("challenge-unavailable", { retry: true, contact: true });
		case "rate_limited":
			return rateLimited();
		case "payload_too_large":
			return notice("too-large");
		case "bad_request":
			return notice("cut-off", { retry: true });
		case "not_found":
			return notice("page-outdated", { reload: true });
		case "timeout":
			return notice("timeout", { retry: true });
		case "network_error":
			return notice("offline", { retry: true });
	}
	// A response without the API's envelope (a proxy's 413 or 429).
	if (error.status === 413) return notice("too-large");
	if (error.status === 429) return rateLimited();
	return notice("server", { retry: true, contact: true });
}

export function describeChallengeFailure(
	reason: ChallengeFailure,
): SubmitProblem {
	switch (reason) {
		case "blocked":
			return notice("challenge-blocked", { retry: true, contact: true });
		case "expired":
			return notice("challenge-expired", { retry: true });
		case "unsupported":
			return notice("challenge-unsupported", { contact: true });
	}
}

function fieldProblem(apiFields: Record<string, string[]>): SubmitProblem {
	const fields: FieldErrors = {};
	const photos: Record<number, string> = {};
	let photosError: string | null = null;
	for (const [key, messages] of Object.entries(apiFields)) {
		const message = messages
			.find((each) => typeof each === "string" && each.trim() !== "")
			?.trim()
			.slice(0, MAX_MESSAGE);
		if (!message) continue;
		const photo = PHOTO_KEY.exec(key);
		if (FIELDS.has(key)) {
			fields[key as IntakeField] ??= message;
		} else if (key === "referenceImages") {
			photosError ??= message;
		} else if (photo) {
			photos[Number(photo[1])] ??= fill(copy.photos.refused, { message });
		}
	}
	const placed =
		Object.keys(fields).length > 0 ||
		Object.keys(photos).length > 0 ||
		photosError !== null;
	return placed ? { kind: "fields", fields, photos, photosError } : notice("invalid");
}

/** "a minute", "20 minutes", "an hour", "24 hours": rounded up. */
export function formatWait(seconds: number): string {
	const minutes = Math.ceil(seconds / 60);
	if (minutes <= 1) return copy.wait.minute;
	if (minutes < 60) return fill(copy.wait.minutes, { count: minutes });
	const hours = Math.ceil(seconds / 3600);
	return hours <= 1 ? copy.wait.hour : fill(copy.wait.hours, { count: hours });
}

/** The values a notice's copy fills in. */
export function noticeValues(
	problem: Extract<SubmitProblem, { kind: "notice" }>,
	studioName: string,
): { studio: string; wait: string } {
	return {
		studio: studioName,
		wait: formatWait(problem.waitSeconds ?? DEFAULT_WAIT_SECONDS),
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/problems.test.ts`
Expected: PASS. If `new TattooApiError(status, undefined, …)` gives a code other than `unknown_error` in the built SDK, the envelope-less rows still pass (they fall through to the status checks); a different failure means the SDK changed: stop and report.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/intake/problems.ts apps/storefront/test/intake/problems.test.ts
git commit -m "feat(storefront): turn every intake refusal into a field error or a notice with a way on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: One attempt at a time, the widget reset after each

**Files:**
- Create: `apps/storefront/src/intake/submit-flow.ts`
- Test: `apps/storefront/test/intake/submit-flow.test.ts`

**Interfaces:**
- Consumes: `type ChallengeFailure`, `type ChallengeResult` (Task 6); `type CreateInquiryInput`, `type InquiryReceipt` from `@tattoo-drip/sdk`.
- Produces: `type SubmitPhase = "checking" | "sending"`; `type SubmitResult = { kind: "busy" } | { kind: "sent"; receipt: InquiryReceipt } | { kind: "challenge"; reason: ChallengeFailure } | { kind: "failed"; error: unknown }`; `interface SubmitDeps { challenge: { token(): Promise<ChallengeResult>; reset(): void } | null; send(input: CreateInquiryInput): Promise<InquiryReceipt>; onPhase(phase: SubmitPhase): void }`; `createSubmitter(deps: SubmitDeps): (input: CreateInquiryInput) => Promise<SubmitResult>`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/submit-flow.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { CreateInquiryInput, InquiryReceipt } from "@tattoo-drip/sdk";
import type { ChallengeResult } from "../../src/intake/challenge.ts";
import { createSubmitter, type SubmitPhase } from "../../src/intake/submit-flow.ts";

const INPUT: CreateInquiryInput = {
	idea: "A peony",
	placement: "Forearm",
	approximateSize: "10 cm",
	preferredDates: "November",
	sourceChannel: "instagram",
	contactName: "Asha",
	contactPhone: "9812345678",
	honeypot: "",
};
const RECEIPT: InquiryReceipt = { id: "0199f000-0000-7000-8000-000000000057" };

function setup(options: { token?: ChallengeResult | null; send?: () => Promise<InquiryReceipt> } = {}) {
	const sent: CreateInquiryInput[] = [];
	const phases: SubmitPhase[] = [];
	const events: string[] = [];
	const challenge =
		options.token === null
			? null
			: {
					token: async () => {
						events.push("token");
						return options.token ?? { ok: true as const, token: "tok-57" };
					},
					reset: () => events.push("reset"),
				};
	const submit = createSubmitter({
		challenge,
		send: async (input) => {
			events.push("send");
			sent.push(input);
			return options.send ? options.send() : RECEIPT;
		},
		onPhase: (phase) => phases.push(phase),
	});
	return { submit, sent, phases, events };
}

describe("createSubmitter", () => {
	test("checks, sends with the token, then resets the widget", async () => {
		const { submit, sent, phases, events } = setup();

		assert.deepEqual(await submit(INPUT), { kind: "sent", receipt: RECEIPT });
		assert.equal(sent[0].challengeToken, "tok-57");
		assert.deepEqual(phases, ["checking", "sending"]);
		assert.deepEqual(events, ["token", "send", "reset"]);
	});

	test("a refused send still resets the widget, and says why", async () => {
		const failure = new Error("refused");
		const { submit, events } = setup({ send: () => Promise.reject(failure) });

		assert.deepEqual(await submit(INPUT), { kind: "failed", error: failure });
		assert.deepEqual(events, ["token", "send", "reset"]);
	});

	test("no token, no send: the widget is reset for the next try", async () => {
		const { submit, sent, events, phases } = setup({ token: { ok: false, reason: "expired" } });

		assert.deepEqual(await submit(INPUT), { kind: "challenge", reason: "expired" });
		assert.equal(sent.length, 0);
		assert.deepEqual(events, ["token", "reset"]);
		assert.deepEqual(phases, ["checking"]);
	});

	test("without a site key (development) it sends with no token", async () => {
		const { submit, sent, phases } = setup({ token: null });

		assert.deepEqual(await submit(INPUT), { kind: "sent", receipt: RECEIPT });
		assert.equal(sent[0].challengeToken, undefined);
		assert.deepEqual(phases, ["sending"]);
	});

	test("a second tap while one attempt runs is busy, and sends nothing", async () => {
		let finish: (receipt: InquiryReceipt) => void = () => {};
		const { submit, sent } = setup({ send: () => new Promise((done) => { finish = done; }) });
		const first = submit(INPUT);

		assert.deepEqual(await submit(INPUT), { kind: "busy" });
		await new Promise((done) => setImmediate(done));
		finish(RECEIPT);
		assert.deepEqual(await first, { kind: "sent", receipt: RECEIPT });
		assert.equal(sent.length, 1);

		const again = submit(INPUT);
		await new Promise((done) => setImmediate(done));
		finish(RECEIPT);
		assert.deepEqual(await again, { kind: "sent", receipt: RECEIPT }, "free again after");
		assert.equal(sent.length, 2);
	});

	test("never changes the input it was given", async () => {
		const { submit } = setup();
		const input = { ...INPUT };
		await submit(input);

		assert.deepEqual(input, INPUT);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/submit-flow.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/submit-flow.ts`.

- [ ] **Step 3: Write `submit-flow.ts`**

Create `apps/storefront/src/intake/submit-flow.ts`:

```ts
import type { CreateInquiryInput, InquiryReceipt } from "@tattoo-drip/sdk";
import type { ChallengeFailure, ChallengeResult } from "./challenge.ts";

/*
 * One attempt to send an inquiry (TAT-57, spec ruling 8): a fresh token,
 * one send, the widget reset whatever happened. A second call while one
 * runs is `busy` and sends nothing (a double tap on a slow phone).
 */

export type SubmitPhase = "checking" | "sending";

export type SubmitResult =
	| { readonly kind: "busy" }
	| { readonly kind: "sent"; readonly receipt: InquiryReceipt }
	| { readonly kind: "challenge"; readonly reason: ChallengeFailure }
	| { readonly kind: "failed"; readonly error: unknown };

export interface SubmitDeps {
	/** null without a site key (development): no token is sent. */
	readonly challenge: {
		token(): Promise<ChallengeResult>;
		reset(): void;
	} | null;
	send(input: CreateInquiryInput): Promise<InquiryReceipt>;
	onPhase(phase: SubmitPhase): void;
}

export function createSubmitter(
	deps: SubmitDeps,
): (input: CreateInquiryInput) => Promise<SubmitResult> {
	let running = false;
	return async (input) => {
		if (running) return { kind: "busy" };
		running = true;
		try {
			let challengeToken: string | undefined;
			if (deps.challenge) {
				deps.onPhase("checking");
				const result = await deps.challenge.token();
				if (!result.ok) {
					deps.challenge.reset();
					return { kind: "challenge", reason: result.reason };
				}
				challengeToken = result.token;
			}
			deps.onPhase("sending");
			try {
				const receipt = await deps.send({ ...input, challengeToken });
				return { kind: "sent", receipt };
			} catch (error) {
				return { kind: "failed", error };
			} finally {
				deps.challenge?.reset();
			}
		} finally {
			running = false;
		}
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/submit-flow.test.ts`
Expected: PASS.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storefront/src/intake/submit-flow.ts apps/storefront/test/intake/submit-flow.test.ts
git commit -m "feat(storefront): send one inquiry attempt at a time with a fresh token

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `TURNSTILE_SITE_KEY`, from the server's settings to the browser

**Files:**
- Modify: `apps/storefront/src/site/context.ts` (whole file below)
- Modify: `apps/storefront/src/tenancy/config.ts`
- Modify: `apps/storefront/src/site/request.ts`
- Modify: `apps/storefront/scripts/check-client-bundle.mjs`, `apps/storefront/scripts/check-page.mjs`
- Modify: `apps/storefront/.env.local.example`
- Test: `apps/storefront/test/site/context.test.ts`, `apps/storefront/test/tenancy/config.test.ts`, `apps/storefront/test/scripts/check-client-bundle.test.ts`

**Interfaces:**
- Consumes: TAT-48's `SiteRef`, `dehydrateSite`, `hydrateSite`, `parseSiteOrigin`, `createRequestSite`; TAT-12's `parseStorefrontConfig`, `problem()`, `storefrontConfig()`.
- Produces: `CHALLENGE_SITE_KEY_SHAPE = /^[A-Za-z0-9_-]{10,100}$/`, `parseChallengeSiteKey(value: unknown): string | null`, `SiteRef.connect(origin: string, challengeSiteKey?: string | null)`, getter `SiteRef.challengeSiteKey: string | null`, `DehydratedSite = { site: { origin: string; challengeSiteKey: string | null } }`; `StorefrontConfig.challengeSiteKey?: string` (present only when set). Routes read it as `context.site.challengeSiteKey` (Task 12).

The variable's name appears only in `src/tenancy/config.ts`, the scripts, tests and docs: never in code the browser runs (not even a comment), because the bundle check now forbids it in browser files.

- [ ] **Step 1: Write the failing tests**

(a) In `apps/storefront/test/site/context.test.ts`, change the import to:

```ts
import {
	dehydrateSite,
	hydrateSite,
	parseChallengeSiteKey,
	parseSiteOrigin,
	SiteRef,
} from "../../src/site/context.ts";
```

add below `const INVALID = …`:

```ts
const SITE_KEY = "1x00000000000000000000AA";
```

replace the test `"only the origin, and it arrives through JSON as it left"` with:

```ts
	test("the origin and the public site key, through JSON as they left", () => {
		const server = new SiteRef();
		server.connect(ORIGIN, SITE_KEY);
		const dehydrated = dehydrateSite(server);
		assert.deepEqual(dehydrated, {
			site: { origin: ORIGIN, challengeSiteKey: SITE_KEY },
		});

		const browser = new SiteRef();
		hydrateSite(browser, JSON.parse(JSON.stringify(dehydrated)));
		assert.equal(browser.origin, ORIGIN);
		assert.equal(browser.challengeSiteKey, SITE_KEY);
	});

	test("no site key (development) travels as null", () => {
		const server = new SiteRef();
		server.connect(ORIGIN);
		assert.deepEqual(dehydrateSite(server), {
			site: { origin: ORIGIN, challengeSiteKey: null },
		});

		const browser = new SiteRef();
		hydrateSite(browser, { site: { origin: ORIGIN } });
		assert.equal(browser.challengeSiteKey, null, "a page from an older server");
	});

	test("a malformed site key can't hydrate", () => {
		for (const challengeSiteKey of ["short", "<script>", 42, "a b c d e f g h"]) {
			assert.throws(
				() => hydrateSite(new SiteRef(), { site: { origin: ORIGIN, challengeSiteKey } }),
				INVALID,
				String(challengeSiteKey),
			);
		}
	});
```

and append at the end of the file:

```ts
describe("parseChallengeSiteKey", () => {
	test("takes a Turnstile site key, or nothing", () => {
		assert.equal(parseChallengeSiteKey(SITE_KEY), SITE_KEY);
		assert.equal(parseChallengeSiteKey("0x4AAAAAAAB_c-Dd1234"), "0x4AAAAAAAB_c-Dd1234");
		assert.equal(parseChallengeSiteKey(null), null);
		assert.equal(parseChallengeSiteKey(undefined), null);
	});

	test("refuses anything that could break out of where it goes", () => {
		for (const value of ["", "a".repeat(9), "a".repeat(101), 'key"onload', "key key key", 7]) {
			assert.throws(() => parseChallengeSiteKey(value), INVALID, String(value));
		}
	});

	test("a SiteRef has no site key until it is set", () => {
		assert.throws(() => new SiteRef().challengeSiteKey, /not set yet/);
	});
});
```

(b) Append to `apps/storefront/test/tenancy/config.test.ts`:

```ts
describe("TURNSTILE_SITE_KEY", () => {
	const KEY = "1x00000000000000000000AA";

	test("is optional outside production: without one the config has no challengeSiteKey", () => {
		for (const env of [PROD, { ...PROD, NODE_ENV: "development" }, { ...PROD, NODE_ENV: "test" }]) {
			assert.equal("challengeSiteKey" in parseStorefrontConfig(env), false);
		}
	});

	test("reads a key, trimmed", () => {
		assert.equal(
			parseStorefrontConfig({ ...PROD, TURNSTILE_SITE_KEY: ` ${KEY}\n` }).challengeSiteKey,
			KEY,
		);
	});

	test("is required in production", () => {
		const message = failure({ ...PROD, NODE_ENV: "production" });
		assert.match(message, /TURNSTILE_SITE_KEY is not set/);
		assert.match(message, /Turnstile/);
		assert.equal(
			parseStorefrontConfig({ ...PROD, NODE_ENV: "production", TURNSTILE_SITE_KEY: KEY })
				.challengeSiteKey,
			KEY,
		);
	});

	test("refuses a malformed key without echoing it", () => {
		for (const key of ["shortkey1", "has spaces in it 0123", "<script>alert(1)</script>", "k".repeat(101)]) {
			const message = failure({ ...PROD, TURNSTILE_SITE_KEY: key });
			assert.match(message, /TURNSTILE_SITE_KEY is invalid/, key);
			assert.ok(!message.includes(key), key);
		}
	});

	test("is reported with the other settings' problems", () => {
		const message = failure({ NODE_ENV: "production" });
		assert.match(message, /API_URL is not set/);
		assert.match(message, /STOREFRONT_URL is not set/);
		assert.match(message, /TURNSTILE_SITE_KEY is not set/);
	});
});
```

(c) In `apps/storefront/test/scripts/check-client-bundle.test.ts`, test `"fails on each server-only name, in any text file, and names the file"`: add `"TURNSTILE_SITE_KEY"` and `"TURNSTILE_SECRET_KEY"` to `names`.

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/site/context.test.ts test/tenancy/config.test.ts test/scripts/check-client-bundle.test.ts`
Expected: FAIL: `parseChallengeSiteKey` is not exported, the dehydrated state has no `challengeSiteKey`, production doesn't ask for the key, the bundle check passes the two names.

- [ ] **Step 3: Write the site key into `SiteRef`**

Replace `apps/storefront/src/site/context.ts` with:

```ts
/**
 * The studio page's public settings (TAT-48, TAT-57): its own origin, e.g.
 * https://blackneedle.tattoodrip.com (canonical links and Open Graph URLs
 * must be absolute), and the public site key of the intake form's bot check
 * (null in development without one). Set once, like TAT-23's
 * TattooClientRef: on the server from the settings and the slug the tenant
 * middleware confirmed (src/site/request.ts), in the browser from the
 * router's dehydrated state. The browser never reads its own host (TAT-12).
 * Both values are public: every page carries them.
 */

const NOT_SET =
	"The site origin is not set yet: getRouter() sets it on the server, the router's hydrate in the browser.";
const INVALID =
	"This page's site address is missing or invalid. Reload the page.";

/** A Turnstile site key: public, and safe wherever it is written. */
export const CHALLENGE_SITE_KEY_SHAPE = /^[A-Za-z0-9_-]{10,100}$/;

/** The router context's part for the site (next to TAT-23's ApiContext). */
export interface SiteContext {
	readonly site: SiteRef;
}

/** What the router's dehydrated state carries for the site. */
export interface DehydratedSite {
	site: { origin: string; challengeSiteKey: string | null };
}

export class SiteRef {
	#origin: string | undefined;
	#challengeSiteKey: string | null = null;

	connect(origin: string, challengeSiteKey: string | null = null): void {
		if (this.#origin !== undefined) {
			throw new Error("The site origin is already set.");
		}
		const key = parseChallengeSiteKey(challengeSiteKey);
		this.#origin = parseSiteOrigin(origin);
		this.#challengeSiteKey = key;
	}

	get origin(): string {
		if (this.#origin === undefined) throw new Error(NOT_SET);
		return this.#origin;
	}

	/** The intake form's public Turnstile site key, or null (no bot check). */
	get challengeSiteKey(): string | null {
		if (this.#origin === undefined) throw new Error(NOT_SET);
		return this.#challengeSiteKey;
	}
}

/** An http(s) origin exactly (no path, no trailing slash, lowercase), or a fixed error. */
export function parseSiteOrigin(value: unknown): string {
	if (typeof value === "string") {
		const url = parseUrl(value);
		if (
			url &&
			(url.protocol === "https:" || url.protocol === "http:") &&
			url.origin === value
		) {
			return value;
		}
	}
	throw new Error(INVALID);
}

/** A site key of the expected shape, null for none (also from an older server's page), or a fixed error. */
export function parseChallengeSiteKey(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" && CHALLENGE_SITE_KEY_SHAPE.test(value)) {
		return value;
	}
	throw new Error(INVALID);
}

/** The router's dehydrate: the origin and the site key, and nothing else. */
export function dehydrateSite(site: SiteRef): DehydratedSite {
	return {
		site: { origin: site.origin, challengeSiteKey: site.challengeSiteKey },
	};
}

/** The router's hydrate: sets the browser's site from the server's. */
export function hydrateSite(
	site: SiteRef,
	dehydrated: { site?: unknown } | undefined,
): void {
	const value = dehydrated?.site;
	const fields =
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: {};
	site.connect(
		parseSiteOrigin(fields.origin),
		parseChallengeSiteKey(fields.challengeSiteKey),
	);
}

function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}
```

- [ ] **Step 4: Read the setting in `config.ts`**

In `apps/storefront/src/tenancy/config.ts`:

(a) add at the top, after the `./host.ts` import:

```ts
import { CHALLENGE_SITE_KEY_SHAPE } from "../site/context.ts";
```

(b) in `interface StorefrontConfig`, after the `serverKey?: string;` member and its comment, add:

```ts
	/**
	 * TURNSTILE_SITE_KEY, only when set: the public site key of the studio
	 * pages' Cloudflare Turnstile widget (the intake form's bot check, TAT-57).
	 * Required when NODE_ENV is production; sent to every visitor.
	 */
	challengeSiteKey?: string;
```

(c) after `const SERVER_KEY_SHAPE = …;` add:

```ts
const SITE_KEY_RULE =
	"the site key of the studio pages' Cloudflare Turnstile widget (Cloudflare dashboard, Turnstile): 10 to 100 letters, digits, - or _. Production needs it; in development leave it unset, or use Cloudflare's test key 1x00000000000000000000AA";
```

(d) in `parseStorefrontConfig`, after the `serverKey` line add:

```ts
	const challengeSiteKey = readChallengeSiteKey(
		env.TURNSTILE_SITE_KEY?.trim(),
		env.NODE_ENV === "production",
		problems,
	);
```

and replace its `return` with:

```ts
	return {
		apiUrl,
		...site,
		...(serverKey ? { serverKey } : {}),
		...(challengeSiteKey ? { challengeSiteKey } : {}),
	};
```

(e) add after `readServerKey`:

```ts
/** Required in production (every inquiry needs a token there); refused when malformed. */
function readChallengeSiteKey(
	value: string | undefined,
	production: boolean,
	problems: string[],
): string | undefined {
	if (!value) {
		if (production) {
			problems.push(problem("TURNSTILE_SITE_KEY", value, SITE_KEY_RULE));
		}
		return undefined;
	}
	if (!CHALLENGE_SITE_KEY_SHAPE.test(value)) {
		problems.push(problem("TURNSTILE_SITE_KEY", value, SITE_KEY_RULE));
		return undefined;
	}
	return value;
}
```

- [ ] **Step 5: Hand it to the router's site in `request.ts`**

In `apps/storefront/src/site/request.ts`, replace the server branch's two lines

```ts
		const site = new SiteRef();
		site.connect(tenantOrigin(storefrontConfig(), requestStudio().slug));
```

with

```ts
		const config = storefrontConfig();
		const site = new SiteRef();
		site.connect(
			tenantOrigin(config, requestStudio().slug),
			config.challengeSiteKey ?? null,
		);
```

and in its doc comment replace "A new router's site origin (TAT-48)." with "A new router's site: its origin (TAT-48) and the intake form's public site key (TAT-57).".

- [ ] **Step 6: The bundle check and the page check know the key**

(a) In `apps/storefront/scripts/check-client-bundle.mjs`, add to `SERVER_ONLY` after `"STOREFRONT_URL",`:

```js
	// The setting's name, not its value: the site key is public and reaches
	// the browser in the router's dehydrated state (TAT-57), never in the
	// bundle. The platform's secret has no business in the storefront at all.
	"TURNSTILE_SITE_KEY",
	"TURNSTILE_SECRET_KEY",
```

(b) In `apps/storefront/scripts/check-page.mjs`:
- after `const CANARY = …;` add:

```js
// Cloudflare's always-pass test site key: public by design, so the page
// must carry it (production refuses to start without one, TAT-57).
const SITE_KEY = "1x00000000000000000000AA";
```

- in the spawned server's `env`, after `STOREFRONT_SERVER_KEY: CANARY,` add `TURNSTILE_SITE_KEY: SITE_KEY,`;
- after the expectation that the page carries the API's origin and the studio's slug (the `apiUrl:"…",tenant:"…"` check), add:

```js
	expect(
		page.body.includes(`challengeSiteKey:"${SITE_KEY}"`),
		"The page does not carry the public Turnstile site key.",
	);
```

- in the final success `console.log`, append `; the public site key is in the page` before the closing period.

(c) In `apps/storefront/.env.local.example`, after the `STOREFRONT_SERVER_KEY` block, add:

```bash
# Public site key of the studio pages' Cloudflare Turnstile widget (the
# intake form's bot check, TAT-55/57). Optional in development: unset, the
# form runs no check and sends no token, which the platform accepts while its
# own TURNSTILE_SECRET_KEY is unset. To try the widget, set Cloudflare's test
# pair: this site key 1x00000000000000000000AA (always passes;
# 3x00000000000000000000FF forces the checkbox, 2x00000000000000000000AB
# always fails) and the platform's TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA.
# Required in production. It is public: every page sends it to the browser.
# TURNSTILE_SITE_KEY=
```

- [ ] **Step 7: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0` (TAT-48's site and render tests included: `connect(origin)` still works without a key).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront build`
Expected: succeeds and ends with "Client bundle check: … no server-only text." (the setting's name stayed in server code). `git status --short apps/storefront/src/routeTree.gen.ts` prints nothing.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront check:page`
Expected: "Page check passed: … the public site key is in the page." If it fails for a reason that isn't this task's (for example a stand-in API answer TAT-48 left out), stop and report the message.

- [ ] **Step 8: Commit**

```bash
git add apps/storefront/src/site/context.ts apps/storefront/src/site/request.ts apps/storefront/src/tenancy/config.ts apps/storefront/scripts/check-client-bundle.mjs apps/storefront/scripts/check-page.mjs apps/storefront/.env.local.example apps/storefront/test/site/context.test.ts apps/storefront/test/tenancy/config.test.ts apps/storefront/test/scripts/check-client-bundle.test.ts
git commit -m "feat(storefront): carry the public Turnstile site key from the settings to the browser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The form toolkit's sizes, a radio field, and the form's styles

**Files:**
- Modify: `apps/storefront/src/components/ui/form.tsx`
- Modify: `apps/storefront/src/styles.css` (append)
- Create: `apps/storefront/test/ui/form-demo.tsx` (a test fixture)
- Test: `apps/storefront/test/ui/form.test.ts`

**Interfaces:**
- Consumes: shadcn's `Field`, `FieldDescription`, `FieldError`, `FieldLabel`, `FieldLegend`, `FieldSet` (`./field.tsx`), `Input`, `Textarea`, `Select*`.
- Produces: `useAppForm` with field components `TextField`, `TextareaField`, `SelectField` (as before, now 3rem controls with 1.0625rem text, 1rem semibold labels and quiet errors) and `ChoiceField({ legend, description?, options: readonly { value: string; label: ReactNode }[], required?, disabled? })` (native radios with ids `<name>-<index>` in a fieldset with id `<name>`); CSS classes `intake`, `intake-note`, `intake-group`, `intake-legend`, `intake-label`, `intake-pair`, `intake-photos`, `photo-tray`, `photo`, `photo-error`, `photo-pending`, `photo-remove`, `photo-add`, `photo-messages`, `intake-trap`, `intake-challenge`, `intake-submit`, `intake-progress`, `intake-status`, `intake-alert`, `intake-alert-title`, `intake-chat`, `intake-chat-links`, `intake-sent`, `intake-sent-title`.

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/ui/form-demo.tsx`:

```tsx
import { useAppForm } from "../../src/components/ui/form.tsx";

/** A two-field form for the toolkit's render test. */
export function FormDemo() {
	const form = useAppForm({ defaultValues: { name: "", pick: "b" } });
	return (
		<form>
			<form.AppField name="name">
				{(field) => <field.TextField label="Name" description="A hint" required />}
			</form.AppField>
			<form.AppField name="pick">
				{(field) => (
					<field.ChoiceField
						legend="Pick one"
						options={[
							{ value: "a", label: "A" },
							{ value: "b", label: "B" },
						]}
						required
					/>
				)}
			</form.AppField>
		</form>
	);
}
```

Create `apps/storefront/test/ui/form.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormDemo } from "./form-demo.tsx";

const html = renderToStaticMarkup(createElement(FormDemo));
const tag = (pattern: RegExp) => html.match(pattern)?.[0] ?? "";

test("text fields are 3rem tall with 17px text and a described label", () => {
	const input = tag(/<input[^>]*id="name"[^>]*>/);

	assert.match(input, /class="[^"]*\bh-12\b/);
	assert.match(input, /text-\[1\.0625rem\]/);
	assert.doesNotMatch(input, /\bh-9\b/);
	assert.match(input, /aria-describedby="name-description"/);
	assert.match(input, / required=""/);
	assert.match(tag(/<label[^>]*for="name"[^>]*>/), /\btext-base\b/);
	assert.match(html, /id="name-description"[^>]*>A hint</);
});

test("a choice is a fieldset of native radios, each inside its label", () => {
	assert.match(html, /<fieldset[^>]*id="pick"/);
	assert.match(html, /<legend[^>]*>Pick one<\/legend>/);
	const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
	assert.equal(radios.length, 2);
	assert.equal((html.match(/<label[^>]*>\s*<input[^>]*type="radio"/g) ?? []).length, 2);
	assert.match(radios[0], /id="pick-0"/);
	assert.match(radios[0], /name="pick"/);
	assert.doesNotMatch(radios[0], / checked=""/);
	assert.match(radios[1], / checked=""/);
	for (const radio of radios) assert.match(radio, / required=""/);
});

test("no field error is announced on its own", () => {
	assert.doesNotMatch(html, /role="alert"/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/ui/form.test.ts`
Expected: FAIL: `field.ChoiceField` is not a component (or, before that, a module-resolution error for the toolkit's `#/` imports: Step 3 replaces them).

- [ ] **Step 3: Rework `form.tsx`**

Replace `apps/storefront/src/components/ui/form.tsx` with:

```tsx
import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { cn } from "cn";
import type { ComponentProps, ReactNode } from "react";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "./field.tsx";
import { Input } from "./input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./select.tsx";
import { Textarea } from "./textarea.tsx";

/*
 * TanStack Form composition for the storefront's forms. Build a form with
 * `useAppForm` and render fields with `<form.AppField name="…">`, whose
 * `field` exposes the components below (`field.TextField`, …). Each one
 * follows shadcn's TanStack Form pattern: `Field` + `FieldLabel` +
 * `FieldError`, with `aria-invalid` and `aria-describedby` wired up.
 *
 * Sized for phones (TAT-57): controls 3rem tall with 1.0625rem text (iOS
 * zooms into smaller text), labels 1rem semibold. A field's error is tied
 * to its control by aria-describedby and not announced on its own: the
 * form shows and focuses an error summary instead. Imports are relative
 * with extensions, so node tests can load this file.
 */

const CONTROL_TEXT = "text-[1.0625rem] md:text-[1.0625rem]";
const LABEL = "text-base leading-snug font-semibold";
const HINT = "text-[0.9375rem]";

const { fieldContext, formContext, useFieldContext } = createFormHookContexts();

type FieldShellProps = {
	label: ReactNode;
	description?: ReactNode;
};

/** The field's first error messages, whatever shape the validator gave them. */
function useFieldErrors() {
	const field = useFieldContext<unknown>();
	return field.state.meta.errors.map((error) =>
		typeof error === "string" ? { message: error } : error,
	);
}

/** Props for the bound control: ids, ARIA state and blur tracking. */
function useControlProps(hasDescription: boolean) {
	const field = useFieldContext<unknown>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
	const describedBy = [
		hasDescription && `${field.name}-description`,
		isInvalid && `${field.name}-error`,
	]
		.filter(Boolean)
		.join(" ");

	return {
		isInvalid,
		props: {
			id: field.name,
			onBlur: field.handleBlur,
			"aria-invalid": isInvalid,
			"aria-describedby": describedBy || undefined,
		},
	};
}

function FieldShell({
	label,
	description,
	isInvalid,
	children,
}: FieldShellProps & { isInvalid: boolean; children: ReactNode }) {
	const field = useFieldContext<unknown>();
	const errors = useFieldErrors();

	return (
		<Field data-invalid={isInvalid}>
			<FieldLabel htmlFor={field.name} className={LABEL}>
				{label}
			</FieldLabel>
			{children}
			{description && (
				<FieldDescription id={`${field.name}-description`} className={HINT}>
					{description}
				</FieldDescription>
			)}
			{isInvalid && (
				// role undefined: no "alert" per field; the error summary speaks.
				<FieldError
					id={`${field.name}-error`}
					errors={errors}
					role={undefined}
					className={HINT}
				/>
			)}
		</Field>
	);
}

type TextFieldProps = FieldShellProps &
	Omit<
		ComponentProps<typeof Input>,
		"id" | "name" | "value" | "onChange" | "onBlur"
	>;

function TextField({
	label,
	description,
	className,
	...props
}: TextFieldProps) {
	const field = useFieldContext<string | undefined>();
	const control = useControlProps(Boolean(description));

	return (
		<FieldShell
			label={label}
			description={description}
			isInvalid={control.isInvalid}
		>
			<Input
				{...props}
				{...control.props}
				className={cn("h-12 px-3.5", CONTROL_TEXT, className)}
				name={field.name}
				value={field.state.value ?? ""}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
		</FieldShell>
	);
}

type TextareaFieldProps = FieldShellProps &
	Omit<
		ComponentProps<typeof Textarea>,
		"id" | "name" | "value" | "onChange" | "onBlur"
	>;

function TextareaField({
	label,
	description,
	className,
	...props
}: TextareaFieldProps) {
	const field = useFieldContext<string | undefined>();
	const control = useControlProps(Boolean(description));

	return (
		<FieldShell
			label={label}
			description={description}
			isInvalid={control.isInvalid}
		>
			<Textarea
				{...props}
				{...control.props}
				className={cn("min-h-32 px-3.5 py-2.5", CONTROL_TEXT, className)}
				name={field.name}
				value={field.state.value ?? ""}
				onChange={(event) => field.handleChange(event.target.value)}
			/>
		</FieldShell>
	);
}

type SelectFieldProps = FieldShellProps & {
	options: readonly { value: string; label: string }[];
	placeholder?: string;
	disabled?: boolean;
};

/** An empty value shows the placeholder; Radix doesn't allow empty items. */
function SelectField({
	label,
	description,
	options,
	placeholder,
	disabled,
}: SelectFieldProps) {
	const field = useFieldContext<string | undefined>();
	const control = useControlProps(Boolean(description));

	return (
		<FieldShell
			label={label}
			description={description}
			isInvalid={control.isInvalid}
		>
			<Select
				name={field.name}
				value={field.state.value ?? ""}
				onValueChange={field.handleChange}
				disabled={disabled}
			>
				<SelectTrigger {...control.props} className={cn("h-12", CONTROL_TEXT)}>
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{options
						.filter((option) => option.value !== "")
						.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
				</SelectContent>
			</Select>
		</FieldShell>
	);
}

type ChoiceFieldProps = {
	legend: ReactNode;
	description?: ReactNode;
	options: readonly { value: string; label: ReactNode }[];
	required?: boolean;
	disabled?: boolean;
};

/**
 * One choice among a few, as native radios: one tap each, visible without
 * opening anything, and the radio itself stays visible (violet accent), so
 * the choice shows even where `:has()` styling doesn't.
 */
function ChoiceField({
	legend,
	description,
	options,
	required,
	disabled,
}: ChoiceFieldProps) {
	const field = useFieldContext<string>();
	const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid;
	const errors = useFieldErrors();
	const describedBy = [
		description && `${field.name}-description`,
		isInvalid && `${field.name}-error`,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<FieldSet
			id={field.name}
			data-invalid={isInvalid}
			aria-describedby={describedBy || undefined}
			className="gap-3"
		>
			{/* variant "legend" is the 1rem one; "label" would pin it to 0.875rem. */}
			<FieldLegend variant="legend" className={cn("mb-0", LABEL)}>
				{legend}
			</FieldLegend>
			{description && (
				<FieldDescription id={`${field.name}-description`} className={HINT}>
					{description}
				</FieldDescription>
			)}
			<div className="flex flex-wrap gap-2">
				{options.map((option, index) => (
					<label
						key={option.value}
						className={cn(
							"inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-input px-3.5 py-2",
							CONTROL_TEXT,
							"has-checked:border-primary has-checked:bg-secondary has-disabled:cursor-not-allowed has-disabled:opacity-50",
						)}
					>
						<input
							type="radio"
							id={`${field.name}-${index}`}
							name={field.name}
							value={option.value}
							checked={field.state.value === option.value}
							onChange={() => field.handleChange(option.value)}
							onBlur={field.handleBlur}
							required={required}
							disabled={disabled}
							aria-invalid={isInvalid || undefined}
							className="size-4 shrink-0 accent-primary"
						/>
						<span dir="auto">{option.label}</span>
					</label>
				))}
			</div>
			{isInvalid && (
				<FieldError
					id={`${field.name}-error`}
					errors={errors}
					role={undefined}
					className={HINT}
				/>
			)}
		</FieldSet>
	);
}

const { useAppForm, withForm } = createFormHook({
	fieldContext,
	formContext,
	fieldComponents: { TextField, TextareaField, SelectField, ChoiceField },
	formComponents: {},
});

export { useAppForm, withForm };
```

If `node:test` still can't resolve `field.tsx`'s own `#/components/ui/label.tsx` or `separator.tsx` imports, change those two imports in `apps/storefront/src/components/ui/field.tsx` to `./label.tsx` and `./separator.tsx` (same files, relative path) and say so in the report; change nothing else in the shadcn files.

- [ ] **Step 4: Run the tests**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/ui/form.test.ts`
Expected: PASS. React writes some attribute names as written in JSX (`aria-describedby`, `id`, `required=""`); if a pattern fails only on an attribute's case, add the `i` flag to that one regex, never loosen what it checks.

- [ ] **Step 5: Append the intake form's styles**

At the end of `apps/storefront/src/styles.css`, append:

```css
/*
 * The intake form (TAT-57): TAT-48's tokens, and the stencil carried on:
 * thumbnails and the success block take the artist photo's violet offset
 * frame. Red (--destructive) is for errors only. The one motion is the
 * sending line, which answers the tap.
 */
@layer components {
  .intake { display: grid; gap: 2rem; justify-self: stretch; }
  .intake-note { color: var(--ink-muted); font-size: 0.9375rem; }
  .intake-note a, .intake-alert a { color: var(--stencil); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.2em; }
  .intake-group, .intake-photos { display: grid; gap: 1.5rem; min-width: 0; margin: 0; padding: 0; border: 0; }
  .intake-photos { gap: 0.75rem; }
  .intake-legend { margin-block-end: 0.25rem; font-family: var(--display-face); font-size: 1.5rem; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
  .intake-label { font-size: 1rem; font-weight: 600; line-height: 1.375; }
  .intake-pair { display: grid; gap: 1.5rem; }

  .photo-tray { display: flex; flex-wrap: wrap; gap: 1rem; margin: 0; padding: 0; list-style: none; }
  .photo { position: relative; isolation: isolate; inline-size: 6rem; block-size: 6rem; margin: 0 0.375rem 0.375rem 0; }
  .photo::after { content: ''; position: absolute; inset: 0; z-index: -1; translate: 0.375rem 0.375rem; border: 1.5px solid var(--stencil); }
  .photo img, .photo-pending { display: block; inline-size: 100%; block-size: 100%; object-fit: cover; background: var(--stencil-wash); }
  .photo-pending { display: grid; place-items: center; color: var(--ink-muted); font-size: 0.875rem; }
  .photo-error::after { border-color: var(--destructive); border-width: 2px; }
  .photo-remove { position: absolute; inset-block-start: 0; inset-inline-end: 0; display: grid; place-items: center; inline-size: 2.75rem; block-size: 2.75rem; border: 0; background: var(--ink); background: color-mix(in srgb, var(--ink) 78%, transparent); color: var(--paper); cursor: pointer; }
  .photo-remove:disabled { cursor: not-allowed; opacity: 0.6; }
  .photo-add { display: grid; place-items: center; align-content: center; gap: 0.25rem; inline-size: 6rem; block-size: 6rem; padding: 0.5rem; border: 1.5px dashed var(--stencil); border-radius: var(--radius); color: var(--stencil); font-size: 0.9375rem; font-weight: 600; line-height: 1.2; text-align: center; cursor: pointer; }
  .photo-add:hover { background: var(--stencil-wash); }
  .photo-add:focus-within { outline: 2px solid var(--stencil); outline-offset: 3px; }
  .photo-messages { display: grid; gap: 0.25rem; margin: 0; padding: 0; list-style: none; color: var(--destructive); font-size: 0.9375rem; }
  .photo-messages:empty { display: none; }

  .intake-trap { position: absolute; inset-inline-start: -10000px; inline-size: 1px; block-size: 1px; overflow: hidden; }
  .intake-challenge:empty { display: none; }

  .intake-submit { display: grid; gap: 0.75rem; }
  .intake-submit .action { inline-size: 100%; }
  .intake-submit .action[aria-disabled='true'] { cursor: progress; opacity: 0.75; }
  .intake-status { min-block-size: 1.6em; font-size: 0.9375rem; font-weight: 600; }
  .intake-progress { position: relative; block-size: 2px; overflow: hidden; background: var(--stencil-wash); }
  .intake-progress::before { content: ''; position: absolute; inset-block: 0; inline-size: 30%; background: var(--stencil); animation: intake-trace 1.4s ease-in-out infinite; }

  .intake-alert { display: grid; gap: 0.75rem; justify-items: start; padding-block: 0.75rem; padding-inline: 1rem 0; border-inline-start: 2px solid var(--destructive); }
  .intake-alert-title { font-weight: 700; }
  .intake-alert ul { display: grid; gap: 0.25rem; margin: 0; padding-inline-start: 1.25rem; }

  .intake-chat { color: var(--ink-muted); font-size: 0.9375rem; }
  .intake-chat-links { display: inline-flex; flex-wrap: wrap; gap: 0 1rem; margin-inline-start: 0.5rem; }

  .intake-sent { position: relative; isolation: isolate; display: grid; gap: 1rem; justify-items: start; margin: 0 0.375rem 0.375rem 0; padding: 1.5rem; border: 1.5px solid var(--stencil); background: var(--paper); }
  .intake-sent::after { content: ''; position: absolute; inset: 0; z-index: -1; translate: 0.375rem 0.375rem; border: 1.5px solid var(--stencil); }
  .intake-sent-title { font-size: 1.5rem; line-height: 1.2; }
}

@keyframes intake-trace {
  from { translate: -100% 0; }
  to { translate: 340% 0; }
}

@media (min-width: 40rem) {
  .intake-pair { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .intake-submit { justify-items: start; }
  .intake-submit .action { inline-size: auto; min-inline-size: 14rem; }
}

@media (prefers-reduced-motion: reduce) {
  .intake-progress::before { animation: none; inline-size: 100%; opacity: 0.5; }
}
```

- [ ] **Step 6: Typecheck, tests, build**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS (the prototype booking form, still present until Task 12, compiles against the new toolkit).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0` (TAT-48's `assets.test.ts` still finds no `url()` to a missing file: these styles have none).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront build`
Expected: succeeds, bundle check included.

- [ ] **Step 7: Commit**

```bash
git add apps/storefront/src/components/ui/form.tsx apps/storefront/src/styles.css apps/storefront/test/ui
git commit -m "feat(storefront): size the form toolkit for phones, add a radio field and the intake styles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The form, its photo tray, its notices and the success screen

**Files:**
- Create: `apps/storefront/src/intake/components/fill.tsx`
- Create: `apps/storefront/src/intake/components/notices.tsx`
- Create: `apps/storefront/src/intake/components/reference-picker.tsx`
- Create: `apps/storefront/src/intake/components/intake-form.tsx`
- Create: `apps/storefront/src/intake/components/intake-mount.tsx`
- Test: `apps/storefront/test/intake/render.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 8 and 10; TAT-48's `type InquiryState`, `type InquiryChannels` (`src/studio/inquiry.ts`), `linkRel` (`src/studio/links.ts`); `useCreateInquiry` from `@tattoo-drip/react`; `INQUIRY_HONEYPOT_FIELD`, `type CreateInquiryInput`, `type InquiryReceipt` from `@tattoo-drip/sdk`; `revalidateLogic`, `type AnyFieldApi` from `@tanstack/react-form`; `ImagePlus`, `X` from `lucide-react`.
- Produces: `Fill({ template, values })`; `type FormPhase = "idle" | "preparing" | "checking" | "interactive" | "sending"`; `type NoticeProblem`; `interface SummaryItem { target: string; label: ReactNode; message: string }`; `hasChannels(channels): boolean`; `ChatLinks({ channels })`; `ErrorSummary({ items, ref? })`; `ProblemNotice({ problem, studioName, channels, ref? })`; `statusText(phase, slow, photoCount, bytes): string`; `SubmitStatus({ phase, slow, photoCount, bytes })`; `IntakeSent({ studioName, phone, channels, ref? })`; `photoMessages(state): string[]`; `ReferencePicker({ state, previews, studioName, disabled, onPick, onRemove })`; `interface IntakeFormProps { state: Extract<InquiryState, { kind: "open" }>; channels: InquiryChannels; challengeSiteKey: string | null }`; `IntakeForm(props)`; `SLOW_AFTER_MS = 15_000`; `IntakeMount({ fallback, ...IntakeFormProps })` (Task 12 mounts it).

The components import nothing from TanStack Router and read no route state: everything comes as props, so `react-dom/server` renders them in tests (inside a `QueryClientProvider` and a `TattooProvider` for the form's `useCreateInquiry`).

- [ ] **Step 1: Write the failing test**

Create `apps/storefront/test/intake/render.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TattooProvider } from "@tattoo-drip/react";
import { createTattooClient } from "@tattoo-drip/sdk";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntakeForm, type IntakeFormProps } from "../../src/intake/components/intake-form.tsx";
import { IntakeSent, statusText } from "../../src/intake/components/notices.tsx";
import { ReferencePicker } from "../../src/intake/components/reference-picker.tsx";
import type { ReferencesState } from "../../src/intake/references.ts";
import { isAllowedHref } from "../../src/studio/links.ts";

const SITA = { id: "0199f000-0000-7000-8000-000000000048", name: "Sita Rai" };
const MINA = { id: "0199f000-0000-7000-8000-000000000050", name: "मीना गुरुङ" };
const CHANNELS = {
	whatsapp: "https://wa.me/9779812345678?text=Hi",
	email: "mailto:hello@black-needle.example?subject=Tattoo%20inquiry",
	instagram: null,
};
const SITE_KEY = "1x00000000000000000000AA";

type Open = IntakeFormProps["state"];
const open = (overrides: Partial<Open> = {}): Open => ({
	kind: "open",
	studioName: "Black Needle",
	preferredArtist: null,
	artists: [SITA, MINA],
	...overrides,
});

/** Rendered as the page renders it: inside the query and SDK providers. */
function render(element: ReactElement): string {
	const client = createTattooClient({
		baseUrl: "http://api.test",
		tenant: "black-needle-48",
		fetch: () => Promise.reject(new Error("no request during a render")),
	});
	return renderToStaticMarkup(
		createElement(QueryClientProvider, {
			client: new QueryClient(),
			children: createElement(TattooProvider, { client, children: element }),
		}),
	);
}

const formHtml = (state: Open = open(), challengeSiteKey: string | null = SITE_KEY) =>
	render(createElement(IntakeForm, { state, channels: CHANNELS, challengeSiteKey }));

const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, "g")) ?? [];
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`, "i").exec(tag)?.[1];
const decode = (value: string) =>
	value.replaceAll("&amp;", "&").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
const hrefs = (html: string) => Array.from(html.matchAll(/ href="([^"]*)"/g), (match) => decode(match[1]));
const control = (html: string, id: string) =>
	[...tags(html, "input"), ...tags(html, "textarea")].find((tag) => attr(tag, "id") === id) ?? "";
const radiosOf = (html: string, name: string) =>
	tags(html, "input").filter((tag) => attr(tag, "type") === "radio" && attr(tag, "name") === name);

describe("the intake form", () => {
	test("is one form, named by the section's heading, in two groups", () => {
		const html = formHtml();
		const [form] = tags(html, "form");

		assert.equal(count(html, /<form[\s>]/g), 1);
		assert.equal(attr(form, "method"), "post");
		assert.match(form, / novalidate=""/i);
		assert.equal(attr(form, "aria-labelledby"), "inquiry-title");
		assert.doesNotMatch(form, / action=/);
		assert.match(html, /<legend class="intake-legend">Your tattoo<\/legend>/);
		assert.match(html, /<legend class="intake-legend">How <bdi>Black Needle<\/bdi> reaches you<\/legend>/);
		assert.match(html, /Everything is needed unless it says \(optional\)\./);
	});

	test("labels every control", () => {
		const html = formHtml();
		const labelled = new Set(Array.from(html.matchAll(/<label[^>]* for="([^"]+)"/g), (match) => match[1]));

		for (const tag of [...tags(html, "input"), ...tags(html, "textarea")]) {
			const type = attr(tag, "type");
			if (type === "radio" || type === "file") continue;
			const id = attr(tag, "id");
			assert.ok(id && labelled.has(id), tag);
		}
		const radios = tags(html, "input").filter((tag) => attr(tag, "type") === "radio");
		assert.equal(count(html, /<label[^>]*>\s*<input[^>]*type="radio"/g), radios.length);
		assert.match(html, /<label class="photo-add"><input[^>]*type="file"/);
	});

	test("marks what is needed and what is optional", () => {
		const html = formHtml();

		for (const id of ["idea", "placement", "approximateSize", "preferredDates", "contactName", "contactPhone"]) {
			assert.match(control(html, id), / required=""/, id);
			assert.match(control(html, id), / aria-required="true"/, id);
		}
		for (const id of ["budget", "contactEmail"]) {
			assert.doesNotMatch(control(html, id), / required/, id);
		}
		for (const label of ["Budget (optional)", "Email (optional)", "Reference photos (optional)"]) {
			assert.ok(html.includes(label), label);
		}
		for (const radio of radiosOf(html, "sourceChannel")) {
			assert.match(radio, / required=""/);
		}
	});

	test("limits each one-line field like the API; the idea box has no maxlength, so a paste is never cut", () => {
		const html = formHtml();

		for (const [id, max] of [
			["placement", 120],
			["approximateSize", 120],
			["preferredDates", 500],
			["budget", 120],
			["contactName", 120],
			["contactPhone", 40],
			["contactEmail", 254],
		] as const) {
			assert.equal(attr(control(html, id), "maxlength"), String(max), id);
		}
		assert.equal(attr(control(html, "idea"), "maxlength"), undefined);
	});

	test("the honeypot is out of sight, not out of the page", () => {
		const html = formHtml();
		const trap = /<div class="intake-trap" aria-hidden="true">([\s\S]*?)<\/div>/.exec(html);

		assert.ok(trap, "the off-screen wrapper");
		assert.match(trap[1], /<label for="intake-website">Leave this empty<\/label>/);
		const [input] = tags(trap[1], "input");
		assert.equal(attr(input, "name"), "website");
		assert.equal(attr(input, "type"), "text");
		assert.equal(attr(input, "tabindex"), "-1");
		assert.equal(attr(input, "autocomplete"), "off");
		assert.equal(attr(input, "value"), "");
		assert.doesNotMatch(input, /required|hidden/);
		assert.doesNotMatch(html, / style=/);
	});

	test("asks for JPEG, PNG or WebP photos, several at once", () => {
		const html = formHtml();
		const file = tags(html, "input").find((tag) => attr(tag, "type") === "file") ?? "";

		assert.equal(attr(file, "accept"), "image/jpeg,image/png,image/webp");
		assert.match(file, / multiple=""/);
		assert.equal(attr(file, "id"), "references-input");
		assert.match(html, /<fieldset id="references" class="intake-photos"/);
		assert.match(html, />Add photos</);
		assert.match(
			html,
			/Up to 5 photos: designs you like, or the spot on your body\. Only <bdi>Black Needle<\/bdi> sees them\./,
		);
	});

	test("offers an artist only with two or more, or on an artist's page", () => {
		const studioPage = radiosOf(formHtml(), "preferredArtistId");
		assert.deepEqual(studioPage.map((tag) => attr(tag, "value")), ["", SITA.id, MINA.id]);
		assert.match(studioPage[0], / checked=""/);
		assert.match(formHtml(), /<span dir="auto">मीना गुरुङ<\/span>/);

		assert.deepEqual(radiosOf(formHtml(open({ artists: [SITA] })), "preferredArtistId"), []);
		assert.deepEqual(radiosOf(formHtml(open({ artists: [] })), "preferredArtistId"), []);

		const artistPage = radiosOf(formHtml(open({ preferredArtist: SITA, artists: [SITA] })), "preferredArtistId");
		assert.deepEqual(artistPage.map((tag) => attr(tag, "value")), ["", SITA.id]);
		assert.match(artistPage[1], / checked=""/);
		assert.doesNotMatch(artistPage[0], / checked/);
	});

	test("asks how they found the studio: six choices, none picked", () => {
		const html = formHtml();
		const radios = radiosOf(html, "sourceChannel");

		assert.deepEqual(radios.map((tag) => attr(tag, "value")), ["instagram", "facebook", "tiktok", "google", "friend", "other"]);
		for (const radio of radios) assert.doesNotMatch(radio, / checked/);
		assert.match(html, /How did you find <bdi>Black Needle<\/bdi>\?/);
		assert.match(html, /<span dir="auto">A friend<\/span>/);
		assert.match(html, /<span dir="auto">Somewhere else<\/span>/);
	});

	test("helps a phone fill in the contact fields", () => {
		const html = formHtml();
		const phone = control(html, "contactPhone");
		const email = control(html, "contactEmail");

		assert.deepEqual([attr(phone, "type"), attr(phone, "inputmode"), attr(phone, "autocomplete")], ["tel", "tel", "tel"]);
		assert.deepEqual([attr(email, "type"), attr(email, "inputmode"), attr(email, "autocomplete")], ["email", "email", "email"]);
		assert.equal(attr(control(html, "contactName"), "autocomplete"), "name");
		assert.match(html, /<bdi>Black Needle<\/bdi> replies here\. A Nepali number needs no \+977\./);
	});

	test("is safe markup: only allowed links, no style, no target, no script", () => {
		const html = formHtml();

		assert.doesNotMatch(html, / style=/);
		assert.doesNotMatch(html, / target=/);
		assert.doesNotMatch(html, /javascript:/i);
		assert.equal(count(html, /<script[\s>]/g), 0, "Turnstile never loads on the server");
		for (const href of hrefs(html)) assert.ok(isAllowedHref(href), href);
		for (const anchor of tags(html, "a")) {
			if (/ href="https?:/.test(anchor)) assert.match(anchor, / rel="noopener noreferrer"/, anchor);
		}
		assert.ok(hrefs(html).includes("https://www.cloudflare.com/turnstile-privacy-policy/"));
		assert.match(html, /Prefer to chat\?/);
		assert.ok(hrefs(html).includes(CHANNELS.whatsapp));
		assert.match(html, /<button type="submit" class="action action-primary">Send inquiry<\/button>/);
		assert.match(html, /Cloudflare sees your connection and device, not your answers\./);
	});

	test("keeps hostile names as text", () => {
		const html = formHtml(
			open({
				studioName: '<img src=x onerror="alert(1)">',
				artists: [SITA, { id: MINA.id, name: "</label><script>x</script>" }],
			}),
		);

		assert.doesNotMatch(html, /<img src=x/);
		assert.doesNotMatch(html, /<script/);
		assert.match(html, /&lt;img src=x/);
	});

	test("renders the same without a site key (development)", () => {
		assert.equal(formHtml(open(), null), formHtml(open(), SITE_KEY));
	});
});

describe("the photo tray", () => {
	const photo = (size: number) => new File([new Uint8Array(size)], "reference.jpg", { type: "image/jpeg" });
	const state: ReferencesState = {
		items: [
			{ id: "p1", name: "IMG_1.JPG", status: "ready", source: null, file: photo(300_000), error: null },
			{
				id: "p2",
				name: "IMG_2.JPG",
				status: "ready",
				source: null,
				file: photo(200_000),
				error: "This photo wasn't accepted: Upload a JPEG, PNG or WebP image. Remove it, then send again.",
			},
			{ id: "p3", name: "IMG_3.JPG", status: "queued", source: photo(9), file: null, error: null },
		],
		workingId: "p3",
		notices: [
			{ kind: "heic", name: "IMG_4.HEIC" },
			{ kind: "too-many", count: 2 },
		],
		error: null,
	};
	const tray = (value: ReferencesState) =>
		renderToStaticMarkup(
			createElement(ReferencePicker, {
				state: value,
				previews: new Map([
					["p1", "blob:http://x/1"],
					["p2", "blob:http://x/2"],
				]),
				studioName: "Black Needle",
				disabled: false,
				onPick: () => {},
				onRemove: () => {},
			}),
		);

	test("shows each photo by its place, with a named remove button and its problem", () => {
		const html = tray(state);

		assert.match(html, /<img src="blob:http:\/\/x\/1" alt="Reference photo 1" width="96" height="96"\/>/);
		assert.match(html, /<li class="photo photo-error">/);
		assert.match(html, />Preparing…</);
		for (const index of [1, 2, 3]) {
			assert.match(html, new RegExp(`<button type="button" class="photo-remove" aria-label="Remove reference photo ${index}"`));
		}
		assert.match(html, /3 of 5 photos, 0\.5 MB in total/);
	});

	test("says why photos weren't added, politely", () => {
		const html = tray(state);
		const messages = /<ul class="photo-messages" aria-live="polite">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";

		assert.match(messages, /IMG_4\.HEIC is a HEIC photo, which this browser can&#x27;t convert\./);
		assert.match(messages, /You can send up to 5 photos, so 2 weren&#x27;t added\./);
		assert.match(messages, /Reference photo 2: This photo wasn&#x27;t accepted: Upload a JPEG, PNG or WebP image\./);
	});

	test("at five photos the picker goes and says why", () => {
		const five: ReferencesState = {
			...state,
			workingId: null,
			notices: [],
			items: ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id, status: "ready" as const, source: null, file: photo(10), error: null })),
		};
		const html = tray(five);

		assert.equal(count(html, /type="file"/g), 0);
		assert.match(html, /That&#x27;s 5 photos, the most you can send\. Remove one to add another\./);
	});
});

describe("the success screen", () => {
	const html = render(
		createElement(IntakeSent, { studioName: "Black Needle", phone: "98-4100-0111", channels: CHANNELS }),
	);

	test("says the studio will reply on WhatsApp or Viber, at the number given, and promises no time", () => {
		assert.match(html, /<h3 class="intake-sent-title" tabindex="-1">Inquiry sent<\/h3>/i);
		assert.match(html, /<bdi>Black Needle<\/bdi> will reply on WhatsApp or Viber at <bdi>98-4100-0111<\/bdi>\./);
		assert.doesNotMatch(html, /within|hours|days|soon/i);
	});

	test("links back to the studio page and its chat, never with the person's details", () => {
		const links = hrefs(html);

		assert.ok(links.includes("/"));
		assert.ok(links.includes(CHANNELS.whatsapp));
		for (const href of links) {
			assert.ok(isAllowedHref(href), href);
			assert.ok(!href.includes("4100") && !href.includes("0111"), href);
		}
	});
});

describe("statusText", () => {
	test("says what is happening, and the size while sending", () => {
		assert.equal(statusText("idle", false, 0, 0), "");
		assert.equal(statusText("preparing", false, 2, 0), "Preparing your photos…");
		assert.equal(statusText("checking", false, 0, 0), "Running a quick security check…");
		assert.equal(statusText("interactive", false, 0, 0), "Tick the box above to send.");
		assert.equal(statusText("sending", false, 0, 0), "Sending your inquiry…");
		assert.equal(statusText("sending", false, 1, 400_000), "Sending your inquiry with 1 photo (0.4 MB)…");
		assert.equal(statusText("sending", false, 3, 2_202_009), "Sending your inquiry with 3 photos (2.1 MB)…");
		assert.equal(
			statusText("sending", true, 3, 2_202_009),
			"Still sending. On a slow connection this can take up to 2 minutes; keep this page open.",
		);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/render.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/intake/components/intake-form.tsx`.

- [ ] **Step 3: Write `fill.tsx`**

Create `apps/storefront/src/intake/components/fill.tsx`:

```tsx
import { createElement, Fragment } from "react";
import { fillParts } from "../copy.ts";

/**
 * A copy template with its values in <bdi> (names may be Nepali or
 * right-to-left, TAT-48 rule 12). The parts are passed as separate
 * children, so they need no keys.
 */
export function Fill({
	template,
	values,
}: {
	template: string;
	values: Readonly<Record<string, string | number>>;
}) {
	return createElement(
		Fragment,
		null,
		...fillParts(template, values).map((part) =>
			"text" in part ? part.text : createElement("bdi", null, part.value),
		),
	);
}
```

- [ ] **Step 4: Write `notices.tsx`**

Create `apps/storefront/src/intake/components/notices.tsx`:

```tsx
import type { ReactNode, Ref } from "react";
import type { InquiryChannels } from "../../studio/inquiry.ts";
import { linkRel } from "../../studio/links.ts";
import { copy, fill } from "../copy.ts";
import { noticeValues, type SubmitProblem } from "../problems.ts";
import { formatBytes } from "../references.ts";
import { Fill } from "./fill.tsx";

/** What the form is doing, for the status line under Send. */
export type FormPhase =
	| "idle"
	| "preparing"
	| "checking"
	| "interactive"
	| "sending";

export type NoticeProblem = Extract<SubmitProblem, { kind: "notice" }>;

/** One line of the error summary: the control it focuses, the field's name, the message. */
export interface SummaryItem {
	readonly target: string;
	readonly label: ReactNode;
	readonly message: string;
}

export function hasChannels(channels: InquiryChannels): boolean {
	return Boolean(channels.whatsapp || channels.email || channels.instagram);
}

/** The studio's chat links (TAT-48's InquiryChannels): the way on when the form can't help. */
export function ChatLinks({ channels }: { channels: InquiryChannels }) {
	const links: { href: string; label: string }[] = [];
	if (channels.whatsapp) {
		links.push({ href: channels.whatsapp, label: copy.chatLinks.whatsapp });
	}
	if (channels.email) {
		links.push({ href: channels.email, label: copy.chatLinks.email });
	}
	if (channels.instagram) {
		links.push({ href: channels.instagram, label: copy.chatLinks.instagram });
	}
	if (links.length === 0) return null;
	return (
		<span className="intake-chat-links">
			{links.map((link) => (
				<a
					key={link.href}
					className="text-link"
					href={link.href}
					rel={linkRel(link.href)}
				>
					{link.label}
				</a>
			))}
		</span>
	);
}

/** Every answer to fix, each linking to its control. Focused after a refused send. */
export function ErrorSummary({
	items,
	ref,
}: {
	items: readonly SummaryItem[];
	ref?: Ref<HTMLDivElement>;
}) {
	return (
		<div
			ref={ref}
			id="intake-summary"
			className="intake-alert"
			tabIndex={-1}
			aria-labelledby="intake-summary-title"
		>
			<p id="intake-summary-title" className="intake-alert-title">
				{items.length === 1
					? copy.errors.summaryOne
					: fill(copy.errors.summaryMany, { count: items.length })}
			</p>
			<ul>
				{items.map((item) => (
					<li key={item.target}>
						<a
							href={`#${item.target}`}
							onClick={(event) => focusControl(event, item.target)}
						>
							{item.label}: {item.message}
						</a>
					</li>
				))}
			</ul>
		</div>
	);
}

/** A summary link puts focus on its control, not just the scroll position. */
function focusControl(event: { preventDefault(): void }, id: string): void {
	const target = document.getElementById(id);
	if (!target) return;
	target.focus();
	if (document.activeElement === target) event.preventDefault();
}

/** A refusal the person can't fix in a field: what happened, and the way on. Focused when it appears. */
export function ProblemNotice({
	problem,
	studioName,
	channels,
	ref,
}: {
	problem: NoticeProblem;
	studioName: string;
	channels: InquiryChannels;
	ref?: Ref<HTMLDivElement>;
}) {
	const values = noticeValues(problem, studioName);
	const text = copy.notices[problem.code];
	return (
		<div
			ref={ref}
			id="intake-notice"
			className="intake-alert"
			tabIndex={-1}
			aria-labelledby="intake-notice-title"
		>
			<p id="intake-notice-title" className="intake-alert-title">
				<Fill template={text.title} values={values} />
			</p>
			<p>
				<Fill template={text.body} values={values} />
			</p>
			{problem.retry ? (
				<button type="submit" className="action action-secondary">
					{copy.sendAgain}
				</button>
			) : null}
			{problem.reload ? (
				<button
					type="button"
					className="action action-secondary"
					onClick={() => window.location.reload()}
				>
					{copy.reload}
				</button>
			) : null}
			{problem.contact && hasChannels(channels) ? (
				<ChatLinks channels={channels} />
			) : null}
		</div>
	);
}

/** The status line's words (spec ruling 7): no percentages, fetch can't report them. */
export function statusText(
	phase: FormPhase,
	slow: boolean,
	photoCount: number,
	bytes: number,
): string {
	switch (phase) {
		case "preparing":
			return copy.status.preparing;
		case "checking":
			return copy.status.checking;
		case "interactive":
			return copy.status.interactive;
		case "sending": {
			if (slow) return copy.status.stillSending;
			if (photoCount === 0) return copy.status.sending;
			const photos =
				photoCount === 1
					? copy.status.photoOne
					: fill(copy.status.photoMany, { count: photoCount });
			return fill(copy.status.sendingPhotos, {
				photos,
				size: formatBytes(bytes),
			});
		}
		case "idle":
			return "";
	}
}

export function SubmitStatus({
	phase,
	slow,
	photoCount,
	bytes,
}: {
	phase: FormPhase;
	slow: boolean;
	photoCount: number;
	bytes: number;
}) {
	return (
		<>
			{phase === "sending" ? (
				<div className="intake-progress" aria-hidden="true" />
			) : null}
			<p className="intake-status" aria-live="polite">
				{statusText(phase, slow, photoCount, bytes)}
			</p>
		</>
	);
}

/** What replaces the form once the inquiry is in (spec ruling 12). Its heading takes focus. */
export function IntakeSent({
	studioName,
	phone,
	channels,
	ref,
}: {
	studioName: string;
	phone: string;
	channels: InquiryChannels;
	ref?: Ref<HTMLHeadingElement>;
}) {
	return (
		<div className="intake-sent">
			<h3 ref={ref} className="intake-sent-title" tabIndex={-1}>
				{copy.sent.title}
			</h3>
			<p>
				<Fill template={copy.sent.body} values={{ studio: studioName, phone }} />
			</p>
			{hasChannels(channels) ? (
				<p>
					{copy.sent.more} <ChatLinks channels={channels} />
				</p>
			) : null}
			<a className="text-link" href="/">
				{copy.sent.back}
			</a>
		</div>
	);
}
```

- [ ] **Step 5: Write `reference-picker.tsx`**

Create `apps/storefront/src/intake/components/reference-picker.tsx`:

```tsx
import { ImagePlus, X } from "lucide-react";
import { copy, fill } from "../copy.ts";
import { ACCEPT, MAX_REFERENCES } from "../images.ts";
import {
	canAdd,
	formatBytes,
	type PhotoNotice,
	type ReferencesState,
	totalBytes,
} from "../references.ts";
import { Fill } from "./fill.tsx";

export interface ReferencePickerProps {
	readonly state: ReferencesState;
	/** Preview URLs by photo id; the form makes and revokes them. */
	readonly previews: ReadonlyMap<string, string>;
	readonly studioName: string;
	/** While a send runs. */
	readonly disabled: boolean;
	onPick(files: File[]): void;
	onRemove(id: string): void;
}

/** Why photos weren't added, and what the API said about sent ones. */
export function photoMessages(state: ReferencesState): string[] {
	const messages = state.notices.map(noticeMessage);
	for (const [index, item] of state.items.entries()) {
		if (item.error) {
			messages.push(
				fill(copy.photos.itemError, { index: index + 1, message: item.error }),
			);
		}
	}
	if (state.error) messages.push(state.error);
	return [...new Set(messages)];
}

function noticeMessage(notice: PhotoNotice): string {
	if (notice.kind === "too-many") {
		return fill(
			notice.count === 1 ? copy.photos.tooManyOne : copy.photos.tooMany,
			{ max: MAX_REFERENCES, count: notice.count },
		);
	}
	return fill(copy.photos.problems[notice.kind], { name: notice.name });
}

/** Up to five reference photos: previews, remove buttons, and the picker while there is room. */
export function ReferencePicker({
	state,
	previews,
	studioName,
	disabled,
	onPick,
	onRemove,
}: ReferencePickerProps) {
	const count = state.items.length;
	const messages = photoMessages(state);
	return (
		<fieldset
			id="references"
			className="intake-photos"
			aria-describedby="references-hint"
		>
			<legend className="intake-label">{copy.photos.legend}</legend>
			<p id="references-hint" className="intake-note">
				<Fill
					template={copy.photos.hint}
					values={{ max: MAX_REFERENCES, studio: studioName }}
				/>
			</p>
			<ul className="photo-tray">
				{state.items.map((item, index) => {
					const preview = previews.get(item.id);
					return (
						<li key={item.id} className={item.error ? "photo photo-error" : "photo"}>
							{preview ? (
								<img
									src={preview}
									alt={fill(copy.photos.alt, { index: index + 1 })}
									width={96}
									height={96}
								/>
							) : (
								<span className="photo-pending">{copy.photos.preparing}</span>
							)}
							<button
								type="button"
								className="photo-remove"
								aria-label={fill(copy.photos.remove, { index: index + 1 })}
								disabled={disabled}
								onClick={() => onRemove(item.id)}
							>
								<X aria-hidden="true" className="size-5" />
							</button>
						</li>
					);
				})}
				{canAdd(state) ? (
					<li>
						<label className="photo-add">
							<input
								id="references-input"
								className="sr-only"
								type="file"
								accept={ACCEPT}
								multiple
								disabled={disabled}
								onChange={(event) => {
									const input = event.currentTarget;
									const files = Array.from(input.files ?? []);
									input.value = "";
									if (files.length > 0) onPick(files);
								}}
							/>
							<ImagePlus aria-hidden="true" className="size-6" />
							<span>{copy.photos.add}</span>
						</label>
					</li>
				) : null}
			</ul>
			{count > 0 ? (
				<p className="intake-note">
					{count >= MAX_REFERENCES
						? fill(copy.photos.full, { max: MAX_REFERENCES })
						: fill(copy.photos.count, {
								count,
								max: MAX_REFERENCES,
								size: formatBytes(totalBytes(state)),
							})}
				</p>
			) : null}
			<ul className="photo-messages" aria-live="polite">
				{messages.map((message) => (
					<li key={message}>{message}</li>
				))}
			</ul>
		</fieldset>
	);
}
```

- [ ] **Step 6: Write `intake-form.tsx`**

Create `apps/storefront/src/intake/components/intake-form.tsx`:

```tsx
import { type AnyFieldApi, revalidateLogic } from "@tanstack/react-form";
import { useCreateInquiry } from "@tattoo-drip/react";
import {
	type CreateInquiryInput,
	INQUIRY_HONEYPOT_FIELD,
	type InquiryReceipt,
} from "@tattoo-drip/sdk";
import { useEffect, useReducer, useRef, useState } from "react";
import { useAppForm } from "../../components/ui/form.tsx";
import type { InquiryChannels, InquiryState } from "../../studio/inquiry.ts";
import { browserCodec } from "../browser-codec.ts";
import { Challenge, TURNSTILE_PRIVACY_URL } from "../challenge.ts";
import { browserChallengeHost } from "../challenge-host.ts";
import { copy } from "../copy.ts";
import { prepareReference } from "../images.ts";
import { describeChallengeFailure, describeSubmitError } from "../problems.ts";
import {
	canAdd,
	EMPTY_REFERENCES,
	hasPhotoErrors,
	isPreparing,
	nextToPrepare,
	type ReferencesState,
	readyItems,
	referencesReducer,
	syncPreviews,
	totalBytes,
} from "../references.ts";
import {
	FIELD_ORDER,
	INTAKE_LIMITS,
	type IntakeField,
	type IntakeValues,
	initialValues,
	SOURCE_CHANNELS,
	validateIntake,
} from "../rules.ts";
import { toInquiryInput } from "../submission.ts";
import { createSubmitter } from "../submit-flow.ts";
import { Fill } from "./fill.tsx";
import {
	ChatLinks,
	ErrorSummary,
	type FormPhase,
	hasChannels,
	IntakeSent,
	type NoticeProblem,
	ProblemNotice,
	SubmitStatus,
	type SummaryItem,
} from "./notices.tsx";
import { ReferencePicker } from "./reference-picker.tsx";

export interface IntakeFormProps {
	/** TAT-48's open state: the studio, the artist asked for, the artists who take inquiries. */
	readonly state: Extract<InquiryState, { kind: "open" }>;
	/** The studio's chat links, for "Prefer to chat?" and refusals the form can't fix. */
	readonly channels: InquiryChannels;
	/** The public Turnstile site key, or null in development (no check, no token). */
	readonly challengeSiteKey: string | null;
}

/** After this long sending, the status line says a slow connection can take 2 minutes. */
export const SLOW_AFTER_MS = 15_000;
/** Radio fields: a summary link focuses their first radio. */
const CHOICE_FIELDS = new Set<IntakeField>(["preferredArtistId", "sourceChannel"]);
const BROWSER_URLS = {
	create: (file: File) => URL.createObjectURL(file),
	revoke: (url: string) => URL.revokeObjectURL(url),
};

/**
 * The intake form (TAT-57): TAT-51's inquiry, sent from the browser with
 * useCreateInquiry(), photos shrunk first (images.ts), a Turnstile token per
 * attempt (challenge.ts) and TAT-55's honeypot. Mounted by IntakeMount only
 * after hydration. Every outcome but success keeps what the person entered.
 */
export function IntakeForm({ state, channels, challengeSiteKey }: IntakeFormProps) {
	const { studioName, preferredArtist, artists } = state;
	const showArtists = artists.length >= 2 || preferredArtist !== null;
	const createInquiry = useCreateInquiry();

	const [references, dispatch] = useReducer(referencesReducer, EMPTY_REFERENCES);
	const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(
		() => new Map(),
	);
	const [phase, setPhase] = useState<FormPhase>("idle");
	const [slow, setSlow] = useState(false);
	const [notice, setNotice] = useState<NoticeProblem | null>(null);
	const [showSummary, setShowSummary] = useState(false);
	const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [focus, setFocus] = useState<"summary" | "notice" | "sent" | null>(null);

	const honeypot = useRef<HTMLInputElement>(null);
	const challengeBox = useRef<HTMLDivElement>(null);
	const summaryRef = useRef<HTMLDivElement>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const sentRef = useRef<HTMLHeadingElement>(null);
	const latest = useRef<ReferencesState>(EMPTY_REFERENCES);
	const previewUrls = useRef<ReadonlyMap<string, string>>(new Map());
	const photoWaiters = useRef<Array<() => void>>([]);
	const inFlight = useRef(false);
	const nextPhotoId = useRef(0);
	const sendRef = useRef<(input: CreateInquiryInput) => Promise<InquiryReceipt>>(
		createInquiry.mutateAsync,
	);

	const [challenge] = useState(() =>
		challengeSiteKey
			? new Challenge(challengeSiteKey, browserChallengeHost(), (interactive) =>
					setPhase((current) =>
						current === "checking" || current === "interactive"
							? interactive
								? "interactive"
								: "checking"
							: current,
					),
				)
			: null,
	);
	const [submit] = useState(() =>
		createSubmitter({
			challenge,
			send: (input) => sendRef.current(input),
			onPhase: setPhase,
		}),
	);

	const form = useAppForm({
		defaultValues: initialValues(preferredArtist?.id ?? null),
		validationLogic: revalidateLogic({
			mode: "submit",
			modeAfterSubmission: "change",
		}),
		validators: {
			onDynamic: ({ value }: { value: IntakeValues }) => {
				const fields = validateIntake(value, {
					studioName,
					artistIds: artists.map((artist) => artist.id),
				});
				return Object.keys(fields).length > 0 ? { fields } : undefined;
			},
		},
		listeners: {
			onChange: ({ fieldApi }) => clearServerError(fieldApi),
		},
		onSubmit: ({ value }) => send(value),
		onSubmitInvalid: () => {
			setShowSummary(true);
			setFocus("summary");
		},
	});

	async function send(values: IntakeValues): Promise<void> {
		if (inFlight.current) return;
		if (blockedUntil !== null && Date.now() < blockedUntil) return;
		inFlight.current = true;
		try {
			setNotice(null);
			setShowSummary(false);
			if (hasPhotoErrors(latest.current)) {
				setShowSummary(true);
				setFocus("summary");
				return;
			}
			if (isPreparing(latest.current)) {
				setPhase("preparing");
				await new Promise<void>((done) => photoWaiters.current.push(done));
			}
			const sent = readyItems(latest.current);
			const result = await submit(
				toInquiryInput(
					values,
					sent.map((item) => item.file),
					honeypot.current?.value ?? "",
				),
			);
			if (result.kind === "busy") return;
			if (result.kind === "sent") {
				setSentTo(values.contactPhone.trim());
				form.reset();
				dispatch({ type: "cleared" });
				setFocus("sent");
				return;
			}
			const problem =
				result.kind === "challenge"
					? describeChallengeFailure(result.reason)
					: describeSubmitError(result.error, {
							sentArtistId: values.preferredArtistId || null,
							artistName: (id) =>
								artists.find((artist) => artist.id === id)?.name ?? null,
						});
			if (problem.kind === "fields") {
				for (const [name, message] of Object.entries(problem.fields)) {
					form.setFieldMeta(name as IntakeField, (meta) => ({
						...meta,
						isTouched: true,
						errorMap: { ...meta.errorMap, onServer: message },
					}));
				}
				dispatch({
					type: "rejected",
					sentIds: sent.map((item) => item.id),
					byIndex: problem.photos,
					error: problem.photosError,
				});
				setShowSummary(true);
				setFocus("summary");
				return;
			}
			if (problem.waitSeconds !== null) {
				setBlockedUntil(Date.now() + problem.waitSeconds * 1000);
			}
			setNotice(problem);
			setFocus("notice");
		} finally {
			setPhase("idle");
			inFlight.current = false;
		}
	}

	// The latest photos for the async work, and a send waiting for them woken.
	useEffect(() => {
		latest.current = references;
		if (!isPreparing(references)) {
			for (const done of photoWaiters.current.splice(0)) done();
		}
	}, [references]);

	// Prepare queued photos one at a time (spec ruling 5).
	useEffect(() => {
		const next = nextToPrepare(references);
		if (!next?.source) return;
		const { id, source } = next;
		dispatch({ type: "started", id });
		void prepareReference(source, browserCodec).then((result) =>
			dispatch(
				result.ok
					? { type: "prepared", id, file: result.file }
					: { type: "refused", id, problem: result.problem },
			),
		);
	}, [references]);

	// One preview URL per ready photo, revoked when the photo goes.
	useEffect(() => {
		previewUrls.current = syncPreviews(previewUrls.current, references, BROWSER_URLS);
		setPreviews(previewUrls.current);
	}, [references]);

	useEffect(
		() => () => {
			for (const url of previewUrls.current.values()) URL.revokeObjectURL(url);
			previewUrls.current = new Map();
		},
		[],
	);

	useEffect(() => {
		sendRef.current = createInquiry.mutateAsync;
	}, [createInquiry.mutateAsync]);

	useEffect(() => {
		challenge?.attach(challengeBox.current);
		return () => challenge?.dispose();
	}, [challenge]);

	useEffect(() => {
		if (focus === null) return;
		const target =
			focus === "summary"
				? summaryRef.current
				: focus === "notice"
					? noticeRef.current
					: sentRef.current;
		target?.focus();
		setFocus(null);
	}, [focus]);

	useEffect(() => {
		if (phase !== "sending") {
			setSlow(false);
			return;
		}
		const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
		return () => window.clearTimeout(timer);
	}, [phase]);

	// Leaving while an inquiry is on its way asks first (spec ruling 7).
	useEffect(() => {
		if (phase === "idle" || phase === "preparing") return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [phase]);

	useEffect(() => {
		if (blockedUntil === null) return;
		const timer = window.setTimeout(
			() => setBlockedUntil(null),
			Math.max(0, blockedUntil - Date.now()),
		);
		return () => window.clearTimeout(timer);
	}, [blockedUntil]);

	if (sentTo !== null) {
		return (
			<IntakeSent
				ref={sentRef}
				studioName={studioName}
				phone={sentTo}
				channels={channels}
			/>
		);
	}

	const busy = phase !== "idle";
	const blocked = blockedUntil !== null;
	const warm = () => challenge?.preload();

	return (
		<form
			className="intake"
			method="post"
			noValidate
			aria-labelledby="inquiry-title"
			onFocusCapture={warm}
			onPointerDownCapture={warm}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (!busy && !blocked) void form.handleSubmit();
			}}
		>
			<p className="intake-note">{copy.required}</p>
			<p className="intake-note">
				<Fill template={copy.privacy} values={{ studio: studioName }} />{" "}
				<a href={TURNSTILE_PRIVACY_URL} rel="noopener noreferrer">
					{copy.privacyLink}
				</a>
			</p>

			<form.Subscribe selector={(formState) => formState.fieldMeta}>
				{(fieldMeta) => {
					const items = summaryItems(fieldMeta, references, studioName);
					return showSummary && items.length > 0 ? (
						<ErrorSummary ref={summaryRef} items={items} />
					) : null;
				}}
			</form.Subscribe>
			{notice ? (
				<ProblemNotice
					ref={noticeRef}
					problem={notice}
					studioName={studioName}
					channels={channels}
				/>
			) : null}

			<fieldset className="intake-group">
				<legend className="intake-legend">{copy.tattooLegend}</legend>
				<form.AppField name="idea">
					{(field) => (
						<field.TextareaField
							label={copy.fields.idea.label}
							description={copy.fields.idea.hint}
							rows={5}
							required
							aria-required="true"
						/>
					)}
				</form.AppField>
				<ReferencePicker
					state={references}
					previews={previews}
					studioName={studioName}
					disabled={busy}
					onPick={(files) =>
						dispatch({
							type: "picked",
							files: files.map((file) => ({
								id: `photo-${nextPhotoId.current++}`,
								file,
							})),
						})
					}
					onRemove={(id) => dispatch({ type: "removed", id })}
				/>
				<div className="intake-pair">
					<form.AppField name="placement">
						{(field) => (
							<field.TextField
								label={copy.fields.placement.label}
								description={copy.fields.placement.hint}
								maxLength={INTAKE_LIMITS.placement}
								required
								aria-required="true"
							/>
						)}
					</form.AppField>
					<form.AppField name="approximateSize">
						{(field) => (
							<field.TextField
								label={copy.fields.approximateSize.label}
								description={copy.fields.approximateSize.hint}
								maxLength={INTAKE_LIMITS.approximateSize}
								required
								aria-required="true"
							/>
						)}
					</form.AppField>
				</div>
				<form.AppField name="preferredDates">
					{(field) => (
						<field.TextField
							label={copy.fields.preferredDates.label}
							description={copy.fields.preferredDates.hint}
							maxLength={INTAKE_LIMITS.preferredDates}
							required
							aria-required="true"
						/>
					)}
				</form.AppField>
				{showArtists ? (
					<form.AppField name="preferredArtistId">
						{(field) => (
							<field.ChoiceField
								legend={copy.fields.preferredArtistId.label}
								options={[
									{ value: "", label: copy.noPreference },
									...artists.map((artist) => ({
										value: artist.id,
										label: artist.name,
									})),
								]}
							/>
						)}
					</form.AppField>
				) : null}
				<form.AppField name="budget">
					{(field) => (
						<field.TextField
							label={copy.fields.budget.label}
							description={copy.fields.budget.hint}
							maxLength={INTAKE_LIMITS.budget}
						/>
					)}
				</form.AppField>
				<form.AppField name="sourceChannel">
					{(field) => (
						<field.ChoiceField
							legend={
								<Fill
									template={copy.fields.sourceChannel.label}
									values={{ studio: studioName }}
								/>
							}
							options={SOURCE_CHANNELS.map((channel) => ({
								value: channel,
								label: copy.channels[channel],
							}))}
							required
						/>
					)}
				</form.AppField>
			</fieldset>

			<fieldset className="intake-group">
				<legend className="intake-legend">
					<Fill template={copy.contactLegend} values={{ studio: studioName }} />
				</legend>
				<form.AppField name="contactName">
					{(field) => (
						<field.TextField
							label={copy.fields.contactName.label}
							autoComplete="name"
							maxLength={INTAKE_LIMITS.contactName}
							required
							aria-required="true"
						/>
					)}
				</form.AppField>
				<form.AppField name="contactPhone">
					{(field) => (
						<field.TextField
							label={copy.fields.contactPhone.label}
							description={
								<Fill
									template={copy.fields.contactPhone.hint ?? ""}
									values={{ studio: studioName }}
								/>
							}
							type="tel"
							inputMode="tel"
							autoComplete="tel"
							maxLength={INTAKE_LIMITS.contactPhone}
							required
							aria-required="true"
						/>
					)}
				</form.AppField>
				<form.AppField name="contactEmail">
					{(field) => (
						<field.TextField
							label={copy.fields.contactEmail.label}
							type="email"
							inputMode="email"
							autoComplete="email"
							maxLength={INTAKE_LIMITS.contactEmail}
						/>
					)}
				</form.AppField>
			</fieldset>

			{/* TAT-55's honeypot: off-screen (not display: none), never filled by the form. */}
			<div className="intake-trap" aria-hidden="true">
				<label htmlFor="intake-website">{copy.honeypot}</label>
				<input
					ref={honeypot}
					id="intake-website"
					type="text"
					name={INQUIRY_HONEYPOT_FIELD}
					tabIndex={-1}
					autoComplete="off"
					defaultValue=""
				/>
			</div>

			<div ref={challengeBox} className="intake-challenge" />

			<div className="intake-submit">
				<button
					type="submit"
					className="action action-primary"
					aria-disabled={busy || blocked ? true : undefined}
				>
					{busy ? copy.sending : copy.send}
				</button>
				<SubmitStatus
					phase={phase}
					slow={slow}
					photoCount={readyItems(references).length}
					bytes={totalBytes(references)}
				/>
			</div>
			{hasChannels(channels) ? (
				<p className="intake-chat">
					{copy.chat} <ChatLinks channels={channels} />
				</p>
			) : null}
		</form>
	);
}

/** A field's API error goes as soon as the person changes that field. */
function clearServerError(field: AnyFieldApi): void {
	if (field.state.meta.errorMap.onServer === undefined) return;
	field.setMeta((meta) => ({
		...meta,
		errorMap: { ...meta.errorMap, onServer: undefined },
	}));
}

type FieldMetaMap = Readonly<
	Record<string, { readonly errors?: readonly unknown[] } | undefined>
>;

/** Each field's first error, in the form's order, then the photos' (after the idea). */
function summaryItems(
	fieldMeta: FieldMetaMap,
	references: ReferencesState,
	studioName: string,
): SummaryItem[] {
	const items: SummaryItem[] = [];
	for (const field of FIELD_ORDER) {
		const message = firstMessage(fieldMeta[field]?.errors);
		if (message) {
			items.push({
				target: CHOICE_FIELDS.has(field) ? `${field}-0` : field,
				label: (
					<Fill
						template={copy.fields[field].label}
						values={{ studio: studioName }}
					/>
				),
				message,
			});
		}
		if (field === "idea" && hasPhotoErrors(references)) {
			items.push({
				target: canAdd(references) ? "references-input" : "references",
				label: copy.photos.legend,
				message: references.error ?? copy.photos.fixPhotos,
			});
		}
	}
	return items;
}

function firstMessage(errors: readonly unknown[] | undefined): string | undefined {
	for (const error of errors ?? []) {
		if (typeof error === "string" && error) return error;
		if (
			typeof error === "object" &&
			error !== null &&
			"message" in error &&
			typeof error.message === "string" &&
			error.message
		) {
			return error.message;
		}
	}
	return undefined;
}
```

- [ ] **Step 7: Write `intake-mount.tsx`**

Create `apps/storefront/src/intake/components/intake-mount.tsx`:

```tsx
import {
	Component,
	lazy,
	type ReactNode,
	Suspense,
	useSyncExternalStore,
} from "react";
import type { IntakeFormProps } from "./intake-form.tsx";

/*
 * Where the intake form goes (TAT-57, spec ruling 2): only in the browser,
 * after hydration, from its own chunk. On the server, before hydration,
 * without JavaScript, or if the chunk fails to load, `fallback` (TAT-48's
 * chat links) shows instead, so nobody types into a form React doesn't
 * own yet, and the page's first load stays light.
 */

const LazyIntakeForm = lazy(() =>
	import("./intake-form.tsx").then((module) => ({
		default: module.IntakeForm,
	})),
);

const subscribe = () => () => {};

/** False on the server and while hydrating, true after. */
function useHydrated(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	);
}

export function IntakeMount({
	fallback,
	...props
}: IntakeFormProps & { fallback: ReactNode }) {
	const hydrated = useHydrated();
	if (!hydrated) return fallback;
	return (
		<FallbackOnError fallback={fallback}>
			<Suspense fallback={fallback}>
				<LazyIntakeForm {...props} />
			</Suspense>
		</FallbackOnError>
	);
}

/** A chunk that can't load (a dropped connection) leaves the chat links, not a broken page. */
class FallbackOnError extends Component<
	{ fallback: ReactNode; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
```

- [ ] **Step 8: Run the tests, typecheck and lint**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/render.test.ts`
Expected: PASS. If a markup assertion fails, read the rendered HTML (print it in a scratch run) and fix the component, not the test, unless the difference is only React's spelling of an attribute name (then add the `i` flag to that one pattern).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS. Likely spots if not: (a) the `onDynamic` validator's return type: TanStack Form 1.x takes `{ fields }` from a form validator; if its types want `{ form?: string; fields: … }`, return that exact shape (no `any`); (b) `formState.fieldMeta` not assignable to `FieldMetaMap`: type the parameter as `Record<string, { errors?: readonly unknown[] } | undefined>` with a `Partial` or widen through `Object.entries`, never `any`; (c) `event.returnValue` marked deprecated is fine to keep (older Chrome needs it).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm exec biome check apps/storefront/src/intake apps/storefront/test/intake apps/storefront/test/ui apps/storefront/src/components/ui/form.tsx`
Expected: no errors. If `useExhaustiveDependencies` reports a dependency, add it only if the effect really reads it; refs and state setters are stable. If `noNonInteractiveTabindex` objects to `tabIndex={-1}` on the summary, notice or heading, keep `-1` (programmatic focus only) and add a `biome-ignore` comment naming that reason.

- [ ] **Step 9: Commit**

```bash
git add apps/storefront/src/intake/components apps/storefront/test/intake/render.test.ts
git commit -m "feat(storefront): the intake form, its photo tray, notices and success screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Mount the form in the `#inquiry` section; the prototype goes

**Files:**
- Modify: `apps/storefront/src/studio/components/inquiry.tsx`
- Modify: `apps/storefront/src/studio/components/pages.tsx`
- Modify: `apps/storefront/src/routes/index.tsx`, `apps/storefront/src/routes/artists/$slug.tsx`
- Delete: `apps/storefront/src/features/` (TAT-48's unmounted `intake/booking-form.tsx` and `intake/booking-schema.ts`)
- Modify: `apps/storefront/test/studio/prototype-removed.test.ts`
- Test: `apps/storefront/test/intake/section.test.ts`

**Interfaces:**
- Consumes: `IntakeMount` (Task 11); `SiteRef.challengeSiteKey` in the router context (Task 9); TAT-48's `InquirySection`, `InquiryFallback`, `StudioPage`, `ArtistPage`.
- Produces: `InquirySection({ state, channels, challengeSiteKey? })`, `StudioPage({ data, challengeSiteKey? })`, `ArtistPage({ data, challengeSiteKey? })` (`challengeSiteKey` defaults to `null`, so TAT-48's render tests keep calling them with `{ data }`).

- [ ] **Step 1: Write the failing tests**

Create `apps/storefront/test/intake/section.test.ts`:

```ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InquiryState } from "../../src/studio/inquiry.ts";
import { InquirySection } from "../../src/studio/components/inquiry.tsx";

const SITE_KEY = "1x00000000000000000000AA";
const CHANNELS = {
	whatsapp: "https://wa.me/9779812345678?text=Hi",
	email: "mailto:hello@black-needle.example?subject=Tattoo%20inquiry",
	instagram: null,
};
const OPEN: InquiryState = {
	kind: "open",
	studioName: "Black Needle",
	preferredArtist: null,
	artists: [{ id: "0199f000-0000-7000-8000-000000000048", name: "Sita Rai" }],
};

const section = (state: InquiryState) =>
	renderToStaticMarkup(
		createElement(InquirySection, { state, channels: CHANNELS, challengeSiteKey: SITE_KEY }),
	);

describe("the #inquiry section on the server", () => {
	test("renders TAT-48's chat links, never the form (it mounts after hydration)", () => {
		const html = section(OPEN);

		assert.equal((html.match(/<form[\s>]/g) ?? []).length, 0);
		assert.match(html, /Message on WhatsApp/);
		assert.match(html, /<h2 id="inquiry-title"/);
		assert.doesNotMatch(html, /challenges\.cloudflare\.com|1x00000000000000000000AA/);
	});

	test("keeps the closed states as TAT-48 left them", () => {
		const closed = section({ kind: "studio-closed", studioName: "Black Needle" });
		assert.match(closed, /<bdi>Black Needle<\/bdi> isn&#x27;t taking new inquiries right now\./);
		assert.doesNotMatch(closed, /<form|Message on WhatsApp/);

		const artist = section({ kind: "artist-closed", studioName: "Black Needle", artistName: "Sita Rai", studioOpen: true });
		assert.match(artist, /<bdi>Sita Rai<\/bdi> isn&#x27;t taking new inquiries right/);
		assert.match(artist, /href="\/#inquiry"/);
		assert.doesNotMatch(artist, /<form/);
	});
});

describe("the intake code", () => {
	const DIR = new URL("../../src/intake/", import.meta.url);
	const files = readdirSync(DIR, { recursive: true })
		.map(String)
		.filter((file) => /\.(ts|tsx)$/.test(file));
	const read = (file: string) => readFileSync(new URL(file, DIR), "utf8");

	test("keeps nothing in the browser, tracks nothing, renders no raw HTML", () => {
		for (const file of files) {
			const text = read(file);
			for (const banned of [
				"localStorage",
				"sessionStorage",
				"indexedDB",
				"document.cookie",
				"sendBeacon",
				"dangerouslySetInnerHTML",
				"style={",
				"target=",
				"posthog",
				"gtag",
			]) {
				assert.ok(!text.includes(banned), `${file}: ${banned}`);
			}
		}
	});

	test("its pure modules touch no DOM and no React", () => {
		for (const file of ["copy.ts", "rules.ts", "images.ts", "references.ts", "submission.ts", "problems.ts", "challenge.ts", "submit-flow.ts"]) {
			assert.doesNotMatch(read(file), /from "react"|@tanstack\/react|\bdocument\.|\bwindow\./, file);
		}
	});

	test("never names a setting the browser must not see", () => {
		for (const file of files) {
			assert.doesNotMatch(read(file), /TURNSTILE_(SITE|SECRET)_KEY|process\.env/, file);
		}
	});
});
```

In `apps/storefront/test/studio/prototype-removed.test.ts`:
- in the test `"the prototype's mock data, pages and images are gone"`, add `assert.ok(!existsSync(new URL("features", SRC)), "src/features");`
- in the test `"nothing refers to the mock data, the prototype pages or PostHog"`, add `"features/"` and `"booking-form"` to the banned list;
- replace the test `"the prototype's booking form waits, unmounted, for the intake form"` with:

```ts
test("the intake form replaced the prototype's booking form", () => {
	assert.ok(existsSync(new URL("intake/components/intake-form.tsx", SRC)));
	const section = readFileSync(new URL("studio/components/inquiry.tsx", SRC), "utf8");
	assert.match(section, /<IntakeMount\b/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront exec node --import tsx --test test/intake/section.test.ts test/studio/prototype-removed.test.ts`
Expected: FAIL: `src/features` exists and `inquiry.tsx` doesn't mount `IntakeMount` (the section tests themselves may already pass: the fallback is the server render either way).

- [ ] **Step 3: Mount the form in `inquiry.tsx`**

In `apps/storefront/src/studio/components/inquiry.tsx`:

(a) add the import:

```tsx
import { IntakeMount } from "../../intake/components/intake-mount.tsx";
```

(b) replace the component's doc comment and signature

```tsx
/**
 * The #inquiry section (TAT-48): the intake form's mount point. TAT-57
 * renders its form in place of <InquiryFallback> (the `open` branch), with
 * `state.preferredArtist` pre-selected and only `state.artists` to choose
 * from, and keeps the closed branches as they are.
 */
export function InquirySection({
	state,
	channels,
}: {
	state: InquiryState;
	channels: InquiryChannels;
}) {
```

with

```tsx
/**
 * The #inquiry section (TAT-48): open, it holds the intake form (TAT-57),
 * which mounts in the browser after hydration; on the server and until then,
 * and without JavaScript, <InquiryFallback>'s chat links show. Closed, it
 * says so.
 */
export function InquirySection({
	state,
	channels,
	challengeSiteKey = null,
}: {
	state: InquiryState;
	channels: InquiryChannels;
	/** The public Turnstile site key (null: no bot check, development). */
	challengeSiteKey?: string | null;
}) {
```

(c) replace the open branch

```tsx
				{state.kind === "open" ? (
					<InquiryFallback state={state} channels={channels} />
				) : null}
```

with

```tsx
				{state.kind === "open" ? (
					<IntakeMount
						state={state}
						channels={channels}
						challengeSiteKey={challengeSiteKey}
						fallback={<InquiryFallback state={state} channels={channels} />}
					/>
				) : null}
```

(d) replace `InquiryFallback`'s doc comment ("Until TAT-57's form: …") with:

```tsx
/**
 * The open section on the server, before hydration and without JavaScript:
 * the inquiry goes by WhatsApp or email with a prefilled message, else by
 * Instagram. The intake form replaces it in the browser.
 */
```

- [ ] **Step 4: Pass the key through the pages and routes**

In `apps/storefront/src/studio/components/pages.tsx`:
- replace `export function StudioPage({ data }: { data: StudioPageData }) {` with

```tsx
export function StudioPage({
	data,
	challengeSiteKey = null,
}: {
	data: StudioPageData;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
}) {
```

- replace `export function ArtistPage({ data }: { data: ArtistPageData }) {` with

```tsx
export function ArtistPage({
	data,
	challengeSiteKey = null,
}: {
	data: ArtistPageData;
	/** The intake form's public Turnstile site key (TAT-57). */
	challengeSiteKey?: string | null;
}) {
```

- in both, replace `<InquirySection state={inquiry} channels={channels} />` with

```tsx
<InquirySection
	state={inquiry}
	channels={channels}
	challengeSiteKey={challengeSiteKey}
/>
```

In `apps/storefront/src/routes/index.tsx`, replace `StudioRoute` with:

```tsx
function StudioRoute() {
	const challengeSiteKey = Route.useRouteContext({
		select: (context) => context.site.challengeSiteKey,
	});
	return (
		<StudioPage
			data={Route.useLoaderData()}
			challengeSiteKey={challengeSiteKey}
		/>
	);
}
```

In `apps/storefront/src/routes/artists/$slug.tsx`, replace `ArtistRoute` with:

```tsx
function ArtistRoute() {
	const challengeSiteKey = Route.useRouteContext({
		select: (context) => context.site.challengeSiteKey,
	});
	return (
		<ArtistPage
			data={Route.useLoaderData()}
			challengeSiteKey={challengeSiteKey}
		/>
	);
}
```

(The router context type already holds `site: SiteRef`: TAT-48's root route is `createRootRouteWithContext<ApiContext & SiteContext>()`.)

- [ ] **Step 5: Delete the prototype booking form**

```bash
git rm -r apps/storefront/src/features
ls apps/storefront/src/features 2>/dev/null; echo "exit $?"
rg -n "booking-form|booking-schema|features/" apps/storefront/src; echo "exit $?"
```

Expected: `exit 2` (the folder is gone), then `exit 1` (nothing refers to it).

- [ ] **Step 6: Run everything**

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront test`
Expected: PASS, `# fail 0` (TAT-48's `render.test.ts` included: the section still server-renders its fallback).

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront typecheck`
Expected: PASS. If `Route.useRouteContext({ select })` doesn't see `site`, check `src/routes/__root.tsx`'s `createRootRouteWithContext<ApiContext & SiteContext>()` (TAT-48) and report rather than casting.

Run: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront build`
Expected: succeeds with the bundle check; `git status --short apps/storefront/src/routeTree.gen.ts` prints nothing (no route was added or removed).

Run: `rg -l "Send inquiry" apps/storefront/.output/public/assets` and `rg -l "challenges.cloudflare.com" apps/storefront/.output/public/assets`
Expected: each prints exactly one file, the same one (the form's own chunk, loaded after hydration), and neither is the chunk that holds TAT-48's "Studio page by Tattoo Drip". If the form's text is in the same file as the footer's, the lazy import didn't split: check that nothing imports `intake-form.tsx` statically except tests and report.

- [ ] **Step 7: Commit**

```bash
git add apps/storefront/src/studio/components apps/storefront/src/routes apps/storefront/test/intake/section.test.ts apps/storefront/test/studio/prototype-removed.test.ts
git commit -m "feat(storefront): the intake form fills the studio page's inquiry section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(The `git rm` from Step 5 is already staged.)

---

### Task 13: Docs

**Files:**
- Modify: `apps/storefront/docs/development.md`, `apps/storefront/AGENTS.md`, `apps/storefront/README.md`
- Modify: `README.md`, `docs/sdk.md`, `docs/architecture.md`, `docs/requirements.md`, `docs/README.md`

Edit by content: TAT-48 and TAT-55 moved and added lines. Biome doesn't check Markdown: re-read each edit and check its links.

- [ ] **Step 1: Storefront development guide**

In `apps/storefront/docs/development.md`:

(a) Replace the whole "## Forms" section's bullets (keep the heading and the last bullet about skills: "No skill covers TanStack Form 1.x: …") with:

```md
- Build forms with `useAppForm` from `#/components/ui/form` (TanStack Form composition) and render fields with `<form.AppField name="…">`, using `field.TextField`, `field.TextareaField`, `field.ChoiceField` (native radios: one tap each, visible without opening anything) or `field.SelectField`. Add new field types to `form.tsx` rather than wiring inputs by hand; it imports its primitives by relative path so `node:test` can load it. The intake form (`src/intake/components/intake-form.tsx`) is the reference.
- Validate with a plain function in `validators.onDynamic` that returns `{ fields }` (the intake's `validateIntake`), with `validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" })` for "validate on submit, then on change". Zod schemas work there too (TanStack Form 1.x reads Standard Schema), but each adds to the browser bundle.
- Put the API's field errors in `errorMap.onServer` with `form.setFieldMeta`, and clear a field's in a form-level `listeners.onChange`.
- Controls are 3rem tall with 1.0625rem text (iOS zooms into anything smaller), labels 1rem. Field errors are tied to their control by `aria-describedby` and not announced one by one: show an error summary and move focus to it.
```

(b) In the "## Studio page" section, replace the bullet that starts "The `#inquiry` section (`src/studio/components/inquiry.tsx`) is the intake form's mount point" with:

```md
- The `#inquiry` section (`src/studio/components/inquiry.tsx`): `InquiryState` says whether it is open, for which artist (`preferredArtist.id` is `createInquiry`'s `preferredArtistId`) and which artists can be chosen. Open, it holds the [intake form](#intake-form); its server-rendered fallback is WhatsApp or email with a prefilled message.
```

and in the bullet that starts "No analytics and no third-party scripts", replace "No analytics and no third-party scripts, fonts or stylesheets" with "No analytics and no third-party scripts, fonts or stylesheets, except the intake form's Cloudflare Turnstile (loaded only once someone starts filling the form in)".

(c) Append at the end of the file:

```md
## Intake form

The `#inquiry` section's form (TAT-57, `src/intake/`) sends `useCreateInquiry()` straight from the browser to the API, with a Turnstile token and TAT-55's honeypot.

- Mount: `IntakeMount` renders it only after hydration, from its own chunk (`React.lazy`); on the server, before hydration, without JavaScript or when the chunk fails to load, TAT-48's chat-link fallback shows. Nothing of the form is in the server-rendered HTML.
- Pure modules, tested with `node:test`: `copy.ts` (every string, as templates; `fill` and `<Fill>`, which puts values in `<bdi>`; a Nepali file would mirror its shape), `rules.ts` (limits pinned to `openapi.yaml`, a copy of the platform's `normalizePhone`, Devanagari digits turned into ASCII ones, `validateIntake`), `images.ts` (`prepareReference` behind an `ImageCodec`), `references.ts` (the photo tray), `submission.ts` (the SDK input), `problems.ts` (every API code to a field error or a notice), `challenge.ts` (Turnstile behind a `ChallengeHost`), `submit-flow.ts` (one attempt at a time). `browser-codec.ts` and `challenge-host.ts` touch the DOM and only the browser pass covers them.
- Photos: picked with `accept="image/jpeg,image/png,image/webp"` (iOS converts HEIC; a HEIC the browser can't decode gets a message), at most 5, prepared one at a time: decoded the right way up, drawn on white, re-encoded as JPEG at a long edge of 1600 px (0.85, then 0.72, then 1280 px until at most 1 MiB; refused over 3.5 MiB), so no EXIF or GPS leaves the phone and five stay under the API's 20 MB. Previews are object URLs of those JPEGs, revoked on remove, success and unmount.
- Sending: `fetch` reports no upload progress, so the status line names the phase and the size, and says "Still sending" after 15 s; the SDK's 120 s upload timeout stands; there is no cancel (a `beforeunload` prompt asks while sending). Everything entered stays after any refusal; "Send again" takes a new token.
- Bot check: `TURNSTILE_SITE_KEY` (a server setting read by `parseStorefrontConfig`; public; required with `NODE_ENV=production`, optional elsewhere, where no widget runs and no token is sent) reaches the browser in the router context's `site`. The script (`challenges.cloudflare.com`) loads on the first focus or tap in the form, runs at Send (`execution: "execute"`, `appearance: "interaction-only"`) and is reset after every attempt. To try it locally, set the storefront's `TURNSTILE_SITE_KEY=1x00000000000000000000AA` and the platform's `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` (Cloudflare's always-pass pair; `3x00000000000000000000FF` forces the checkbox, `2x00000000000000000000AB` always fails); leave both unset to skip it.
- It is the page's one third-party script. No Content-Security-Policy is sent yet; one would need `script-src` and `frame-src https://challenges.cloudflare.com`, `connect-src` with `API_URL`, and `img-src blob:` plus the API's photo origin.
- Nothing is kept in storage (shared phones), nothing is tracked, and nothing about the person goes in a URL.
- Browser pass (no node test can do these), at 375 px and on a real phone when possible: a portrait iPhone photo arrives upright as a JPEG of at most 1600 px; a transparent PNG arrives on white; a HEIC picked from Files on Android Chrome gets the HEIC message; five 12 MP photos prepare one by one without the tab dying on a low-end Android phone; with DevTools' network at "Slow 3G" the status line shows the size, then "Still sending"; the widget stays hidden with the always-pass key and shows its checkbox with `3x…FF`; offline, Send says it wasn't sent and keeps everything; nothing reaches `challenges.cloudflare.com` before the first focus in the form.
```

- [ ] **Step 2: Storefront AGENTS.md and README**

In `apps/storefront/AGENTS.md`:
- replace "Do not introduce a storefront auth/database layer, analytics or third-party scripts." with "Do not introduce a storefront auth/database layer, analytics or third-party scripts (the intake form's Cloudflare Turnstile is the one exception: [intake form](docs/development.md#intake-form)).";
- replace "needs `API_URL` and `STOREFRONT_URL`)" with "needs `API_URL` and `STOREFRONT_URL`; `TURNSTILE_SITE_KEY` is optional there and required in production)".

In `apps/storefront/README.md`, replace "contact links, artists and inquiry section" with "contact links, artists and intake form", and "Tenants and hosts, API data, the studio page, forms and monitoring" with "Tenants and hosts, API data, the studio page, the intake form, forms and monitoring".

- [ ] **Step 3: Repository README**

In `README.md`, "Deployment":
- in the **Storefront** bullet, after "`STOREFRONT_URL` (`https://{tenant}.<domain>`) set," add " `TURNSTILE_SITE_KEY` (the Turnstile widget's public site key: with `NODE_ENV=production` a missing one makes every page a 500),";
- in TAT-55's **Bot challenge** bullet, replace "its site key is public and goes to the storefront (TAT-57)" with "its site key is public and goes to the storefront as `TURNSTILE_SITE_KEY` (Vercel's production and preview environments; TAT-57)", and, if the bullet says to check whether subdomains are covered, replace that with "a hostname covers its subdomains, so the studio pages' domain is enough (each custom domain, TAT-79, needs its own entry)". If TAT-55's bullet isn't there (renamed by its review), add this sentence to the **Storefront** bullet instead: "The Turnstile widget (Cloudflare dashboard, Turnstile, Managed mode, the studio pages' domain as hostname, which covers its subdomains) gives the site key; its secret key is the platform's `TURNSTILE_SECRET_KEY`."

- [ ] **Step 4: SDK guide, architecture, requirements, index**

In `docs/sdk.md`, after TAT-55's paragraph that starts "The intake form sends `client.inquiries.create(input)`", add:

```md
The studio page's form is `apps/storefront/src/intake/` ([intake form](../apps/storefront/docs/development.md#intake-form)): it shrinks photos to JPEG in the browser before the upload, renders the widget in execute mode at Send, and never retries on its own.
```

In `docs/architecture.md`, "Intake (customer → API)", append to step 2: " The studio page first re-encodes the photos as JPEG in the browser (at most 1600 px), so uploads stay small on slow connections and no EXIF or GPS data leaves the phone."

In `docs/requirements.md`:
- tick the three **Intake** boxes (`- [ ] A public intake form on the studio page, plus a per-artist link`, the "The form asks for: …" line, `- [ ] After submitting, the customer is told the studio will reply on WhatsApp or Viber`): `- [ ]` becomes `- [x]`, the text unchanged;
- tick `- [ ] Studio page at \`{slug}.platform.com\`: profile, artists, Instagram link, intake form`;
- in "Studio page rules", replace "(the bot challenge, TAT-55, will be the one exception)" with "(the intake form's bot challenge, Cloudflare Turnstile, is the one exception, loaded only once someone starts filling the form in)". If TAT-48's wording differs, change only its tense and naming the same way.

In `docs/README.md`, the storefront row: add "the intake form, " after "the studio page, " (keep the rest as TAT-23 and TAT-48 left it).

- [ ] **Step 5: Check and commit**

Run: `rg -n "intake-form|#forms|#studio-page" apps/storefront/AGENTS.md apps/storefront/docs/development.md docs/sdk.md README.md`
Expected: the links point at `## Intake form`, `## Forms` and `## Studio page`, which exist in `apps/storefront/docs/development.md`.

Run: `rg -n "^- \[x\] (A public intake form|The form asks for|After submitting|Studio page at)" docs/requirements.md`
Expected: four lines.

```bash
git add apps/storefront/docs/development.md apps/storefront/AGENTS.md apps/storefront/README.md README.md docs/sdk.md docs/architecture.md docs/requirements.md docs/README.md
git commit -m "docs(storefront): document the intake form, its photos, bot check and settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Final verification

- [ ] **Step 1: Root gates**

Run each, from the root:

```bash
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm check
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm typecheck
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm build
```

Expected: all pass (the storefront build ends with the client-bundle check). After the build, `git status -s` shows no change.

- [ ] **Step 2: Every test suite**

Run in the background (about 2 minutes; the platform's needs PostgreSQL): `PORT=3402 PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm test > <scratchpad>/tat57-suite.log 2>&1; echo "exit $?" >> <scratchpad>/tat57-suite.log`
Expected: exit 0; the storefront's `# fail 0` with more tests than Task 0's baseline; the SDK, React and platform counts equal to the base's (none of their code changed). Read the counts in the log, not only the exit code.

- [ ] **Step 3: Nothing that must stay put moved**

```bash
git diff --quiet <base> -- apps/storefront/package.json pnpm-lock.yaml apps/storefront/src/routeTree.gen.ts apps/platform packages; echo "exit $?"
rg -n "localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML" apps/storefront/src/intake apps/storefront/src/studio; echo "exit $?"
rg -l "TURNSTILE_SITE_KEY|TURNSTILE_SECRET_KEY|STOREFRONT_SERVER_KEY" apps/storefront/.output/public; echo "exit $?"
PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront check:page
```

Expected: `exit 0`, `exit 1`, `exit 1`, then "Page check passed: … the public site key is in the page."

Run: `for f in apps/storefront/.output/public/assets/*.js; do printf '%s %s\n' "$(gzip -c "$f" | wc -c)" "$f"; done | sort -n | tail -8`
Note in the report the gzipped size of the form's chunk (the one holding "Send inquiry") and of the largest chunk, against TAT-48's sizes if its report has them. Expected: the page's first-load chunks are no bigger than on `<base>` (the form is its own chunk); the form's chunk well under 60 KB gzipped. If not, report which modules dominate.

- [ ] **Step 4: The built server, a fake API and the browser pass**

1. Create `<scratchpad>/tat57-fake-api.mjs`:

```js
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

// A stand-in API for the intake form's browser pass: the studio, two artists,
// and POST /inquiries, whose answer comes from the mode file (201 by default).
const [port, logFile, modeFile, uploadDir] = process.argv.slice(2);
const studio = {
	slug: "demo-studio",
	name: "Demo Studio",
	type: "studio",
	intro: "Fine line and blackwork in Thamel.",
	timezone: "Asia/Kathmandu",
	contact: { phone: "+9779812345678", email: "hello@demo-studio.example", address: "Thamel Marg\nKathmandu" },
	socialLinks: [{ platform: "instagram", url: "https://instagram.com/demostudio" }],
	acceptingInquiries: true,
};
const artist = (id, slug, name) => ({ id, slug, name, bio: null, photo: null, acceptingInquiries: true, closedMessage: null });
const artists = [
	artist("0199f000-0000-7000-8000-000000000048", "sita", "Sita Rai"),
	artist("0199f000-0000-7000-8000-000000000050", "mina", "मीना गुरुङ"),
];
const cors = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST",
	"access-control-allow-headers": "accept, content-type, x-challenge-token",
	"access-control-max-age": "600",
};
const answers = {
	201: [201, { data: { id: "0199f000-0000-7000-8000-000000000057" } }],
	422: [422, { error: { code: "validation_failed", message: "x", fields: { contactPhone: ["Enter a phone number, like 9812345678 or +977 1 4123456."], "referenceImages.0": ["Upload a JPEG, PNG or WebP image."] } } }],
	409: [409, { error: { code: "too_many_open_inquiries", message: "x" } }],
	403: [403, { error: { code: "challenge_failed", message: "x" } }],
	429: [429, { error: { code: "rate_limited", message: "x" } }, { "retry-after": "1200" }],
	500: [500, { error: { code: "internal_error", message: "x" } }],
};
const mode = () => {
	try {
		return readFileSync(modeFile, "utf8").trim();
	} catch {
		return "201";
	}
};

/** A JPEG's size from its SOF marker, "HAS EXIF" if an APP1 comes first, or why not. */
function jpegInfo(bytes) {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return "NOT A JPEG";
	let at = 2;
	while (at + 9 < bytes.length) {
		if (bytes[at] !== 0xff) return "bad JPEG";
		const marker = bytes[at + 1];
		if (marker === 0xe1) return "HAS EXIF";
		if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
			return `${bytes.readUInt16BE(at + 7)}x${bytes.readUInt16BE(at + 5)}`;
		}
		at += 2 + bytes.readUInt16BE(at + 2);
	}
	return "no size";
}

createServer((request, response) => {
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", async () => {
		appendFileSync(logFile, `${request.method} ${request.url} token=${request.headers["x-challenge-token"] ?? "-"}\n`);
		const send = (status, body, headers = {}) => {
			response.writeHead(status, { ...cors, "content-type": "application/json; charset=utf-8", ...headers });
			response.end(JSON.stringify(body));
		};
		if (request.method === "OPTIONS") {
			response.writeHead(204, cors);
			response.end();
			return;
		}
		if (request.method === "GET" && request.url === "/api/v1/tenants/demo-studio") return send(200, { data: studio });
		if (request.method === "GET" && request.url === "/api/v1/tenants/demo-studio/artists") return send(200, { data: artists });
		if (request.method === "POST" && request.url === "/api/v1/tenants/demo-studio/inquiries") {
			const form = await new Response(Buffer.concat(chunks), {
				headers: { "content-type": request.headers["content-type"] ?? "" },
			}).formData();
			let n = 0;
			for (const [name, value] of form) {
				if (typeof value === "string") {
					appendFileSync(logFile, `  ${name}=${JSON.stringify(value)}\n`);
				} else {
					const bytes = Buffer.from(await value.arrayBuffer());
					writeFileSync(`${uploadDir}/tat57-upload-${n}.jpg`, bytes);
					appendFileSync(logFile, `  ${name}=<${value.type} ${value.name} ${bytes.length} bytes ${jpegInfo(bytes)}>\n`);
					n += 1;
				}
			}
			if (mode() === "hang") return;
			const [status, body, headers] = answers[mode()] ?? answers[201];
			return send(status, body, headers);
		}
		send(404, { error: { code: "not_found", message: "Not found." } });
	});
}).listen(Number(port), "127.0.0.1");
```

2. Start it in the background: `PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH node <scratchpad>/tat57-fake-api.mjs 3403 <scratchpad>/tat57-api.log <scratchpad>/tat57-mode <scratchpad>`. Note its PID.
3. Start the built storefront (Step 1 built it) in the background: `NODE_ENV=production API_URL=http://127.0.0.1:3403 STOREFRONT_URL='http://{tenant}.localhost:3404' TURNSTILE_SITE_KEY=1x00000000000000000000AA PORT=3404 PATH=/home/blank/.nvm/versions/node/v24.3.0/bin:$PATH pnpm --filter @tattoo-drip/storefront start > <scratchpad>/tat57-start.log 2>&1`, wait until its log shows it listening on 3404, and note the PID of the `node … .output/server/index.mjs` process (`pgrep -af "output/server/index.mjs"`).
4. Curl checks, with `-H 'Host: demo-studio.localhost:3404'` on each request to `http://127.0.0.1:3404` (use `http://[::1]:3404` if the server refuses 127.0.0.1): `/` and `/artists/sita` answer 200; their HTML holds `challengeSiteKey:"1x00000000000000000000AA"` and "Message on WhatsApp" (the fallback), and no `<form`; `rg -c "challenges.cloudflare.com" <the saved HTML>` finds nothing.
5. Browser pass, if a browser tool is available (else say so in the report and leave the list in `apps/storefront/docs/development.md#intake-form` to the user): open `http://demo-studio.localhost:3404/` at 375×812 and 1280×800.
   - The section shows the fallback, then the form; no horizontal scroll (`document.documentElement.scrollWidth <= window.innerWidth`); Tab reaches every control with the violet focus ring, never the honeypot; the network panel shows no request to `challenges.cloudflare.com` until the first focus in the form, then the script.
   - Send with everything empty: the summary appears and takes focus, listing 7 answers; each link moves focus to its control.
   - Fill the form, the phone as `९८१२३४५६७८`, and add two images made for the test (a large PNG with transparency and a large JPEG; generate them with a small node script into `<scratchpad>` if none are at hand): each shows "Preparing…", then a thumbnail. Send (`echo 201 > <scratchpad>/tat57-mode`): the status line passes "Running a quick security check…" and "Sending your inquiry with 2 photos (… MB)…", then "Inquiry sent" takes focus and names the number. `<scratchpad>/tat57-api.log` shows `token=XXXX.DUMMY.TOKEN.XXXX`, exactly the contract's field names (no `website`, no `challengeToken`), `contactPhone="9812345678"`, and each image as `image/jpeg reference.jpg … bytes <W>x<H>` with the long edge at most 1600 and never `HAS EXIF`; the PNG's upload, opened from `<scratchpad>`, is white where it was transparent.
   - With the page reloaded and the form refilled, set the mode to `422`, `409`, `403`, `429` and `500` in turn and send: the phone error and photo 1's problem show in the summary (422); each other code shows its notice and keeps every field and photo; after `429`, Send stays disabled with "Wait 20 minutes". Stop the fake API and send: "Your inquiry wasn't sent", everything kept; start it again.
   - Restart the storefront with `TURNSTILE_SITE_KEY=3x00000000000000000000FF`: Send shows Cloudflare's checkbox and "Tick the box above to send."; ticking it sends.
   - Take one screenshot of the form and one of the success screen at each width for the report.
6. Stop the storefront and the fake API by their exact PIDs (`kill <pid>`). Never `pkill -f`.

- [ ] **Step 5: Report**

Commits (hashes and subjects); test counts (storefront, SDK, React, platform) against the baselines; the chunk sizes; the curl results; the browser pass (screenshots, the fake API log's fields and image sizes) or why it was skipped; any deviation from this plan with its reason. Tell the user: set `TURNSTILE_SITE_KEY` in Vercel (production and preview) together with the platform's `TURNSTILE_SECRET_KEY` before any deploy (Cloudflare dashboard, Turnstile, Add widget, Managed mode, the studio pages' domain as hostname); production refuses to render without it; the real-phone checks in `apps/storefront/docs/development.md#intake-form` (an iPhone portrait photo, a low-end Android phone with five photos, a slow network) are theirs if no browser tool ran them.

