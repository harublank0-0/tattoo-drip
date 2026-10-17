/**
 * Rules for a tenant slug (TAT-24). A slug is also the tenant's subdomain,
 * so it is a lowercase DNS label, and it shares one namespace with the
 * platform's own hosts and pages. Onboarding and the settings page check new
 * slugs with checkSlug; the public API (TAT-32) uses the same rules. Never
 * copy RESERVED_SLUGS elsewhere.
 */

/**
 * The most slugs one tenant can hold, its current one included. Every slug a
 * tenant has used stays its own for good (tenant_slugs), so this bounds how
 * many names one tenant can take out of the namespace by renaming.
 */
export const MAX_TENANT_SLUGS = 5;

/** Hostnames and infrastructure, now or later. */
const HOSTS = [
	"www",
	"www1",
	"www2",
	"www3",
	"app",
	"apps",
	"api",
	"apis",
	"admin",
	"administrator",
	"alpha",
	"assets",
	"auth",
	"autoconfig",
	"autodiscover",
	"beta",
	"canary",
	"cdn",
	"console",
	"dashboard",
	"demo",
	"dev",
	"dns",
	"docs",
	"edge",
	"email",
	"files",
	"ftp",
	"gateway",
	"git",
	"graphql",
	"health",
	"imap",
	"images",
	"img",
	"internal",
	"intranet",
	"localhost",
	"mail",
	"media",
	"metrics",
	"monitoring",
	"mta-sts",
	"ns1",
	"ns2",
	"ns3",
	"origin",
	"pop",
	"pop3",
	"portal",
	"preview",
	"prod",
	"production",
	"proxy",
	"sandbox",
	"sftp",
	"smtp",
	"ssh",
	"sso",
	"stage",
	"staging",
	"static",
	"status",
	"storage",
	"test",
	"testing",
	"uploads",
	"vpn",
	"webhooks",
	"webmail",
	"wpad",
];

/** The platform's pages and path words. */
const PAGES = [
	"about",
	"account",
	"accounts",
	"artists",
	"blog",
	"book",
	"booking",
	"bookings",
	"calendar",
	"careers",
	"clients",
	"contact",
	"deposit",
	"deposits",
	"explore",
	"features",
	"home",
	"inbox",
	"inquiries",
	"inquiry",
	"invite",
	"invites",
	"jobs",
	"join",
	"legal",
	"login",
	"logout",
	"news",
	"onboarding",
	"password",
	"press",
	"pricing",
	"privacy",
	"profile",
	"projects",
	"quote",
	"quotes",
	"register",
	"reset",
	"search",
	"sessions",
	"settings",
	"shop",
	"signin",
	"signout",
	"signup",
	"sitemap",
	"store",
	"storefront",
	"studio",
	"studios",
	"terms",
	"verify",
];

/** Words a phishing page would want as its address. */
const TRUST = [
	"abuse",
	"bank",
	"billing",
	"checkout",
	"compliance",
	"help",
	"helpdesk",
	"hostmaster",
	"info",
	"invoice",
	"invoices",
	"moderator",
	"no-reply",
	"noreply",
	"official",
	"owner",
	"pay",
	"payment",
	"payments",
	"postmaster",
	"refund",
	"refunds",
	"root",
	"safety",
	"secure",
	"security",
	"staff",
	"support",
	"system",
	"team",
	"trust",
	"wallet",
	"webmaster",
];

/**
 * What a template bug puts in a URL (`/t/${undefined}`), so such a bug never
 * opens a real studio.
 */
const ACCIDENTS = ["false", "nan", "none", "null", "true", "undefined"];

/** Names no tenant can take. Compared with the normalized slug. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	...HOSTS,
	...PAGES,
	...TRUST,
	...ACCIDENTS,
]);

/** The platform's own name; refused anywhere in a slug, hyphens ignored. */
const BRAND = "tattoodrip";

/** What may be typed: ASCII letters in any case, digits and hyphens. */
const TYPED = /^[A-Za-z0-9-]+$/;

/** A DNS label: 3 to 63 characters, no hyphen at either end. */
const SHAPE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export type SlugProblem = "format" | "reserved";

export type SlugCheck =
	| { ok: true; slug: string }
	| { ok: false; problem: SlugProblem };

/**
 * Checks a slug a person chose and gives it in its stored form. Anything but
 * ASCII letters, digits and hyphens is refused before lowercasing, because
 * Unicode case mapping turns lookalikes into letters (the Kelvin sign
 * U+212A becomes "k"). No two hyphens in a row: that also refuses `xn--`
 * labels, which browsers show as Unicode. At least one letter, so a slug is
 * never all digits. Does not trim: the validator does.
 */
export function checkSlug(input: string): SlugCheck {
	if (!TYPED.test(input)) return { ok: false, problem: "format" };
	const slug = input.toLowerCase();
	if (!SHAPE.test(slug) || slug.includes("--") || !/[a-z]/.test(slug)) {
		return { ok: false, problem: "format" };
	}
	if (RESERVED_SLUGS.has(slug) || slug.replaceAll("-", "").includes(BRAND)) {
		return { ok: false, problem: "reserved" };
	}
	return { ok: true, slug };
}
