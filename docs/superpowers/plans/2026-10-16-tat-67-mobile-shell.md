# Mobile-first dashboard shell (TAT-67) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard feels like an installed app on a phone (bottom tabs with the inbox badge, a home-screen icon, an offline screen) and stays comfortable on a laptop (left sidebar), with owners landing on the Inbox and artists on Projects.

**Architecture:** One plain-data nav list (`inertia/components/shell/nav_items.ts`, unit-tested) is rendered twice by a new shell in `AppLayout`: a top bar plus bottom tab bar below 1024px, a left sidebar from 1024px. `/t/:tenant` becomes a role-based redirect. Installability is static files: a manifest, a hand-written service worker that caches only hashed build files and an offline page, and icons generated once from a placeholder SVG mark.

**Tech Stack:** AdonisJS 7, Inertia + React, Tailwind v4, shadcn/ui (Radix dropdown), lucide-react, `sharp` (icon generation), `@adonisjs/static` (serves `public/`), Japa.

**Spec:** `docs/superpowers/specs/2026-10-16-tat-67-mobile-shell-design.md`

## Global Constraints

- No migration; no API, SDK or OpenAPI change; no change to any page's content beyond where it sits in the shell.
- Breakpoint: Tailwind's `lg` (1024px). Below it: top bar + bottom tab bar; from it: left sidebar (`w-60`, about 240px).
- Nav: owners get Inbox, Projects, Settings (in that order); artists get Projects. The Inbox badge shows only when `inboxCount` is above zero. The tab bar shows only with two or more items. Settings is also current on `/t/:tenant/artists/*`.
- `/t/:tenant` (`tenant.dashboard`) redirects owners to `tenant.inbox.index` and artists to `tenant.projects.index`.
- Copy, verbatim: app name "Tattoo Drip"; offline page "You're offline", "Tattoo Drip needs a connection to show your studio.", button "Try again"; offline bar "You're offline. Changes won't save until you're back online."; account menu items "Light theme" / "Dark theme" and "Log out".
- Colors: mark square `#18181b`, letters `#ffffff`; manifest `background_color` `#ffffff`, `theme_color` `#18181b`; `theme-color` metas light `#ffffff`, dark `#09090b`.
- The service worker caches only `/offline.html`, the icons it precaches, and same-origin `GET /assets/*` (at most 100 entries); it never touches non-GET requests, Inertia JSON visits, `/files`, `/uploads` or other origins. Cache name `td-shell-v1`. Registered only when `import.meta.env.PROD`.
- UI follows `apps/platform/docs/ui.md`: shadcn components and semantic tokens, no custom CSS classes, `cn` from `cn`, `~/` imports.
- Commands run from `apps/platform` unless stated; tests use `PORT=3402`. A RED step for a missing module hangs the Japa runner after the error: run it as `PORT=3402 timeout 90 pnpm test <suite> --files=<name>.spec.ts` (exit 124 plus the error is the expected RED). Don't wrap commands in `sh -c`. Editor diagnostics go stale after codegen; `pnpm typecheck` is the authority. After route or page changes run `node ace codegen` and commit `.adonisjs/`.
- Commits are Conventional Commits with the `platform` scope and end with the Co-Authored-By line from the session's attribution reminder.

## Review Focus

1. A tab marked current on the wrong page: `/t/bnt/inboxes`, a query string (`/t/bnt/inbox?view=decided`), another studio whose slug starts the same (`/t/bnt2/inbox`), and Settings on `/t/bnt/artists/new`. (Task 1 tests.)
2. No new inquiries: no badge at all (never "0"), and artists never get one. (Task 1 tests.)
3. An artist opening `/t/:tenant`, the studio switcher or the app icon lands on Projects, never the owners-only Inbox (a 404 for them). (Task 2 tests.)
4. On an installed iPhone: the last list row and page buttons are not hidden behind the tab bar or the home indicator, and the top bar is not under the status bar. (Task 4; no automated layout tests exist, so the browser pass covers it.)
5. Offline and after logout: the service worker stores no pages, Inertia responses, `/files` or `/uploads`, and a new deploy never leaves a stale page (navigations always try the network; build files are hashed). (Task 6 pins the precache list; the reviewer and the browser pass cover the fetch rules.)

---

## Before Task 1: preconditions

- [ ] On branch `harublank00/tat-67-mobile-first-pwa-dashboard-shell` (from main 20120a6, with the spec and this plan committed), clean tree: `git status -sb`.
- [ ] Baseline: `PORT=3402 pnpm test functional --files=tenant_routes.spec.ts --files=artists_page.spec.ts`. Expected: PASS.
- [ ] Linear: set TAT-67 to In Progress.

---

### Task 1: One nav list

**Files:**
- Create: `apps/platform/inertia/components/shell/nav_items.ts`
- Modify: `apps/platform/inertia/components/nav_link.tsx`
- Test: `apps/platform/tests/unit/inertia/nav_items.spec.ts`

**Interfaces:**
- Produces:
  - `type NavKey = "inbox" | "projects" | "settings"`
  - `type ShellNavItem = { key: NavKey; label: string; route: "tenant.inbox.index" | "tenant.projects.index" | "tenant.settings"; badge?: number; also?: string[] }`
  - `navItems(tenant: { slug: string; role: string }, inboxCount: number | null): ShellNavItem[]`
  - `showTabBar(items: ShellNavItem[]): boolean`
  - `isCurrentPath(url: string, href: string, options?: { exact?: boolean; also?: string[] }): boolean`
  - `NavLink` gains the prop `also?: string[]` (absolute path prefixes that also make it current).

`nav_items.ts` imports nothing, so the Japa unit suite can import it by relative path (checked: the test runner resolves a relative `.js` import to the `.ts` file).

- [ ] **Step 1: Write the failing test**

Create `apps/platform/tests/unit/inertia/nav_items.spec.ts`:

```ts
import { test } from "@japa/runner";
import {
	isCurrentPath,
	navItems,
	showTabBar,
} from "../../../inertia/components/shell/nav_items.js";

const owner = { slug: "bnt", role: "owner" };
const artist = { slug: "bnt", role: "artist" };

test.group("navItems", () => {
	test("owners get Inbox, Projects and Settings; artists get Projects", ({
		assert,
	}) => {
		assert.deepEqual(
			navItems(owner, 0).map(({ key }) => key),
			["inbox", "projects", "settings"],
		);
		assert.deepEqual(
			navItems(artist, null).map(({ key }) => key),
			["projects"],
		);
	});

	test("the Inbox badge shows only above zero", ({ assert }) => {
		const inbox = (count: number | null) =>
			navItems(owner, count).find(({ key }) => key === "inbox");

		assert.equal(inbox(3)?.badge, 3);
		assert.notProperty(inbox(0), "badge");
		assert.notProperty(inbox(null), "badge");
		assert.isTrue(navItems(artist, 5).every((item) => !("badge" in item)));
	});

	test("Settings also covers the artist pages of this studio", ({ assert }) => {
		const settings = navItems(owner, 0).find(({ key }) => key === "settings");
		assert.deepEqual(settings?.also, ["/t/bnt/artists"]);
	});

	test("the tab bar needs two or more destinations", ({ assert }) => {
		assert.isTrue(showTabBar(navItems(owner, 0)));
		assert.isFalse(showTabBar(navItems(artist, 0)));
	});
});

test.group("isCurrentPath", () => {
	test("matches the page and the pages below it, by whole segments", ({
		assert,
	}) => {
		assert.isTrue(isCurrentPath("/t/bnt/inbox", "/t/bnt/inbox"));
		assert.isTrue(isCurrentPath("/t/bnt/inbox/", "/t/bnt/inbox"));
		assert.isTrue(isCurrentPath("/t/bnt/inbox?view=decided", "/t/bnt/inbox"));
		assert.isTrue(isCurrentPath("/t/bnt/inbox/0199", "/t/bnt/inbox"));
		assert.isFalse(isCurrentPath("/t/bnt/inboxes", "/t/bnt/inbox"));
		assert.isFalse(isCurrentPath("/t/bnt2/inbox", "/t/bnt/inbox"));
	});

	test("exact matches only the page itself", ({ assert }) => {
		assert.isTrue(isCurrentPath("/t/bnt", "/t/bnt", { exact: true }));
		assert.isFalse(isCurrentPath("/t/bnt/inbox", "/t/bnt", { exact: true }));
	});

	test("also adds other prefixes", ({ assert }) => {
		const also = ["/t/bnt/artists"];
		assert.isTrue(
			isCurrentPath("/t/bnt/artists/new", "/t/bnt/settings", { also }),
		);
		assert.isTrue(
			isCurrentPath("/t/bnt/settings/payments", "/t/bnt/settings", { also }),
		);
		assert.isFalse(
			isCurrentPath("/t/bnt/artistsx", "/t/bnt/settings", { also }),
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PORT=3402 timeout 90 pnpm test unit --files=nav_items.spec.ts`
Expected: exit 124 after "Cannot find module ... nav_items.js".

- [ ] **Step 3: Write the nav list**

Create `apps/platform/inertia/components/shell/nav_items.ts`:

```ts
/**
 * The dashboard's main destinations (TAT-67): one list, rendered as the
 * phone's bottom tab bar and the desktop sidebar. Plain data with no
 * imports, so the unit tests can load it. Calendar (TAT-50) and Clients
 * (TAT-41) each become one more entry here.
 */
export type NavKey = "inbox" | "projects" | "settings";

export type ShellNavItem = {
	key: NavKey;
	label: string;
	route: "tenant.inbox.index" | "tenant.projects.index" | "tenant.settings";
	/** New inquiries on the Inbox; absent unless above zero. */
	badge?: number;
	/** Other path prefixes that also make this item current. */
	also?: string[];
};

/**
 * What `tenant`'s member sees: owners get Inbox, Projects and Settings
 * (the artist pages count as Settings); artists get Projects. The server
 * 404s the rest anyway.
 */
export function navItems(
	tenant: { slug: string; role: string },
	inboxCount: number | null,
): ShellNavItem[] {
	const owner = tenant.role === "owner";
	const items: ShellNavItem[] = [];
	if (owner) {
		items.push({
			key: "inbox",
			label: "Inbox",
			route: "tenant.inbox.index",
			...(inboxCount && inboxCount > 0 ? { badge: inboxCount } : {}),
		});
	}
	items.push({
		key: "projects",
		label: "Projects",
		route: "tenant.projects.index",
	});
	if (owner) {
		items.push({
			key: "settings",
			label: "Settings",
			route: "tenant.settings",
			also: [`/t/${tenant.slug}/artists`],
		});
	}
	return items;
}

/** The tab bar only earns its space with two or more destinations. */
export function showTabBar(items: ShellNavItem[]): boolean {
	return items.length >= 2;
}

/**
 * Whether `url` (the current page; a query string or trailing slash is
 * fine) is `href` or below it, or below one of `also`. Whole path
 * segments only, so "/t/a/inbox" is not current on "/t/a/inboxes".
 * `exact` matches `href` itself only.
 */
export function isCurrentPath(
	url: string,
	href: string,
	{ exact = false, also = [] }: { exact?: boolean; also?: string[] } = {},
): boolean {
	const path = url.split("?")[0].replace(/(.)\/+$/, "$1");
	if (exact) return path === href;
	const under = (prefix: string) =>
		path === prefix || path.startsWith(`${prefix}/`);
	return under(href) || also.some(under);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PORT=3402 pnpm test unit --files=nav_items.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: NavLink uses it**

In `apps/platform/inertia/components/nav_link.tsx`: add `import { isCurrentPath } from "~/components/shell/nav_items";`; add to the props type and destructuring `also?: string[]` (doc comment: `/** Other path prefixes that also make the link current. */`); and replace

```ts
	const path = url.split("?")[0].replace(/(.)\/+$/, "$1");
	const isActive = exact
		? path === href
		: path === href || path.startsWith(`${href}/`);
```

with

```ts
	const isActive = isCurrentPath(url, href, { exact, also });
```

Then `pnpm typecheck`: clean.

- [ ] **Step 6: Commit**

```bash
git add inertia/components/shell/nav_items.ts inertia/components/nav_link.tsx tests/unit/inertia/nav_items.spec.ts
git commit -m "feat(platform): add one nav list for the dashboard shell"
```

---

### Task 2: Land on the work list

**Files:**
- Modify: `apps/platform/app/controllers/dashboard_controller.ts`
- Modify: `apps/platform/start/routes.ts:33`
- Delete: `apps/platform/inertia/pages/dashboard.tsx`
- Modify: `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`
- Modify: `apps/platform/tests/isolation/cases.ts` (the `/t/:tenant` case)
- Regenerate: `apps/platform/.adonisjs/`

**Interfaces:**
- Produces: `DashboardController.tenantHome(ctx)`; the route name `tenant.dashboard` is unchanged (the studio switcher and `/dashboard` keep using it).

- [ ] **Step 1: Write the failing tests**

In `apps/platform/tests/functional/tenancy/tenant_routes.spec.ts`, in the first test (the one that checks the shared `tenant` and `tenants` props), change `response.assertInertiaComponent("dashboard");` to `response.assertInertiaComponent("inquiries/index");` (the client follows the redirect to the owner's Inbox, which carries the same shared props).

Add this test to the same group, after "a signed-out visitor goes to the login page":

```ts
	test("the studio's address opens the member's work list", async ({
		client,
	}) => {
		const owner = await makeUser("owner@example.com");
		const tenant = await tenancy.createTenant(owner, studio("black-needle"));
		const artistUser = await makeUser("artist@example.com");
		await inTenant(tenant, () =>
			TenantMembership.create({
				tenantId: tenant.id,
				userId: artistUser.id,
				role: "artist",
			}),
		);

		const ownerResponse = await client
			.get("/t/black-needle")
			.loginAs(owner)
			.redirects(0);
		ownerResponse.assertStatus(302);
		ownerResponse.assertHeader("location", "/t/black-needle/inbox");

		const artistResponse = await client
			.get("/t/black-needle")
			.loginAs(artistUser)
			.redirects(0);
		artistResponse.assertStatus(302);
		artistResponse.assertHeader("location", "/t/black-needle/projects");
	});
```

In `apps/platform/tests/isolation/cases.ts`, change the `/t/:tenant` case's `ownStatus: 200` to `ownStatus: 302`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts`
Expected: FAIL: the component is still `dashboard`, the new test gets 200 instead of 302, and the isolation case's own-studio control gets 200 instead of 302.

- [ ] **Step 3: The redirect**

In `apps/platform/app/controllers/dashboard_controller.ts`, add `import { LAST_TENANT_KEY, tenantContext } from "#middleware/tenant_middleware";` (replacing the `LAST_TENANT_KEY`-only import) and this method after `show`:

```ts
	/**
	 * /t/:tenant: the member's work list. Owners land on the inbox, artists
	 * on their projects (the inbox is owners only). The studio switcher and
	 * /dashboard link here, so everyone lands on what they work through.
	 */
	async tenantHome(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		return ctx.response
			.redirect()
			.toRoute(
				membership.role === "owner"
					? "tenant.inbox.index"
					: "tenant.projects.index",
				{ tenant: tenant.slug },
			);
	}
```

In `apps/platform/start/routes.ts`, replace

```ts
		router.on("/").renderInertia("dashboard", {}).as("tenant.dashboard");
```

with

```ts
		router.get("/", [controllers.Dashboard, "tenantHome"]).as("tenant.dashboard");
```

Delete `apps/platform/inertia/pages/dashboard.tsx`. Then `node ace codegen`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=tenant_routes.spec.ts --files=cross_tenant.spec.ts --files=access.spec.ts --files=request_transaction.spec.ts`
Expected: PASS (the other `/t/black-needle` requests in these files follow the redirect to a page the member may open). Then `pnpm typecheck`: clean.

- [ ] **Step 5: Commit**

```bash
git add app/controllers/dashboard_controller.ts start/routes.ts inertia/pages/dashboard.tsx tests .adonisjs
git commit -m "feat(platform): open the studio on the member's work list"
```

---

### Task 3: The placeholder mark, icons and name

**Files:**
- Create: `apps/platform/resources/brand/mark.svg`
- Create: `apps/platform/scripts/generate_icons.ts`
- Create (generated, committed): `apps/platform/public/icons/{icon-192.png,icon-512.png,icon-maskable-512.png,apple-touch-icon.png,favicon-32.png,favicon.svg}`
- Modify: `apps/platform/inertia/components/logo.tsx`
- Modify: `apps/platform/inertia/app.tsx` (the app name)
- Modify: `apps/platform/resources/views/inertia_layout.edge` (the fallback title)
- Test: `apps/platform/tests/unit/brand/icons.spec.ts`
- Test: `apps/platform/tests/functional/shell/head.spec.ts`

**Interfaces:**
- Produces: the icon files under `public/icons/` (Task 6's manifest, head tags, service worker and offline page use them); `Logo` keeps its `size` prop and now shows the mark and "Tattoo Drip".

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/unit/brand/icons.spec.ts`:

```ts
import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";
import sharp from "sharp";

const icon = (name: string) =>
	new URL(`../../../public/icons/${name}`, import.meta.url);

test.group("App icons", () => {
	test("are generated at their sizes", async ({ assert }) => {
		const sizes: Record<string, number> = {
			"icon-192.png": 192,
			"icon-512.png": 512,
			"icon-maskable-512.png": 512,
			"apple-touch-icon.png": 180,
			"favicon-32.png": 32,
		};
		for (const [name, size] of Object.entries(sizes)) {
			const { width, height, format } = await sharp(
				await readFile(icon(name)),
			).metadata();
			assert.deepEqual([format, width, height], ["png", size, size], name);
		}
		assert.include(await readFile(icon("favicon.svg"), "utf8"), "<svg");
	});

	test("the maskable and Apple icons have no transparent corners", async ({
		assert,
	}) => {
		for (const name of ["icon-maskable-512.png", "apple-touch-icon.png"]) {
			const { data } = await sharp(await readFile(icon(name)))
				.ensureAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			assert.equal(data[3], 255, `${name}: the top-left pixel is opaque`);
		}
	});
});
```

Create `apps/platform/tests/functional/shell/head.spec.ts`:

```ts
import { test } from "@japa/runner";

test.group("Page head", () => {
	test("the title says Tattoo Drip", async ({ client, assert }) => {
		const html = (await client.get("/login")).text();
		assert.include(html, "<title data-inertia>Tattoo Drip</title>");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PORT=3402 pnpm test unit --files=icons.spec.ts`
Expected: FAIL with ENOENT for `public/icons/icon-192.png`.
Run: `PORT=3402 pnpm test functional --files=head.spec.ts`
Expected: FAIL: the title is still "AdonisJS".

- [ ] **Step 3: The mark and the generator**

Create `apps/platform/resources/brand/mark.svg` (a placeholder; the letters are shapes, not text, so no font is needed):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
	<rect id="square" width="512" height="512" rx="112" fill="#18181b"/>
	<g id="letters" fill="#ffffff">
		<rect x="87" y="152" width="144" height="44"/>
		<rect x="137" y="152" width="44" height="208"/>
		<path fill-rule="evenodd" d="M263 152H321A104 104 0 0 1 321 360H263ZM307 196H321A60 60 0 0 1 321 316H307Z"/>
	</g>
</svg>
```

Create `apps/platform/scripts/generate_icons.ts`:

```ts
/**
 * Writes the app icons in public/icons from resources/brand/mark.svg
 * (TAT-67). Run it after changing the mark, from apps/platform:
 * `node scripts/generate_icons.ts`. The outputs are committed.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = join(import.meta.dirname, "..");
const source = join(root, "resources/brand/mark.svg");
const out = join(root, "public/icons");
const mark = await readFile(source, "utf8");

/**
 * The square without rounded corners and the letters shrunk into the
 * central safe zone: Android masks it to any shape, and iOS rounds the
 * corners itself (transparent corners would show black there).
 */
function fullBleed(svg: string): string {
	const square = ' rx="112"';
	const letters = '<g id="letters"';
	if (!svg.includes(square) || !svg.includes(letters)) {
		throw new Error("mark.svg must keep the #square rx and the #letters group");
	}
	return svg
		.replace(square, "")
		.replace(
			letters,
			`${letters} transform="translate(256 256) scale(0.8) translate(-256 -256)"`,
		);
}

async function png(svg: string, size: number, name: string) {
	const data = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
	await writeFile(join(out, name), data);
}

await mkdir(out, { recursive: true });
await png(mark, 192, "icon-192.png");
await png(mark, 512, "icon-512.png");
await png(mark, 32, "favicon-32.png");
await png(fullBleed(mark), 512, "icon-maskable-512.png");
await png(fullBleed(mark), 180, "apple-touch-icon.png");
await copyFile(source, join(out, "favicon.svg"));
console.log(`Icons written to ${out}`);
```

Run: `node scripts/generate_icons.ts`
Expected: "Icons written to …/public/icons" and six files in `public/icons/`.

- [ ] **Step 4: The logo and the name**

Replace `apps/platform/inertia/components/logo.tsx` with:

```tsx
import { Link } from "@adonisjs/inertia/react";

/**
 * The Tattoo Drip mark and name, linking home. The mark is the
 * placeholder in public/icons (TAT-67); replace resources/brand/mark.svg
 * and regenerate the icons to change it.
 */
export default function Logo({ size = 26 }: { size?: number }) {
	return (
		<Link
			route="home"
			className="inline-flex items-center gap-2 font-semibold text-foreground"
		>
			<img
				src="/icons/favicon.svg"
				width={size}
				height={size}
				alt=""
				className="rounded-md"
			/>
			<span>Tattoo Drip</span>
		</Link>
	);
}
```

In `apps/platform/inertia/app.tsx`, change `import.meta.env.VITE_APP_NAME || "AdonisJS"` to `import.meta.env.VITE_APP_NAME || "Tattoo Drip"`.

In `apps/platform/resources/views/inertia_layout.edge`, replace the three-line title

```html
    <title data-inertia>
      AdonisJS
    </title>
```

with

```html
    <title data-inertia>Tattoo Drip</title>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `PORT=3402 pnpm test unit --files=icons.spec.ts` and `PORT=3402 pnpm test functional --files=head.spec.ts`
Expected: PASS. Then `pnpm typecheck` and, from the root, `pnpm exec biome check apps/platform/scripts apps/platform/inertia/components/logo.tsx apps/platform/tests/unit/brand apps/platform/tests/functional/shell`: clean.

- [ ] **Step 6: Commit**

```bash
git add resources/brand scripts/generate_icons.ts public/icons inertia/components/logo.tsx inertia/app.tsx resources/views/inertia_layout.edge tests/unit/brand tests/functional/shell
git commit -m "feat(platform): add a placeholder Tattoo Drip mark, icons and name"
```

---

### Task 4: The shell

**Files:**
- Create: `apps/platform/inertia/hooks/use-online.ts`
- Create: `apps/platform/inertia/components/shell/nav_icons.ts`
- Create: `apps/platform/inertia/components/shell/nav_badge.tsx`
- Create: `apps/platform/inertia/components/shell/account_menu.tsx`
- Create: `apps/platform/inertia/components/shell/top_bar.tsx`
- Create: `apps/platform/inertia/components/shell/tab_bar.tsx`
- Create: `apps/platform/inertia/components/shell/side_nav.tsx`
- Create: `apps/platform/inertia/components/shell/offline_bar.tsx`
- Modify (rewrite): `apps/platform/inertia/layouts/app.tsx`

**Interfaces:**
- Consumes: `navItems`, `showTabBar`, `ShellNavItem`, `NavKey` (Task 1); `NavLink`'s `also` (Task 1); `TenantSwitcher`, `useTheme`, the shared `user` (`fullName`, `email`, `initials`), `tenant` and `inboxCount` props.
- Produces: `AppLayout` (same default export, same use: `Page.layout = [AppLayout]`); `useOnline(): boolean`.

No automated test: the repo has no component or browser tests, so layouts are covered by typecheck, Biome, the existing page specs (which render through this layout) and the browser pass (Review Focus 4).

- [ ] **Step 1: The online hook**

Create `apps/platform/inertia/hooks/use-online.ts`:

```ts
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
	window.addEventListener("online", onChange);
	window.addEventListener("offline", onChange);
	return () => {
		window.removeEventListener("online", onChange);
		window.removeEventListener("offline", onChange);
	};
}

/** Whether the browser has a connection, from its online/offline events. */
export function useOnline(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => navigator.onLine,
		() => true,
	);
}
```

- [ ] **Step 2: Icons and the badge**

Create `apps/platform/inertia/components/shell/nav_icons.ts`:

```ts
import { ClipboardList, Inbox, type LucideIcon, Settings } from "lucide-react";
import type { NavKey } from "~/components/shell/nav_items";

/** The icon for each destination in the tab bar and the sidebar. */
export const NAV_ICONS: Record<NavKey, LucideIcon> = {
	inbox: Inbox,
	projects: ClipboardList,
	settings: Settings,
};
```

Create `apps/platform/inertia/components/shell/nav_badge.tsx`:

```tsx
import { cn } from "cn";

/** The count on a destination, e.g. new inquiries; read out as "3 new". */
export default function NavBadge({
	count,
	className,
}: {
	count: number;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"rounded-full bg-primary px-1.5 text-xs leading-5 text-primary-foreground tabular-nums",
				className,
			)}
		>
			{count}
			<span className="sr-only"> new</span>
		</span>
	);
}
```

- [ ] **Step 3: The account menu**

Create `apps/platform/inertia/components/shell/account_menu.tsx`:

```tsx
import { Form } from "@adonisjs/inertia/react";
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import { LogOut, Moon, Sun } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useTheme } from "~/hooks/use-theme";

/**
 * The signed-in person's menu: who they are, the light/dark switch and
 * Log out. The trigger is their initials; in the sidebar it adds the name.
 */
export default function AccountMenu({ showName = false }: { showName?: boolean }) {
	const { user } = usePage().props;
	const { theme, setTheme } = useTheme();
	if (!user) return null;
	const dark = theme === "dark";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size={showName ? "default" : "icon"}
					className={cn(showName ? "w-full justify-start" : "rounded-full")}
					aria-label="Account menu"
				>
					<span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
						{user.initials}
					</span>
					{showName && (
						<span className="truncate">{user.fullName ?? user.email}</span>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuLabel className="flex flex-col">
					{user.fullName && <span className="truncate">{user.fullName}</span>}
					<span className="truncate text-xs font-normal text-muted-foreground">
						{user.email}
					</span>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={(event) => {
						event.preventDefault();
						setTheme(dark ? "light" : "dark");
					}}
				>
					{dark ? <Sun /> : <Moon />}
					{dark ? "Light theme" : "Dark theme"}
				</DropdownMenuItem>
				{/* Kept open on select so the form is still mounted when it submits. */}
				<Form route="session.destroy">
					<DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
						<button type="submit" className="w-full">
							<LogOut />
							Log out
						</button>
					</DropdownMenuItem>
				</Form>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
```

(`DropdownMenuSeparator` is already exported by `~/components/ui/dropdown-menu`, and `user.fullName` is nullable, hence the fallback to the email.)

- [ ] **Step 4: The bars and the sidebar**

Create `apps/platform/inertia/components/shell/top_bar.tsx`:

```tsx
import AccountMenu from "~/components/shell/account_menu";
import TenantSwitcher from "~/components/tenant_switcher";

/** The phone top bar (below 1024px): the studio, and the account menu. */
export default function TopBar() {
	return (
		<header className="sticky top-0 z-30 border-b bg-background pt-[env(safe-area-inset-top)] lg:hidden">
			<div className="flex h-14 items-center justify-between gap-3 px-4">
				<div className="min-w-0">
					<TenantSwitcher />
				</div>
				<AccountMenu />
			</div>
		</header>
	);
}
```

Create `apps/platform/inertia/components/shell/tab_bar.tsx`:

```tsx
import NavLink from "~/components/nav_link";
import NavBadge from "~/components/shell/nav_badge";
import { NAV_ICONS } from "~/components/shell/nav_icons";
import type { ShellNavItem } from "~/components/shell/nav_items";

/**
 * The phone navigation (below 1024px): one tab per destination, fixed to
 * the bottom and padded clear of the iPhone home indicator. The layout
 * pads the page by the same height.
 */
export default function TabBar({
	items,
	tenantSlug,
}: {
	items: ShellNavItem[];
	tenantSlug: string;
}) {
	return (
		<nav
			aria-label="Main"
			className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
		>
			<ul className="flex">
				{items.map((item) => {
					const Icon = NAV_ICONS[item.key];
					return (
						<li key={item.key} className="flex-1">
							<NavLink
								route={item.route}
								params={{ tenant: tenantSlug }}
								also={item.also}
								className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
							>
								<span className="relative">
									<Icon className="size-5" aria-hidden="true" />
									{item.badge ? (
										<NavBadge
											count={item.badge}
											className="absolute -top-2 left-3.5"
										/>
									) : null}
								</span>
								{item.label}
							</NavLink>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
```

Create `apps/platform/inertia/components/shell/side_nav.tsx`:

```tsx
import { cn } from "cn";
import NavLink from "~/components/nav_link";
import AccountMenu from "~/components/shell/account_menu";
import NavBadge from "~/components/shell/nav_badge";
import { NAV_ICONS } from "~/components/shell/nav_icons";
import type { ShellNavItem } from "~/components/shell/nav_items";
import TenantSwitcher from "~/components/tenant_switcher";
import { buttonVariants } from "~/components/ui/button";

/**
 * The desktop navigation (from 1024px): the studio at the top, the
 * destinations, and the account menu at the bottom.
 */
export default function SideNav({
	items,
	tenantSlug,
}: {
	items: ShellNavItem[];
	tenantSlug: string;
}) {
	return (
		<aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col gap-4 border-r bg-background p-3 lg:flex">
			<div className="px-1 pt-1">
				<TenantSwitcher />
			</div>
			<nav aria-label="Main" className="flex flex-col gap-1">
				{items.map((item) => {
					const Icon = NAV_ICONS[item.key];
					return (
						<NavLink
							key={item.key}
							route={item.route}
							params={{ tenant: tenantSlug }}
							also={item.also}
							className={cn(
								buttonVariants({ variant: "ghost" }),
								"justify-start text-muted-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground",
							)}
						>
							<Icon data-icon="inline-start" />
							<span className="flex-1 text-left">{item.label}</span>
							{item.badge ? <NavBadge count={item.badge} /> : null}
						</NavLink>
					);
				})}
			</nav>
			<div className="mt-auto">
				<AccountMenu showName />
			</div>
		</aside>
	);
}
```

Create `apps/platform/inertia/components/shell/offline_bar.tsx`:

```tsx
import { WifiOff } from "lucide-react";
import { useOnline } from "~/hooks/use-online";

/** A slim notice while the connection is gone, so a failed tap isn't a mystery. */
export default function OfflineBar() {
	const online = useOnline();
	if (online) return null;

	return (
		<output className="flex items-center justify-center gap-2 bg-foreground px-4 py-1.5 text-sm text-background">
			<WifiOff className="size-4" aria-hidden="true" />
			You're offline. Changes won't save until you're back online.
		</output>
	);
}
```

- [ ] **Step 5: The layout**

Replace `apps/platform/inertia/layouts/app.tsx` with:

```tsx
import { usePage } from "@inertiajs/react";
import { cn } from "cn";
import type { ReactNode } from "react";
import FlashToasts from "~/components/flash_toasts";
import { navItems, showTabBar } from "~/components/shell/nav_items";
import OfflineBar from "~/components/shell/offline_bar";
import SideNav from "~/components/shell/side_nav";
import TabBar from "~/components/shell/tab_bar";
import TopBar from "~/components/shell/top_bar";

/**
 * The dashboard shell (TAT-67) for every tenant page. Below 1024px: a top
 * bar (studio switcher, account menu) and a bottom tab bar; from 1024px:
 * a left sidebar. Both list the destinations from `navItems`; add new
 * areas there.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
	const { tenant, inboxCount } = usePage().props;
	const items = tenant ? navItems(tenant, inboxCount) : [];
	const tabs = showTabBar(items);

	return (
		<div className="flex min-h-svh">
			{tenant && <SideNav items={items} tenantSlug={tenant.slug} />}
			<div className="flex min-w-0 flex-1 flex-col">
				<TopBar />
				<OfflineBar />
				<main
					className={cn(
						"flex flex-1 bg-muted/40",
						tabs && "pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0",
					)}
				>
					{children}
				</main>
			</div>
			{tenant && tabs && <TabBar items={items} tenantSlug={tenant.slug} />}
			<FlashToasts />
		</div>
	);
}
```

- [ ] **Step 6: Check**

Run: `pnpm typecheck`, then from the root `pnpm exec biome check apps/platform/inertia`, then `PORT=3402 pnpm test functional --files=inbox.spec.ts --files=projects_list.spec.ts --files=project_page.spec.ts --files=artists_page.spec.ts`.
Expected: clean, and PASS. The server-side render is unchanged (the layout only runs in the browser), so these specs guard the props; a broken import or prop shows up in the typecheck.

- [ ] **Step 7: Commit**

```bash
git add inertia/hooks/use-online.ts inertia/components/shell inertia/layouts/app.tsx
git commit -m "feat(platform): add the phone tab bar and desktop sidebar shell"
```

---

### Task 5: Artists inside Settings

**Files:**
- Modify: `apps/platform/inertia/layouts/settings.tsx`
- Modify: `apps/platform/inertia/pages/artists/index.tsx`
- Modify: `apps/platform/inertia/pages/artists/form.tsx`

**Interfaces:**
- Consumes: `SettingsLayout`, `Section` (existing).
- Produces: nothing new; the artist pages keep their routes, page names and props.

No automated test (layout only; the server side is unchanged). Covered by typecheck, the existing artist specs and the browser pass.

- [ ] **Step 1: Settings lists Artists**

In `apps/platform/inertia/layouts/settings.tsx`: change the lucide import to `import { Store, Users, Wallet } from "lucide-react";`; add as the last entry of `settingsNav`:

```ts
		{
			label: "Artists",
			route: "tenant.artists",
			params,
			icon: Users,
		},
```

and change the `Page` description to `"Your studio's public details, its artists, and how clients pay you."`.

- [ ] **Step 2: The artists list as a settings section**

In `apps/platform/inertia/pages/artists/index.tsx`:
- replace `import Page from "~/components/page";` with `import Section from "~/components/section";`, and add `import SettingsLayout from "~/layouts/settings";`;
- replace the `<Page title="Artists" … actions={…}>` … `</Page>` wrapper in `Artists` with:

```tsx
		<Section
			title="Artists"
			description="The artists clients can book. A hidden artist doesn't show anywhere public."
		>
			{artists.length === 0 ? (
				<Empty className="border">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<Users />
						</EmptyMedia>
						<EmptyTitle>No artists yet</EmptyTitle>
						<EmptyDescription>
							Add the artists who work here, each with their own photo, bio and
							link.
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>{add}</EmptyContent>
				</Empty>
			) : (
				<div className="flex flex-col gap-3">
					<div>{add}</div>
					{artists.map((artist) => (
						<ArtistRow
							key={artist.id}
							artist={artist}
							tenantSlug={tenant.slug}
						/>
					))}
				</div>
			)}
		</Section>
```

- change `Artists.layout = [AppLayout];` to `Artists.layout = [AppLayout, SettingsLayout];`.

- [ ] **Step 3: The artist form as a settings section**

In `apps/platform/inertia/pages/artists/form.tsx`:
- replace `import Page from "~/components/page";` with `import Section from "~/components/section";`, remove the `Card, CardContent` import if nothing else in the file uses it, and add `import SettingsLayout from "~/layouts/settings";`;
- in `ArtistForm`, replace `<Page title={…}>` `<Card className="max-w-2xl">` `<CardContent>` … `</CardContent>` `</Card>` `</Page>` with `<Section title={artist ? "Edit artist" : "Add an artist"}>` … `</Section>`, keeping the two `Form` branches inside unchanged;
- change `ArtistForm.layout = [AppLayout];` to `ArtistForm.layout = [AppLayout, SettingsLayout];`.

- [ ] **Step 4: Check**

Run: `pnpm typecheck`, from the root `pnpm exec biome check apps/platform/inertia`, and `PORT=3402 pnpm test functional --files=artists_page.spec.ts --files=artist_form.spec.ts --files=artist_photo.spec.ts`.
Expected: clean and PASS.

- [ ] **Step 5: Commit**

```bash
git add inertia/layouts/settings.tsx inertia/pages/artists
git commit -m "feat(platform): list the artists under Settings"
```

---

### Task 6: Installable and offline

**Files:**
- Create: `apps/platform/public/manifest.webmanifest`
- Create: `apps/platform/public/sw.js`
- Create: `apps/platform/public/offline.html`
- Modify: `apps/platform/resources/views/inertia_layout.edge`
- Modify: `apps/platform/inertia/app.tsx`
- Modify: `apps/platform/tests/functional/shell/head.spec.ts`
- Test: `apps/platform/tests/functional/shell/installable.spec.ts`

**Interfaces:**
- Consumes: the icons in `public/icons/` (Task 3).
- Produces: `/manifest.webmanifest`, `/sw.js`, `/offline.html` (served by the static middleware; checked: `.webmanifest` is served as `application/manifest+json`, `.js` as `text/javascript`).

- [ ] **Step 1: Write the failing tests**

Create `apps/platform/tests/functional/shell/installable.spec.ts`:

```ts
import { readFile } from "node:fs/promises";
import { test } from "@japa/runner";
import sharp from "sharp";

const publicFile = (path: string) =>
	new URL(`../../../public${path}`, import.meta.url);

test.group("Installable app", () => {
	test("the manifest describes the app, and its icons exist at their sizes", async ({
		client,
		assert,
	}) => {
		const response = await client.get("/manifest.webmanifest");
		response.assertStatus(200);
		assert.include(response.header("content-type"), "application/manifest+json");

		const manifest = JSON.parse(response.text());
		assert.containsSubset(manifest, {
			name: "Tattoo Drip",
			short_name: "Tattoo Drip",
			id: "/dashboard",
			start_url: "/dashboard",
			scope: "/",
			display: "standalone",
			background_color: "#ffffff",
			theme_color: "#18181b",
		});
		assert.sameMembers(
			manifest.icons.map(({ purpose }: { purpose: string }) => purpose),
			["any", "any", "maskable"],
		);
		for (const icon of manifest.icons) {
			const { width, height } = await sharp(
				await readFile(publicFile(icon.src)),
			).metadata();
			assert.equal(`${width}x${height}`, icon.sizes, icon.src);
		}
	});

	test("the service worker and the offline page are served", async ({
		client,
		assert,
	}) => {
		const worker = await client.get("/sw.js");
		worker.assertStatus(200);
		assert.include(worker.header("content-type"), "javascript");

		const offline = await client.get("/offline.html");
		offline.assertStatus(200);
		assert.include(offline.text(), "You're offline");
		assert.include(offline.text(), "Tattoo Drip needs a connection to show your studio.");
	});

	test("the service worker stores only the offline page and the icons up front", async ({
		assert,
	}) => {
		const source = await readFile(publicFile("/sw.js"), "utf8");
		const list = source.match(/const PRECACHE = (\[[^\]]*\]);/);
		assert.isNotNull(list, "sw.js declares PRECACHE as a one-line array");
		assert.sameMembers(JSON.parse(list?.[1] ?? "[]"), [
			"/offline.html",
			"/icons/favicon.svg",
			"/icons/icon-192.png",
		]);
		assert.include(source, 'const CACHE = "td-shell-v1";');
	});
});
```

Append to the group in `apps/platform/tests/functional/shell/head.spec.ts`:

```ts
	test("links the manifest, icons and theme colors", async ({
		client,
		assert,
	}) => {
		const html = (await client.get("/login")).text();
		for (const tag of [
			'<link rel="manifest" href="/manifest.webmanifest" />',
			'<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />',
			'<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
			'<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />',
			'<meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)" />',
			'<meta name="apple-mobile-web-app-title" content="Tattoo Drip" />',
			"viewport-fit=cover",
		]) {
			assert.include(html, tag);
		}
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `PORT=3402 pnpm test functional --files=installable.spec.ts --files=head.spec.ts`
Expected: FAIL: 404s for the three files, ENOENT for `public/sw.js`, and the head tags missing (the title test still passes).

- [ ] **Step 3: The manifest**

Create `apps/platform/public/manifest.webmanifest`:

```json
{
	"name": "Tattoo Drip",
	"short_name": "Tattoo Drip",
	"id": "/dashboard",
	"start_url": "/dashboard",
	"scope": "/",
	"display": "standalone",
	"background_color": "#ffffff",
	"theme_color": "#18181b",
	"icons": [
		{ "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
		{ "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
		{ "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
	]
}
```

- [ ] **Step 4: The service worker**

Create `apps/platform/public/sw.js`:

```js
/**
 * Tattoo Drip's service worker (TAT-67). It keeps only the app's hashed
 * build files and the offline page on the device: never pages, Inertia
 * responses or images, so nothing personal is left after logout. Pages
 * always come from the network; the offline page only when it fails.
 * Bump CACHE to drop everything stored by an older version.
 */
const CACHE = "td-shell-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = ["/offline.html", "/icons/favicon.svg", "/icons/icon-192.png"];
/** The most build files kept, oldest dropped first. */
const MAX_ASSETS = 100;

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request).catch(
				async () => (await caches.match(OFFLINE_URL)) ?? Response.error(),
			),
		);
		return;
	}
	if (url.pathname.startsWith("/assets/")) {
		event.respondWith(fromCacheOrNetwork(request));
	}
	// Anything else (Inertia visits, /files, /uploads, …) goes to the
	// network untouched.
});

/** A hashed build file never changes, so a stored copy is always right. */
async function fromCacheOrNetwork(request) {
	const cache = await caches.open(CACHE);
	const stored = await cache.match(request);
	if (stored) return stored;
	const response = await fetch(request);
	if (response.ok) {
		await cache.put(request, response.clone());
		await trim(cache);
	}
	return response;
}

/** Keeps at most MAX_ASSETS build files; cache keys are in insertion order. */
async function trim(cache) {
	const assets = (await cache.keys()).filter((key) =>
		new URL(key.url).pathname.startsWith("/assets/"),
	);
	for (const key of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) {
		await cache.delete(key);
	}
}
```

Keep `PRECACHE` on one line (the test reads it). If Biome reformats it onto several lines, shorten nothing: instead add `// biome-ignore format: tests/functional/shell/installable.spec.ts reads this line` on the line above it.

- [ ] **Step 5: The offline page**

Create `apps/platform/public/offline.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<title>You're offline - Tattoo Drip</title>
	<style>
		:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
		body { margin: 0; min-height: 100svh; display: flex; align-items: center; justify-content: center; background: #ffffff; color: #09090b; }
		main { max-width: 20rem; padding: 2rem 1.5rem; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 0.75rem; }
		h1 { font-size: 1.25rem; margin: 0.5rem 0 0; }
		p { margin: 0; color: #71717a; line-height: 1.5; }
		button { margin-top: 0.75rem; min-height: 2.75rem; padding: 0 1.25rem; border: 0; border-radius: 0.5rem; background: #18181b; color: #ffffff; font: inherit; font-weight: 600; }
		@media (prefers-color-scheme: dark) {
			body { background: #09090b; color: #fafafa; }
			p { color: #a1a1aa; }
			button { background: #fafafa; color: #18181b; }
		}
	</style>
</head>
<body>
	<main>
		<img src="/icons/favicon.svg" width="56" height="56" alt="" />
		<h1>You're offline</h1>
		<p>Tattoo Drip needs a connection to show your studio.</p>
		<button type="button" onclick="location.reload()">Try again</button>
	</main>
</body>
</html>
```

- [ ] **Step 6: The page head and the registration**

In `apps/platform/resources/views/inertia_layout.edge`, replace the viewport meta line with these lines (keep the charset meta above them and the title below):

```html
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#09090b" media="(prefers-color-scheme: dark)" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Tattoo Drip" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
```

In `apps/platform/inertia/app.tsx`, append after the `createInertiaApp({ … });` call:

```ts
// The installed app's service worker (TAT-67): production builds only, so
// it never caches anything around Vite's dev server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {});
	});
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `PORT=3402 pnpm test functional --files=installable.spec.ts --files=head.spec.ts`
Expected: PASS (5 tests). Then `pnpm typecheck` and from the root `pnpm exec biome check apps/platform/public/sw.js apps/platform/public/manifest.webmanifest apps/platform/inertia/app.tsx apps/platform/tests/functional/shell`: clean (if Biome refuses `.webmanifest` as an unknown file type, that is fine: it is checked by the test).

- [ ] **Step 8: Commit**

```bash
git add public/manifest.webmanifest public/sw.js public/offline.html resources/views/inertia_layout.edge inertia/app.tsx tests/functional/shell
git commit -m "feat(platform): make the dashboard installable with an offline page"
```

---

### Task 7: Docs

**Files:**
- Modify: `apps/platform/docs/ui.md`
- Modify: `apps/platform/docs/backend.md`
- Modify: `README.md`

- [ ] **Step 1: ui.md**

Append to `apps/platform/docs/ui.md`:

```markdown

## App shell

- `AppLayout` is the shell for every tenant page (TAT-67). Below Tailwind's `lg` (1024px): a top bar (studio switcher, account menu) and a bottom tab bar; from `lg`: a left sidebar. Both render `navItems` from `inertia/components/shell/nav_items.ts`, which is plain data and unit-tested: add a new area there (and its icon in `nav_icons.ts`), not in the layout. The tab bar only shows with two or more destinations; `also` lists other path prefixes that make an item current (Settings covers `/artists`).
- The page under the tab bar is padded by the bar's height plus `env(safe-area-inset-bottom)`; anything fixed to the bottom of a page must clear it too.
- Installable: `public/manifest.webmanifest`, icons in `public/icons/` generated from `resources/brand/mark.svg` by `node scripts/generate_icons.ts` (commit the outputs), and `public/sw.js`. The service worker caches only hashed `/assets/*` build files and the offline page; it never stores pages, Inertia responses, `/files` or `/uploads`. Bump its `CACHE` name to drop everything an older version stored. It registers only in production builds.

## Phones and slow connections

Check every page against these:

- Lists are paginated (25 per page) and props carry only what the screen shows.
- Images in lists and grids are lazy-loaded thumbnails, never the full-size file.
- Forms disable their button and say "Saving…" while a request is in flight.
- Optimistic UI only for reversible single-field changes (notes, "Mark contacted"); never for money, quotes, status moves, or accepting and declining.
- Touch targets are at least 44px, and nothing is wider than 375px.
```

- [ ] **Step 2: backend.md**

In the Tenancy bullet of `apps/platform/docs/backend.md`, replace `Login, signup and onboarding land on \`/dashboard\`, which redirects to the tenant the user opened last, else their oldest, else \`/onboarding\`.` with `Login, signup and onboarding land on \`/dashboard\`, which redirects to the tenant the user opened last, else their oldest, else \`/onboarding\`; a tenant's own address (\`/t/:tenant\`) then redirects owners to the Inbox and artists to Projects.`

- [ ] **Step 3: README**

In `README.md`, at the end of the "Commands" section, add:

```markdown

To try the installed dashboard app locally, build and run the platform for production (the service worker is off in development): `pnpm --filter @tattoo-drip/platform build`, then start the built server from `apps/platform/build` as the deployment section describes. Open it on a phone on the same network, or in Chrome's device mode, and install it from the browser menu (on iPhone: Share → Add to Home Screen).
```

- [ ] **Step 4: Commit**

```bash
git add apps/platform/docs/ui.md apps/platform/docs/backend.md README.md
git commit -m "docs(platform): document the app shell and the slow-connection rules"
```

---

### Task 8: Verification and handoff

- [ ] **Step 1: Full checks**

From `apps/platform`: `PORT=3402 node ace test` in the background (wait for the notification). From the root: `pnpm typecheck`, `pnpm check`. From `apps/platform`: `node ace codegen` then `git status --short` (no changes). Report the totals.

- [ ] **Step 2: Reviews before the PR**

The whole-branch review (fresh reviewer on the most capable model, with this plan's Review Focus), then the `codex-review` skill on `origin/main...HEAD`. Check each finding against the code, fix the confirmed ones test-first where a test can reach them, commit.

- [ ] **Step 3: Browser check (the user)**

At 375px, 768px and 1280px: the tabs or the sidebar, the Inbox badge, the account menu (theme, Log out), Settings → Artists, landing after login as an owner. With a production build: install on Android Chrome and on iPhone, open from the icon, DevTools → Network → Offline then reload (offline page), going offline with the app open (offline bar), the last row of a long list not hidden by the tab bar.

- [ ] **Step 4: Push, PR and Linear**

Push with the HTTPS command from memory and `gh pr create` (the hook asks the user); the PR lists the browser checklist. TAT-67 moves to Done on merge (the GitHub integration does it). Create the follow-up ticket "Slow-connection pass on existing pages" (thumbnails for reference images, the Decline in-flight state, optimistic notes and contact; links `apps/platform/docs/ui.md`). Post the carry-forwards: TAT-50 and TAT-41 (add their entry in `nav_items.ts` and `nav_icons.ts`; Calendar becomes the artists' second tab, which turns their tab bar on), TAT-30 (the artist pages stay at `/t/:tenant/artists`, now shown under Settings), TAT-82 (the service worker stores no pages or data; history encryption is still needed).
