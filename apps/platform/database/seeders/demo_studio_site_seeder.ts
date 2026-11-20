import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import { BaseSeeder } from "@adonisjs/lucid/seeders";
import type { QueryClientContract } from "@adonisjs/lucid/types/database";
import { DateTime } from "luxon";
import sharp from "sharp";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import {
	MAX_ARTIST_STYLES,
	MAX_PHOTO_STYLES,
	type StyleSlug,
} from "#modules/artists/styles";
import FlashDesign from "#modules/flash/models/flash_design";
import ImageService from "#modules/media/services/image_service";
import PackageGate from "#modules/packages/services/package_gate";
import { todayIn } from "#modules/projects/quotes";
import StudioClosure from "#modules/scheduling/models/studio_closure";
import StudioHour from "#modules/scheduling/models/studio_hour";
import Tenant from "#modules/tenancy/models/tenant";
import { withDbContext } from "#services/db_context";
import { studioLinks } from "#services/studio_links";

/** A visible-artists target: a studio with fewer gets the demo artists below, within its package's artist limit. */
const WANTED_ARTISTS = 3;
/** Lead photos a visible artist has after the seed (the dashboard allows 100). */
const WANTED_PHOTOS = 8;
/** Designs an artist with none gets. */
const FLASH_PER_ARTIST = 6;
/** The chat number of a studio with none (WhatsApp and Viber links use it). */
const DEMO_PHONE = "+9779800000010";

type Db = QueryClientContract;

type DemoArtist = {
	slug: string;
	name: string;
	bio: string;
	styles: readonly StyleSlug[];
	instagramUrl: string;
	facebookUrl: string | null;
	acceptingInquiries: boolean;
	closedMessage: string | null;
};

const DEMO_ARTISTS: readonly DemoArtist[] = [
	{
		slug: "sita-rai",
		name: "Sita Rai",
		bio: "Fine line and minimal pieces, with a soft spot for small lettering. Happy to talk through placement before you book.",
		styles: ["fine-line", "minimal", "lettering"],
		instagramUrl: "https://www.instagram.com/demo.sita.rai",
		facebookUrl: null,
		acceptingInquiries: true,
		closedMessage: null,
	},
	{
		slug: "arjun-thapa",
		name: "अर्जुन थापा",
		bio: "Black and grey realism and portraits. Please bring a clear reference photo; bigger pieces take more than one session.",
		styles: ["realism", "black-and-grey", "portrait"],
		instagramUrl: "https://www.instagram.com/demo.arjun.thapa",
		facebookUrl: "https://www.facebook.com/demo.arjun.thapa",
		acceptingInquiries: true,
		closedMessage: null,
	},
	{
		slug: "maya-gurung",
		name: "Maya Gurung",
		bio: "Traditional and neo-traditional work in bold colour. Books are closed for now, but my flash designs are still open.",
		styles: ["traditional", "neo-traditional", "colour"],
		instagramUrl: "https://www.instagram.com/demo.maya.gurung",
		facebookUrl: null,
		acceptingInquiries: false,
		closedMessage:
			"Books are closed for now. You can still ask for one of my flash designs.",
	},
];

/** Styles for an existing artist who has none: two or three, by position. */
const FILL_STYLES: readonly (readonly StyleSlug[])[] = [
	["fine-line", "minimal"],
	["black-and-grey", "realism", "portrait"],
	["traditional", "colour"],
	["japanese", "blackwork", "geometric"],
];

const FILL_BIO =
	"Takes bookings for custom pieces and flash. Tell us the size and where you want it when you send a request.";

const WALK_INS =
	"Walk-ins are welcome for small pieces when an artist is free. For anything bigger, send a request first so we can set aside the time.";
const AGE_RULE =
	"You must be 18 or older. Bring your citizenship card, passport or driving licence.";
const BEFORE_SESSION =
	"Eat a proper meal and drink water before you come. Skip alcohol for 24 hours before. Wear loose clothes that let us reach the spot easily, and bring a power bank if your session is long. If you are unwell, message us and we will move your time.";
const AFTERCARE =
	"Leave the wrap on for the first few hours. Then wash gently with plain water and unscented soap, pat dry and put on a thin layer of the ointment we suggest. For about two weeks keep the tattoo out of the sun, dust, swimming pools and tight clothes. Do not pick or scratch it. Message us if it looks very red or swollen.";
const DEPOSIT_POLICY =
	"A deposit holds your session time and is taken off the final price. Pay it by eSewa, Khalti or bank transfer and send us the screenshot.";

/** The studio columns the seed fills when empty: [model field, column, text]. */
const STUDIO_FILLS = [
	["walkInsText", "walk_ins_text", WALK_INS],
	["ageRuleText", "age_rule_text", AGE_RULE],
	["beforeSessionText", "before_session_text", BEFORE_SESSION],
	["aftercareText", "aftercare_text", AFTERCARE],
	["contactPhone", "contact_phone", DEMO_PHONE],
	["depositPolicy", "deposit_policy", DEPOSIT_POLICY],
] as const;

/**
 * Development only: gives every studio a website worth looking at, whatever
 * else it has: up to three visible artists (never past its package's artist
 * limit, so a Solo studio has one; a paused studio is still topped up, as
 * the limit is the package's shape and pausing is a billing state), eight
 * work photos per visible artist and six flash designs for each who has
 * none (generated line-art pictures stored like real uploads, with their
 * 320/640/1280 px copies), opening hours, an upcoming two-day closure, and
 * the Good to know texts, chat number and deposit policy when they are
 * empty. Existing artists keep their names, flags and visibility; only
 * empty fields are filled. Each step looks at what the studio already has,
 * so a second run adds nothing, except a new closure once the last one has
 * passed. Run as the owner role, which row-level security does not apply
 * to: `pnpm seed:dev`.
 */
export default class DemoStudioSiteSeeder extends BaseSeeder {
	static environment = ["development"];

	/** The studios to seed: every live one. A test narrows it to its own. */
	protected async studios(): Promise<Tenant[]> {
		return Tenant.query({ client: this.client }).orderBy("slug");
	}

	async run() {
		const images = new ImageService();
		const gate = await app.container.make(PackageGate);
		for (const tenant of await this.studios()) {
			const added = await seedStudio(tenant, this.client, { images, gate });
			logger.info(
				`${studioLinks(tenant.slug).url}: ${plural(added.artists, "artist")}, ${plural(added.photos, "photo")} and ${plural(added.flash, "flash design")} added (/work, /flash, /artists/<slug>)`,
			);
		}
	}
}

const plural = (total: number, noun: string) =>
	`${total} ${noun}${total === 1 ? "" : "s"}`;

async function seedStudio(
	tenant: Tenant,
	client: Db,
	{ images, gate }: { images: ImageService; gate: PackageGate },
) {
	// Writes pass `{ connection }`, not `{ client }`: a model instance keeps
	// only a transaction client, so a plain `{ client }` would silently
	// write as the app role and fail row-level security. Queries
	// (`Model.query({ client })`) do honor the client.
	const write = { connection: client.connectionName };
	const added = { artists: 0, photos: 0, flash: 0 };

	// Artists: top the studio up to three visible ones, skipping a demo artist
	// whose slug or name a live artist (hidden ones too) already has, and
	// adding none past the package's limit. The limit counts active artists,
	// hidden ones included, by the dashboard's own rule (PackageGate).
	const live = await Artist.query({ client }).where("tenant_id", tenant.id);
	let visible = live.filter((artist) => artist.visible).length;
	const usage = await withDbContext({ tenantId: tenant.id }, () =>
		gate.artistUsage(tenant),
	);
	let room =
		usage.limit === null
			? Number.POSITIVE_INFINITY
			: usage.limit - usage.active;
	for (const demo of DEMO_ARTISTS) {
		if (visible >= WANTED_ARTISTS || room <= 0) break;
		const taken = live.some(
			(artist) =>
				artist.slug === demo.slug ||
				artist.name.toLowerCase() === demo.name.toLowerCase(),
		);
		if (taken) continue;
		await Artist.create(
			{
				tenantId: tenant.id,
				slug: demo.slug,
				name: demo.name,
				bio: demo.bio,
				visible: true,
				acceptingInquiries: demo.acceptingInquiries,
				acceptingFlash: true,
				closedMessage: demo.closedMessage,
				styles: demo.styles.slice(0, MAX_ARTIST_STYLES),
				instagramUrl: demo.instagramUrl,
				facebookUrl: demo.facebookUrl,
			},
			write,
		);
		visible++;
		room--;
		added.artists++;
	}

	// Every visible artist (ArtistService.listVisible's order): empty fields
	// filled, then photos and designs.
	const shown = await Artist.query({ client })
		.where("tenant_id", tenant.id)
		.where("visible", true)
		.orderByRaw("lower(name) asc")
		.orderBy("id", "asc");
	for (const [index, artist] of shown.entries()) {
		const styles = await fillProfile(artist, index, client);
		added.photos += await addWorkPhotos(
			{ tenant, artist, styles, index },
			client,
			write,
			images,
		);
		added.flash += await addFlash(
			{ tenant, artist, index },
			client,
			write,
			images,
		);
	}

	await seedHours(tenant, client, write);
	await fillStudio(tenant, client);
	return added;
}

/** Fills an existing artist's empty styles and bio; returns the styles they now have. */
async function fillProfile(artist: Artist, index: number, client: Db) {
	const fill: { styles?: StyleSlug[]; bio?: string } = {};
	if (artist.styles.length === 0) {
		fill.styles = [...FILL_STYLES[index % FILL_STYLES.length]];
	}
	if ((artist.bio ?? "").trim() === "") fill.bio = FILL_BIO;
	if (Object.keys(fill).length > 0) {
		await Artist.query({ client })
			.where("tenant_id", artist.tenantId)
			.where("id", artist.id)
			.update({ ...fill, updated_at: new Date() });
	}
	return (fill.styles ?? artist.styles) as readonly StyleSlug[];
}

type ArtistJob = { tenant: Tenant; artist: Artist; index: number };
type Write = { connection: string };

/** Work photos: a portrait, landscape and square mix, 1-3 styles each, a third healed, spread over months. */
async function addWorkPhotos(
	job: ArtistJob & { styles: readonly StyleSlug[] },
	client: Db,
	write: Write,
	images: ImageService,
) {
	const { tenant, artist, styles, index } = job;
	const have = (
		await ArtistWorkPhoto.query({ client })
			.where("tenant_id", tenant.id)
			.where("artist_id", artist.id)
			.whereNull("lead_photo_id")
			.select("id")
	).length;
	const now = DateTime.now();
	for (let n = have; n < WANTED_PHOTOS; n++) {
		const seed = hashOf(`${artist.slug}/photo/${n}`);
		const look = PHOTO_LOOKS[(n + index * 3) % PHOTO_LOOKS.length];
		const { width, height } = PHOTO_SHAPES[n % PHOTO_SHAPES.length];
		const bytes = await draw(look.motif, {
			width,
			height,
			background: SKIN[(n + index) % SKIN.length],
			stroke: 6 + (seed % 3),
			seed,
		});
		const stored = await images.storeBytes(bytes, {
			tenant,
			purpose: "artist_work_photo",
		});
		const count =
			styles.length === 0
				? 0
				: 1 + (n % Math.min(MAX_PHOTO_STYLES, styles.length));
		await ArtistWorkPhoto.create(
			{
				tenantId: tenant.id,
				artistId: artist.id,
				imageKey: stored.key,
				width: stored.width,
				height: stored.height,
				alt: look.alt,
				styles: Array.from(
					{ length: count },
					(_, k) => styles[(n + k) % styles.length],
				),
				healed: n % 3 === 1,
				// Newest first: each photo is about twelve days older than the last.
				createdAt: now.minus({
					days: 6 + n * 12 + (seed % 5),
					// Unsigned: a seed is up to 2^32, and `>>` would make it negative.
					hours: (seed >>> 3) % 24,
				}),
			},
			write,
		);
	}
	return Math.max(0, WANTED_PHOTOS - have);
}

const SIZES = [
	"About 3 in",
	"Palm-sized",
	"About 4 in",
	"About 2 in",
	"About 5 in",
	"Hand-sized",
];

/** Six designs for an artist who has none: about half priced, two one of a kind, none hidden. */
async function addFlash(
	job: ArtistJob,
	client: Db,
	write: Write,
	images: ImageService,
) {
	const { tenant, artist, index } = job;
	const have = await FlashDesign.query({ client })
		.where("tenant_id", tenant.id)
		.where("artist_id", artist.id)
		.first();
	if (have) return 0;
	const now = DateTime.now();
	for (let i = 0; i < FLASH_PER_ARTIST; i++) {
		const seed = hashOf(`${artist.slug}/flash/${i}`);
		const look = FLASH_LOOKS[(index * 2 + i) % FLASH_LOOKS.length];
		const { width, height } = FLASH_SHAPES[i % FLASH_SHAPES.length];
		const bytes = await draw(look.motif, {
			width,
			height,
			background: PAPER[(i + index) % PAPER.length],
			stroke: 7,
			seed,
		});
		const stored = await images.storeBytes(bytes, {
			tenant,
			purpose: "flash_design",
		});
		await FlashDesign.create(
			{
				tenantId: tenant.id,
				artistId: artist.id,
				imageKey: stored.key,
				width: stored.width,
				height: stored.height,
				name: look.name,
				size: SIZES[(i + index) % SIZES.length],
				// Paisa: NPR 4,000 to 12,000 in steps of 500, on every other design.
				price:
					i % 2 === 0 ? (4000 + 500 * ((i * 3 + index * 5) % 17)) * 100 : null,
				currency: "NPR",
				hidden: false,
				oneOfAKind: i % 3 === 1,
				createdAt: now.minus({ days: i * 3 + index, hours: seed % 24 }),
			},
			write,
		);
	}
	return FLASH_PER_ARTIST;
}

/** Opening hours for a studio with none, and a two-day closure when none is upcoming; the studio's own timezone decides "today". */
async function seedHours(tenant: Tenant, client: Db, write: Write) {
	const hasHours = await StudioHour.query({ client })
		.where("tenant_id", tenant.id)
		.first();
	if (!hasHours) {
		// Sunday (0) to Friday (5); Saturday has no row, which means closed.
		for (let weekday = 0; weekday <= 5; weekday++) {
			await StudioHour.create(
				{ tenantId: tenant.id, weekday, opensAt: "11:00", closesAt: "19:00" },
				write,
			);
		}
	}

	const today = todayIn(tenant.timezone);
	const upcoming = await StudioClosure.query({ client })
		.where("tenant_id", tenant.id)
		.where("ends_on", ">=", today)
		.first();
	if (!upcoming) {
		const first = DateTime.fromISO(today).plus({ days: 5 });
		await StudioClosure.create(
			{
				tenantId: tenant.id,
				startsOn: first,
				endsOn: first.plus({ days: 1 }),
				note: "Closed for a holiday, back soon",
			},
			write,
		);
	}
}

/** Good to know texts, the chat number and the deposit policy, each only when empty. */
async function fillStudio(tenant: Tenant, client: Db) {
	const fill: Record<string, string> = {};
	for (const [field, column, text] of STUDIO_FILLS) {
		if ((tenant[field] ?? "").trim() === "") fill[column] = text;
	}
	if (Object.keys(fill).length === 0) return;
	await Tenant.query({ client })
		.where("id", tenant.id)
		.update({ ...fill, updated_at: new Date() });
}

// --- Generated pictures -----------------------------------------------------
//
// Black line art on a warm skin or paper tone, drawn as SVG and rendered by
// sharp (no fonts, no text). A picture is a motif plus a seed, so a run
// draws the same pictures again.

const INK = "#161210";
const SKIN = ["#ecc9a6", "#dfae86", "#f2d7bd", "#cf9a73", "#e6bf9d"];
const PAPER = ["#f5eddd", "#efe5d0", "#f8f2e6"];

/** Pictures are at most 1400 px on the long edge: wide enough for the 1280 px copy of a landscape or square one. */
const PHOTO_SHAPES = [
	{ width: 1400, height: 1050 },
	{ width: 1050, height: 1400 },
	{ width: 1400, height: 1400 },
	{ width: 1400, height: 934 },
	{ width: 934, height: 1400 },
	{ width: 1400, height: 1400 },
	{ width: 1050, height: 1400 },
	{ width: 1400, height: 1050 },
];
const FLASH_SHAPES = [
	{ width: 1400, height: 1400 },
	{ width: 1120, height: 1400 },
	{ width: 1400, height: 1400 },
	{ width: 1400, height: 1120 },
	{ width: 1400, height: 1400 },
	{ width: 1120, height: 1400 },
];

/** Draws a motif's shapes on a w x h canvas; `bg` is the ground's colour, for shapes that need to cut into the line work. */
type Motif = (w: number, h: number, rnd: () => number, bg: string) => string;

/** A small, fast, seedable random number generator (mulberry32). */
function rng(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** FNV-1a, so a name gives the same seed every run. */
function hashOf(text: string) {
	let hash = 0x811c9dc5;
	for (const char of text) {
		hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
	}
	return hash;
}

async function draw(
	motif: Motif,
	options: {
		width: number;
		height: number;
		background: string;
		stroke: number;
		seed: number;
	},
): Promise<Buffer> {
	const { width, height, background, stroke, seed } = options;
	const shapes = motif(width, height, rng(seed), background);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><radialGradient id="shade" cx="50%" cy="45%" r="75%"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.16"/></radialGradient></defs>
<rect width="100%" height="100%" fill="${background}"/>
<rect width="100%" height="100%" fill="url(#shade)"/>
<g fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>
</svg>`;
	return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

const n = (value: number) => Math.round(value * 10) / 10;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

const circle = (cx: number, cy: number, r: number) =>
	`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`;
/** A filled dot: ink, or `colour` to cut a highlight into a filled shape. */
const dot = (cx: number, cy: number, r: number, colour = INK) =>
	`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${colour}" stroke="none"/>`;
const path = (d: string, filled = false) =>
	`<path d="${d}"${filled ? ` fill="${INK}"` : ""}/>`;
const turned = (degrees: number, cx: number, cy: number, inner: string) =>
	`<g transform="rotate(${n(degrees)} ${n(cx)} ${n(cy)})">${inner}</g>`;
const polygon = (points: [number, number][]) =>
	`<polygon points="${points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}"/>`;
const mirrored = (w: number, inner: string) =>
	`${inner}<g transform="translate(${w} 0) scale(-1 1)">${inner}</g>`;

/** A star with `points` tips, the first pointing up unless `from` says otherwise. */
function star(
	cx: number,
	cy: number,
	outer: number,
	inner: number,
	points: number,
	from = -90,
): [number, number][] {
	return Array.from({ length: points * 2 }, (_, i) => {
		const angle = rad(from + (180 / points) * i);
		const r = i % 2 === 0 ? outer : inner;
		return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
	});
}

/** The canvas's centre, its short side and `at(x, y)`, a point in tenths of that side from the centre. */
function frame(w: number, h: number) {
	const cx = w / 2;
	const cy = h / 2;
	const s = Math.min(w, h);
	return {
		cx,
		cy,
		s,
		at: (x: number, y: number) => `${n(cx + x * s)} ${n(cy + y * s)}`,
	};
}

const mandala: Motif = (w, h, rnd) => {
	const { cx, cy, s } = frame(w, h);
	const r = s * 0.4;
	const petals = 8 + 2 * Math.floor(rnd() * 3);
	let out = [1, 0.86, 0.5, 0.12].map((k) => circle(cx, cy, r * k)).join("");
	for (let i = 0; i < petals; i++) {
		const top = (k: number) => `${n(cx)} ${n(cy - r * k)}`;
		const side = (k: number, bulge: number) =>
			`${n(cx + r * bulge)} ${n(cy - r * k)}`;
		out += turned(
			(360 / petals) * i,
			cx,
			cy,
			path(
				`M${top(0.5)}Q${side(0.66, 0.22)} ${top(0.86)}Q${side(0.66, -0.22)} ${top(0.5)}Z`,
			) +
				path(`M${top(0.12)}L${top(0.5)}`) +
				dot(cx, cy - r * 0.93, r * 0.025),
		);
	}
	return out;
};

const waves: Motif = (w, h, rnd) => {
	const { s } = frame(w, h);
	const amp = 22 + rnd() * 14;
	const run = 110 + rnd() * 40;
	let out =
		circle(w * 0.68, h * 0.24, s * 0.11) + circle(w * 0.68, h * 0.24, s * 0.07);
	for (let i = 0; i < 7; i++) {
		const y = h * 0.42 + i * h * 0.075;
		const x = i % 2 === 0 ? -run * 0.5 : 0;
		const repeats = Array.from(
			{ length: Math.ceil(w / run) + 2 },
			() => `t${n(run)} 0`,
		).join(" ");
		out += path(
			`M${n(x)} ${n(y)}q${n(run / 2)} ${n(-amp)} ${n(run)} 0 ${repeats}`,
		);
	}
	return out;
};

const stars: Motif = (w, h) => {
	const { cx, cy, s } = frame(w, h);
	let out =
		polygon(star(cx, cy, s * 0.38, s * 0.14, 8)) +
		polygon(star(cx, cy, s * 0.2, s * 0.08, 8, -67.5)) +
		circle(cx, cy, s * 0.42) +
		dot(cx, cy, s * 0.04);
	for (const [x, y] of [
		[0.18, 0.2],
		[0.82, 0.2],
		[0.18, 0.8],
		[0.82, 0.8],
	]) {
		out += polygon(star(w * x, h * y, s * 0.07, s * 0.025, 4));
	}
	return out;
};

const lines: Motif = (w, h, rnd) => {
	const { cx, cy, s } = frame(w, h);
	let out = "";
	for (let i = 0; i < 7; i++) {
		const y = h * (0.22 + i * 0.09);
		const bend = (rnd() - 0.5) * h * 0.2;
		out += path(
			`M${n(w * 0.14)} ${n(y)}C${n(w * 0.38)} ${n(y + bend)} ${n(w * 0.62)} ${n(y - bend)} ${n(w * 0.86)} ${n(y)}`,
		);
	}
	return out + circle(cx, cy, s * 0.09) + dot(cx, cy, s * 0.02);
};

const dots: Motif = (w, h) => {
	const { cx, cy, s } = frame(w, h);
	const r = s * 0.4;
	const step = r / 9;
	let out = circle(cx, cy, r * 1.1);
	for (let row = 0; cy - r + row * step <= cy + r; row++) {
		const y = cy - r + row * step;
		for (let x = cx - r + (row % 2) * (step / 2); x <= cx + r; x += step) {
			const d = Math.hypot(x - cx, y - cy);
			if (d <= r) out += dot(x, y, step * 0.4 * (1 - (d / r) * 0.85) + 1.5);
		}
	}
	return out;
};

const geometric: Motif = (w, h) => {
	const { cx, cy, s } = frame(w, h);
	let out = "";
	for (let i = 0; i < 6; i++) {
		const side = s * (0.72 - i * 0.1);
		out += turned(
			i * 15,
			cx,
			cy,
			`<rect x="${n(cx - side / 2)}" y="${n(cy - side / 2)}" width="${n(side)}" height="${n(side)}"/>`,
		);
	}
	return (
		out +
		polygon(star(cx, cy, s * 0.2, s * 0.2, 3)) +
		circle(cx, cy, s * 0.2) +
		dot(cx, cy, s * 0.04)
	);
};

const mountain: Motif = (w, h) => {
	const { s } = frame(w, h);
	const p = (x: number, y: number) => `${n(w * x)} ${n(h * y)}`;
	let out =
		path(
			`M${p(0.12, 0.72)}L${p(0.34, 0.4)}L${p(0.46, 0.56)}L${p(0.64, 0.28)}L${p(0.88, 0.72)}Z`,
		) +
		path(`M${p(0.64, 0.28)}L${p(0.6, 0.48)}L${p(0.66, 0.72)}`) +
		path(`M${p(0.34, 0.4)}L${p(0.31, 0.56)}L${p(0.34, 0.72)}`) +
		circle(w * 0.3, h * 0.22, s * 0.07) +
		path(
			`M${p(0.12, 0.8)}q${n(w * 0.06)} ${n(-h * 0.02)} ${n(w * 0.12)} 0t${n(w * 0.12)} 0 t${n(w * 0.12)} 0 t${n(w * 0.12)} 0 t${n(w * 0.12)} 0 t${n(w * 0.12)} 0`,
		);
	for (let i = 0; i < 12; i++) {
		const angle = rad(i * 30);
		const x = w * 0.3;
		const y = h * 0.22;
		out += path(
			`M${n(x + Math.cos(angle) * s * 0.1)} ${n(y + Math.sin(angle) * s * 0.1)}L${n(x + Math.cos(angle) * s * 0.145)} ${n(y + Math.sin(angle) * s * 0.145)}`,
		);
	}
	return out;
};

const lotus: Motif = (w, h) => {
	const { cx, s } = frame(w, h);
	const base = h * 0.64;
	const reach = s * 0.36;
	const petal = (angle: number, len: number, wid: number) =>
		turned(
			angle,
			cx,
			base,
			path(
				`M${n(cx)} ${n(base)}C${n(cx + wid)} ${n(base - len * 0.3)} ${n(cx + wid)} ${n(base - len * 0.75)} ${n(cx)} ${n(base - len)}C${n(cx - wid)} ${n(base - len * 0.75)} ${n(cx - wid)} ${n(base - len * 0.3)} ${n(cx)} ${n(base)}Z`,
			),
		);
	let out =
		petal(-72, reach * 0.8, reach * 0.2) +
		petal(72, reach * 0.8, reach * 0.2) +
		petal(-38, reach * 0.95, reach * 0.22) +
		petal(38, reach * 0.95, reach * 0.22) +
		petal(0, reach * 1.1, reach * 0.24);
	for (let i = 0; i < 3; i++) {
		const y = base + reach * (0.14 + i * 0.1);
		const half = reach * (0.7 - i * 0.12);
		out += path(
			`M${n(cx - half)} ${n(y)}q${n(half / 4)} ${n(-reach * 0.06)} ${n(half / 2)} 0t${n(half / 2)} 0 t${n(half / 2)} 0 t${n(half / 2)} 0`,
		);
	}
	return out;
};

const moth: Motif = (w, h) => {
	const { s, at } = frame(w, h);
	const upper = path(
		`M${at(-0.03, -0.07)}C${at(-0.14, -0.34)} ${at(-0.42, -0.28)} ${at(-0.4, -0.04)}C${at(-0.39, 0.06)} ${at(-0.17, 0.07)} ${at(-0.03, 0.03)}`,
	);
	const lower = path(
		`M${at(-0.03, 0.04)}C${at(-0.25, 0.05)} ${at(-0.31, 0.3)} ${at(-0.19, 0.32)}C${at(-0.09, 0.33)} ${at(-0.04, 0.2)} ${at(-0.03, 0.09)}`,
	);
	const marks =
		circle(w / 2 - s * 0.24, h / 2 - s * 0.1, s * 0.05) +
		circle(w / 2 - s * 0.2, h / 2 + s * 0.22, s * 0.03) +
		path(`M${at(-0.05, -0.04)}L${at(-0.3, -0.16)}`) +
		path(`M${at(-0.05, 0)}L${at(-0.33, -0.01)}`);
	const body =
		path(
			`M${at(0, -0.18)}C${at(0.035, -0.1)} ${at(0.03, 0.1)} ${at(0, 0.24)}C${at(-0.03, 0.1)} ${at(-0.035, -0.1)} ${at(0, -0.18)}Z`,
		) +
		circle(w / 2, h / 2 - s * 0.21, s * 0.025) +
		path(
			`M${at(-0.01, -0.23)}C${at(-0.04, -0.33)} ${at(-0.1, -0.36)} ${at(-0.15, -0.35)}`,
		) +
		path(
			`M${at(0.01, -0.23)}C${at(0.04, -0.33)} ${at(0.1, -0.36)} ${at(0.15, -0.35)}`,
		);
	return mirrored(w, upper + lower + marks) + body;
};

const dagger: Motif = (w, h) => {
	const { s, at, cx, cy } = frame(w, h);
	const roseY = cy + s * 0.3;
	const roseR = s * 0.11;
	let rose = "";
	for (const [k, dx] of [
		[1, 0],
		[0.72, 0.012],
		[0.46, -0.01],
		[0.22, 0.005],
	] as const) {
		rose += circle(cx + dx * s, roseY - (1 - k) * roseR * 0.2, roseR * k);
	}
	rose +=
		path(
			`M${at(-0.1, 0.27)}Q${at(-0.22, 0.2)} ${at(-0.27, 0.31)}Q${at(-0.18, 0.4)} ${at(-0.1, 0.32)}`,
		) +
		path(
			`M${at(0.1, 0.27)}Q${at(0.22, 0.2)} ${at(0.27, 0.31)}Q${at(0.18, 0.4)} ${at(0.1, 0.32)}`,
		);
	return (
		path(
			`M${at(0, -0.42)}L${at(0.05, -0.12)}L${at(0.05, 0)}L${at(-0.05, 0)}L${at(-0.05, -0.12)}Z`,
		) +
		path(`M${at(0, -0.37)}L${at(0, -0.02)}`) +
		path(`M${at(-0.17, 0)}L${at(0.17, 0)}`) +
		dot(cx - s * 0.17, cy, s * 0.018) +
		dot(cx + s * 0.17, cy, s * 0.018) +
		path(
			`M${at(-0.025, 0)}L${at(-0.025, 0.12)}M${at(0.025, 0)}L${at(0.025, 0.12)}`,
		) +
		path(
			`M${at(-0.025, 0.04)}L${at(0.025, 0.04)}M${at(-0.025, 0.08)}L${at(0.025, 0.08)}`,
		) +
		circle(cx, cy + s * 0.15, s * 0.03) +
		rose
	);
};

const snake: Motif = (w, h, _rnd, bg) => {
	const { s, at, cx, cy } = frame(w, h);
	const body = `M${at(-0.32, 0.36)}C${at(-0.5, 0.14)} ${at(-0.14, 0.16)} ${at(0, 0.05)}C${at(0.16, -0.06)} ${at(0.44, 0.08)} ${at(0.34, -0.14)}C${at(0.26, -0.32)} ${at(-0.1, -0.2)} ${at(-0.07, -0.34)}`;
	return (
		`<path d="${body}" stroke-width="${n(s * 0.075)}"/>` +
		`<path d="${body}" stroke="${bg}" stroke-width="${n(s * 0.062)}"/>` +
		`<path d="${body}" stroke-width="${n(s * 0.05)}" stroke-dasharray="3 ${n(s * 0.03)}" stroke-linecap="butt"/>` +
		path(
			`M${at(-0.07, -0.34)}C${at(-0.1, -0.4)} ${at(-0.02, -0.43)} ${at(0.02, -0.4)}C${at(0.05, -0.37)} ${at(0.03, -0.33)} ${at(-0.01, -0.33)}Z`,
			true,
		) +
		dot(cx + s * 0.005, cy - s * 0.385, s * 0.008, bg) +
		path(
			`M${at(0.03, -0.38)}L${at(0.09, -0.4)}L${at(0.12, -0.42)}M${at(0.09, -0.4)}L${at(0.12, -0.38)}`,
		)
	);
};

const swallow: Motif = (w, h) => {
	const { s, at, cx, cy } = frame(w, h);
	const wing =
		path(
			`M${at(-0.04, -0.08)}C${at(-0.2, -0.2)} ${at(-0.38, -0.18)} ${at(-0.46, -0.3)}C${at(-0.4, -0.08)} ${at(-0.3, 0.04)} ${at(-0.04, 0.06)}`,
		) +
		path(`M${at(-0.1, -0.04)}L${at(-0.36, -0.2)}`) +
		path(`M${at(-0.1, 0)}L${at(-0.35, -0.09)}`) +
		path(`M${at(-0.1, 0.04)}L${at(-0.3, 0)}`);
	return (
		mirrored(w, wing) +
		path(
			`M${at(0, -0.2)}C${at(0.06, -0.1)} ${at(0.05, 0.12)} ${at(0, 0.2)}C${at(-0.05, 0.12)} ${at(-0.06, -0.1)} ${at(0, -0.2)}Z`,
		) +
		circle(cx, cy - s * 0.23, s * 0.035) +
		path(`M${at(-0.012, -0.262)}L${at(0, -0.3)}L${at(0.012, -0.262)}`) +
		path(
			`M${at(-0.03, 0.18)}L${at(-0.11, 0.4)}L${at(-0.015, 0.32)}L${at(0, 0.37)}L${at(0.015, 0.32)}L${at(0.11, 0.4)}L${at(0.03, 0.18)}`,
		)
	);
};

const moon: Motif = (w, h) => {
	const { s, at, cx, cy } = frame(w, h);
	// Two arcs through the same two tips: the outer a large one, the inner a small one.
	let out = path(
		`M${at(0.12, -0.34)}A${n(s * 0.35)} ${n(s * 0.35)} 0 1 0 ${at(0.12, 0.34)}A${n(s * 0.42)} ${n(s * 0.42)} 0 0 1 ${at(0.12, -0.34)}Z`,
	);
	for (const [x, y, size] of [
		[0.26, -0.2, 0.06],
		[0.34, 0.06, 0.04],
		[0.22, 0.26, 0.05],
	] as const) {
		out += polygon(star(cx + x * s, cy + y * s, s * size, s * size * 0.35, 4));
	}
	return out + dot(cx + s * 0.3, cy - s * 0.04, s * 0.012);
};

const eye: Motif = (w, h, _rnd, bg) => {
	const { s, at, cx, cy } = frame(w, h);
	let out =
		path(
			`M${at(-0.38, 0)}Q${at(0, -0.34)} ${at(0.38, 0)}Q${at(0, 0.34)} ${at(-0.38, 0)}Z`,
		) +
		circle(cx, cy, s * 0.13) +
		dot(cx, cy, s * 0.055) +
		dot(cx - s * 0.03, cy - s * 0.035, s * 0.015, bg);
	for (let i = 0; i < 9; i++) {
		const t = 0.1 + i * 0.1;
		const x = -0.38 + 0.76 * t;
		const y = 2 * t * (1 - t) * -0.34;
		out += path(
			`M${at(x, y)}L${at(x * 1.1, y - 0.07 - 0.03 * Math.sin(Math.PI * t))}`,
		);
	}
	return out + path(`M${at(-0.28, 0.2)}Q${at(0, 0.36)} ${at(0.28, 0.2)}`);
};

const PHOTO_LOOKS: readonly { motif: Motif; alt: string }[] = [
	{ motif: mandala, alt: "Mandala with petals, black linework" },
	{ motif: waves, alt: "Waves under a sun, black linework" },
	{ motif: stars, alt: "Eight-point star with small stars, black linework" },
	{ motif: lines, alt: "Flowing fine lines, black linework" },
	{ motif: dots, alt: "Round dotwork pattern, black ink" },
	{ motif: geometric, alt: "Turning squares and a hexagon, black linework" },
	{ motif: mountain, alt: "Mountains and a sun, black linework" },
	{ motif: lotus, alt: "Lotus on water, black linework" },
];

const FLASH_LOOKS: readonly { motif: Motif; name: string }[] = [
	{ motif: moth, name: "Moth" },
	{ motif: dagger, name: "Dagger and rose" },
	{ motif: lotus, name: "Lotus" },
	{ motif: mountain, name: "Mountain sun" },
	{ motif: snake, name: "Snake" },
	{ motif: swallow, name: "Swallow" },
	{ motif: moon, name: "Crescent moon" },
	{ motif: eye, name: "Open eye" },
];
