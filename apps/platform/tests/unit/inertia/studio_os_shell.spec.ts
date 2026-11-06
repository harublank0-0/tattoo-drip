import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; the types below restate its shape and the inertia project type-checks the real one.
import * as crumbsModule from "../../../inertia/components/shell/breadcrumbs.js";
// @ts-expect-error TS6305: as above.
import * as navModule from "../../../inertia/components/shell/nav_items.js";
// @ts-expect-error TS6305: as above.
import * as studioModule from "../../../inertia/components/shell/studio.js";
// @ts-expect-error TS6305: as above.
import * as themeModule from "../../../inertia/components/shell/theme.js";

type Preference = "light" | "dark" | "system";
type Crumb = { label: string; href?: string };
type Section = { label: string; href: string; also?: string[] };
type Item = { key: string; label: string; place: "bar" | "more" };

const { breadcrumbs, PAGE_LABELS } = crumbsModule as {
	breadcrumbs(component: string, url: string, sections: Section[]): Crumb[];
	PAGE_LABELS: Record<string, string>;
};
const { navGroups, navItems } = navModule as {
	navGroups(items: Item[]): { key: string; label: string; items: Item[] }[];
	navItems(
		tenant: { slug: string; role: string },
		counts: { inbox: number | null; today: number | null },
	): Item[];
};
const { monogram } = studioModule as { monogram(name: string): string };
const { preferenceFromCookie, resolveTheme, themeCookie, THEME_CHOICES } =
	themeModule as {
		preferenceFromCookie(cookie: string): Preference;
		resolveTheme(preference: Preference, deviceDark: boolean): string;
		themeCookie(preference: Preference): string;
		THEME_CHOICES: { value: Preference; label: string }[];
	};

const counts = { inbox: null, today: null };

test.group("Studio OS shell: the sidebar's groups", () => {
	test("an owner sees the day's work, then the studio's set-up", ({
		assert,
	}) => {
		const groups = navGroups(navItems({ slug: "bn", role: "owner" }, counts));
		assert.deepEqual(
			groups.map(({ label, items }) => [label, items.map(({ key }) => key)]),
			[
				["Workspace", ["today", "inbox", "projects", "calendar"]],
				["Studio", ["clients", "artists", "settings"]],
			],
		);
	});

	test("an artist has no empty Studio group", ({ assert }) => {
		const groups = navGroups(navItems({ slug: "bn", role: "artist" }, counts));
		assert.deepEqual(
			groups.map(({ label }) => label),
			["Workspace"],
		);
	});
});

test.group("Studio OS shell: breadcrumbs", () => {
	const sections: Section[] = [
		{ label: "Today", href: "/t/bn/today" },
		{ label: "Inbox", href: "/t/bn/inbox" },
		{ label: "Projects", href: "/t/bn/projects" },
		{ label: "Clients", href: "/t/bn/clients" },
		{ label: "Artists", href: "/t/bn/artists" },
		{ label: "Settings", href: "/t/bn/settings" },
	];

	test("a destination's own page is one crumb, the current page", ({
		assert,
	}) => {
		assert.deepEqual(breadcrumbs("today/index", "/t/bn/today", sections), [
			{ label: "Today" },
		]);
		assert.deepEqual(
			breadcrumbs("projects/index", "/t/bn/projects?status=quoted", sections),
			[{ label: "Projects" }],
		);
	});

	test("a page below a destination links back to it, then names itself", ({
		assert,
	}) => {
		assert.deepEqual(
			breadcrumbs("projects/show", "/t/bn/projects/42", sections),
			[{ label: "Projects", href: "/t/bn/projects" }, { label: "Project" }],
		);
		assert.deepEqual(
			breadcrumbs("settings/look", "/t/bn/settings/look", sections),
			[{ label: "Settings", href: "/t/bn/settings" }, { label: "Page look" }],
		);
		assert.deepEqual(
			breadcrumbs("clients/edit", "/t/bn/clients/7/edit", sections),
			[{ label: "Clients", href: "/t/bn/clients" }, { label: "Edit client" }],
		);
	});

	test("a page under no destination the member has names itself alone", ({
		assert,
	}) => {
		// An artist has no Artists item: their own profile, and the alerts.
		const artist = sections.filter(({ label }) => label !== "Artists");
		assert.deepEqual(
			breadcrumbs("artists/form", "/t/bn/artists/mine", artist),
			[{ label: "Your artist profile" }],
		);
		assert.deepEqual(breadcrumbs("alerts/index", "/t/bn/alerts", sections), [
			{ label: "Alerts" },
		]);
		assert.deepEqual(
			breadcrumbs("errors/not_found", "/t/bn/nope", sections),
			[],
		);
	});

	test("every dashboard page below a destination has a name", ({ assert }) => {
		for (const component of [
			"inquiries/show",
			"projects/new",
			"projects/show",
			"clients/show",
			"clients/edit",
			"artists/form",
			"settings/profile",
			"settings/look",
			"settings/good_to_know",
			"settings/faq_policies",
			"settings/payments",
			"settings/payment_method_form",
			"settings/messages",
			"settings/members",
		]) {
			assert.isString(PAGE_LABELS[component], component);
		}
	});
});

test.group("Studio OS shell: the studio's monogram", () => {
	test("is the first letter of the first two words", ({ assert }) => {
		assert.equal(monogram("Black Needle"), "BN");
		assert.equal(monogram("  ink  "), "I");
		assert.equal(monogram("Lotus Ink Studio"), "LI");
	});

	test("keeps a Devanagari letter whole", ({ assert }) => {
		// "कि" is a consonant and its vowel sign: one character on screen.
		assert.equal(monogram("किरण टैटू"), "किटै");
	});
});

test.group("Studio OS shell: appearance", () => {
	test("offers light, dark and the device's setting", ({ assert }) => {
		assert.deepEqual(
			THEME_CHOICES.map(({ value }) => value),
			["light", "dark", "system"],
		);
	});

	test("reads the stored choice; anything else is the device's", ({
		assert,
	}) => {
		assert.equal(preferenceFromCookie("app_theme=dark"), "dark");
		assert.equal(preferenceFromCookie("a=1; app_theme=light; b=2"), "light");
		assert.equal(preferenceFromCookie(""), "system");
		assert.equal(preferenceFromCookie("app_theme=purple"), "system");
		assert.equal(preferenceFromCookie("my_app_theme=dark"), "system");
	});

	test("System removes the cookie; light and dark keep it a year", ({
		assert,
	}) => {
		assert.match(themeCookie("system"), /^app_theme=; path=\/; max-age=0;/);
		assert.equal(
			themeCookie("dark"),
			"app_theme=dark; path=/; max-age=31536000; samesite=lax",
		);
	});

	test("System follows the device", ({ assert }) => {
		assert.equal(resolveTheme("system", true), "dark");
		assert.equal(resolveTheme("system", false), "light");
		assert.equal(resolveTheme("light", true), "light");
		assert.equal(resolveTheme("dark", false), "dark");
	});
});
