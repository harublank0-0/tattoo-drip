import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stub of the Discover API for the built-server test (D06): it serves
 * `count` studios, artists and photos (0, 3 or 20 in the tests), the style
 * list and the places, lets an endpoint fail (500) or hang, and records
 * every request. Names are recognisably the stub's ("Stub …").
 *
 * Like the API (D06.5, D07), the lists honour `country` (a photo by its
 * artist's place), `city` (only with `country`), `style`, `q` (a
 * case-insensitive substring of the name), `independent` (artists),
 * `studio` (tattoos), `sort` (`newest`: the fixtures' order; `name`,
 * `-name`: lower-cased name, ties by id), `limit` (1–48, default 24) and
 * `cursor`, and answer a malformed parameter with a 422 as the API does
 * (`q`: 2 to 80 characters once trimmed, no control character).
 * Places cycle Pokhara, Kathmandu, Lalitpur (NP), New Delhi (IN): rows 3,
 * 7, 11… are India's, so 3 of each are all Nepal's and India has none.
 *
 * D08: the detail reads (`/studios/:slug`, `/studios/:slug/artists`,
 * `/studios/:slug/artists/:artist`, `/artists/:slug`) follow the real
 * API's 404 rules: unknown, the wrong kind (a studio's slug as an
 * independent and the reverse, an independent's artist under /studios),
 * another studio's artist and anything in `scenario.hidden` (standing in
 * for never listed, opted out, hidden and taken down, which the real API
 * answers alike) are the same 404, and hidden rows leave the lists too.
 * `old-<slug>` is an old slug of a studio or an independent: the answer
 * names the current one. Studios 1, 6, 11… have two more artists
 * (`crew-<n>-a`, `-b`) on their profiles only, and every shown artist has
 * five photos on their profile (`tattoos` in a detail), so profiles have
 * a portfolio; `tattoos` also honours `artist` (a uuid). Artist 9 isn't
 * taking requests. `scenario.links` overrides a profile's `bookingUrl` /
 * `storefrontUrl` (unsafe-link tests).
 *
 * D09: `/tattoos/:id` (the artwork page's read) finds a photo of the list
 * or of any profile, with its place, `artistAcceptingInquiries` (false for
 * artist 9), its page on the studio's site and a booking link naming it
 * (`/book?artwork=<id>&ref=…`); unknown, a malformed id, a hidden studio,
 * a hidden artist (`<studio>/<artist>`) or a hidden photo (its id in
 * `scenario.hidden`, standing for unpublished and taken down) is the same
 * 404, and a hidden photo leaves the list too. An id in any letter case
 * resolves (as the API's uuid matcher). `q` on `/tattoos` matches the
 * photo's alt text, its artist's, studio's and style's names, as the API
 * does since D09. `scenario.links[<id>]` overrides a photo's links.
 *
 * Divergences from the real API: the cursor is base64url of
 * `["stub", sort, offset]` (an offset, not a keyset, so rows added while
 * paging would shift; the fixtures never change mid-test), and only the
 * parameters above are checked. Artists 5 and 6 share the slug `maya` at
 * two different studios, as a tenant-scoped slug may.
 */
export type Endpoint =
	| "studios"
	| "artists"
	| "tattoos"
	| "styles"
	| "locations"
	// D08's detail reads: one studio, its artists, one studio artist, one independent.
	| "studio"
	| "studio-artists"
	| "studio-artist"
	| "independent"
	// D09's artwork read.
	| "tattoo";

/** The referral token the stub's booking links carry (shaped like the platform's; never verified here). */
export const STUB_REF =
	"eyJ2IjoxLCJwIjoiYm9va2luZ19yZWZlcnJhbCJ9.c3R1Yi1zaWduYXR1cmU";

export const STYLES = [
	{ slug: "blackwork", name: "Blackwork" },
	{ slug: "fine-line", name: "Fine line" },
	{ slug: "realism", name: "Realism" },
	{ slug: "traditional", name: "Traditional" },
	{ slug: "japanese", name: "Japanese" },
	{ slug: "geometric", name: "Geometric" },
];

const PLACES = [
	{ country: "NP", slug: "pokhara", name: "Pokhara", region: "Gandaki" },
	{ country: "NP", slug: "kathmandu", name: "Kathmandu", region: "Bagmati" },
	{ country: "NP", slug: "lalitpur", name: "Lalitpur", region: "Bagmati" },
	{ country: "IN", slug: "new-delhi", name: "New Delhi", region: null },
];

const uuid = (kind: number, index: number) =>
	`00000000-0000-4000-8000-${String(kind).padStart(4, "0")}${String(index).padStart(8, "0")}`;

export function fixtures(count: number) {
	const place = (index: number) => PLACES[index % PLACES.length] ?? null;
	const studios = Array.from({ length: count }, (_, index) => ({
		id: uuid(1, index),
		slug: `stub-studio-${index}`,
		name: index === 0 ? "Stub Ink <b>Studio</b>" : `Stub Studio ${index}`,
		type: "studio",
		location: place(index),
		logo: null,
		cover: null,
		styles: [STYLES[index % STYLES.length]],
		storefrontUrl: `http://stub-studio-${index}.localhost:3000/`,
	}));
	const artists = Array.from({ length: count }, (_, index) => {
		const independent = index % 4 === 3;
		const studio = studios[index % Math.max(studios.length, 1)];
		const slug = index === 5 || index === 6 ? "maya" : `stub-artist-${index}`;
		return {
			id: uuid(2, index),
			slug,
			name: `Stub Artist ${index}`,
			photo: null,
			styles: [STYLES[index % STYLES.length]],
			acceptingInquiries: true,
			independent,
			studio: independent
				? {
						slug: `stub-solo-${index}`,
						name: `Stub Solo ${index}`,
						type: "independent",
					}
				: { slug: studio?.slug, name: studio?.name, type: "studio" },
			location: place(index),
			storefrontUrl: independent
				? `http://stub-solo-${index}.localhost:3000/artists/${slug}`
				: `http://${studio?.slug}.localhost:3000/artists/${slug}`,
		};
	});
	/** Each photo's place, as the API knows it (its summary doesn't carry it). */
	const tattooPlaces = Array.from(
		{ length: count },
		(_, index) =>
			artists[index % Math.max(artists.length, 1)]?.location ?? null,
	);
	const tattoos = Array.from({ length: count }, (_, index) => {
		const artist = artists[index % Math.max(artists.length, 1)];
		return {
			id: uuid(3, index),
			image: {
				url: `http://media.test/tattoo-${index}.jpg`,
				width: 1200,
				height: index % 2 === 0 ? 1500 : 900,
				alt: null,
				variants: [
					{ url: `http://media.test/tattoo-${index}.640.jpg`, width: 640 },
				],
			},
			styles: [STYLES[index % STYLES.length]],
			healed: false,
			artist: { id: artist?.id, slug: artist?.slug, name: artist?.name },
			studio: artist?.studio,
		};
	});
	for (const artist of artists)
		if (artist.slug === "stub-artist-9") artist.acceptingInquiries = false;
	return {
		studios,
		artists,
		tattoos,
		styles: STYLES,
		locations: PLACES.slice(0, Math.min(count, PLACES.length)),
		tattooPlaces,
	};
}

type Fixtures = ReturnType<typeof fixtures>;
type StubArtist = Fixtures["artists"][number];
type StubStudio = Fixtures["studios"][number];

type StubPhoto = ReturnType<typeof profilePhotos>[number];

/**
 * Every photo the stub can show by id (D09): the list's, then every shown
 * artist's profile photos (studios' and independents'), each with its place
 * and its artist's request switch.
 */
function photoIndex(
	data: Fixtures,
	hidden: Set<string>,
): Map<
	string,
	{ photo: StubPhoto; place: StubArtist["location"]; accepting: boolean }
> {
	const index = new Map<
		string,
		{ photo: StubPhoto; place: StubArtist["location"]; accepting: boolean }
	>();
	const accepting = (artistId: string | undefined) =>
		data.artists.find((each) => each.id === artistId)?.acceptingInquiries ??
		true;
	data.tattoos.forEach((photo, at) => {
		index.set(photo.id, {
			photo: photo as StubPhoto,
			place: data.tattooPlaces[at] ?? null,
			accepting: accepting(photo.artist.id),
		});
	});
	data.studios.forEach((studio, at) => {
		if (hidden.has(studio.slug)) return;
		profileArtists(data, studio)
			.filter((artist) => !hidden.has(`${studio.slug}/${artist.slug}`))
			.forEach((artist, n) => {
				for (const photo of profilePhotos(artist, at * 100 + n))
					index.set(photo.id, {
						photo,
						place: artist.location,
						accepting: artist.acceptingInquiries,
					});
			});
	});
	data.artists.forEach((artist, at) => {
		if (!artist.independent) return;
		for (const photo of profilePhotos(artist, 5000 + at * 2))
			index.set(photo.id, {
				photo,
				place: artist.location,
				accepting: artist.acceptingInquiries,
			});
	});
	return index;
}

/** Whether a photo is not shown: its studio, its artist or itself hidden. */
function photoHidden(
	photo: { id: string; artist: { slug?: string }; studio?: { slug?: string } },
	hidden: Set<string>,
): boolean {
	const studio = photo.studio?.slug ?? "";
	return (
		hidden.has(photo.id) ||
		hidden.has(studio) ||
		hidden.has(`${studio}/${photo.artist.slug}`)
	);
}

/** A studio's artists as its profile shows them: the list's, then (studios 1, 6, 11…) two more. */
function profileArtists(data: Fixtures, studio: StubStudio): StubArtist[] {
	const index = data.studios.indexOf(studio);
	const own = data.artists.filter(
		(artist) => !artist.independent && artist.studio.slug === studio.slug,
	);
	if (index % 5 !== 1) return own;
	const crew = ["a", "b"].map((letter, n) => ({
		id: uuid(5, index * 10 + n),
		slug: `crew-${index}-${letter}`,
		name: `Stub Crew ${index}${letter.toUpperCase()}`,
		photo:
			n === 0
				? {
						url: `http://media.test/crew-${index}-${letter}.jpg`,
						width: 800,
						height: 1000,
						variants: [],
					}
				: null,
		styles: [STYLES[(index + n + 1) % STYLES.length]],
		acceptingInquiries: true,
		independent: false,
		studio: { slug: studio.slug, name: studio.name, type: "studio" },
		location: studio.location,
		storefrontUrl: `http://${studio.slug}.localhost:3000/artists/crew-${index}-${letter}`,
	}));
	return [...own, ...(crew as StubArtist[])];
}

/** An artist's five profile photos, of varied proportions. */
function profilePhotos(artist: StubArtist, seed: number) {
	return Array.from({ length: 5 }, (_, n) => ({
		id: uuid(4, seed * 10 + n),
		image: {
			url: `http://media.test/work-${artist.slug}-${seed}-${n}.jpg`,
			width: 1200,
			height: [1500, 900, 1200, 1600, 1000][n] as number,
			alt: n === 0 ? `Stub ${artist.name} piece ${n}` : null,
			variants: [],
		},
		styles: [artist.styles[0]],
		healed: n === 1,
		artist: { id: artist.id, slug: artist.slug, name: artist.name },
		studio: artist.studio,
	}));
}

function artistDetail(
	artist: StubArtist,
	seed: number,
	links: Record<string, { bookingUrl?: string; storefrontUrl?: string }>,
) {
	const origin = new URL(artist.storefrontUrl).origin;
	const key = artist.independent
		? artist.studio.slug
		: `${artist.studio.slug}/${artist.slug}`;
	return {
		...artist,
		bio:
			seed % 2 === 0
				? `Stub bio of ${artist.name}.\n\nSecond <i>line</i>.`
				: null,
		socialLinks: [
			{ platform: "instagram", url: `https://instagram.com/${artist.slug}` },
		],
		tattoos: profilePhotos(artist, seed),
		bookingUrl: `${origin}/book?artist=${artist.slug}&ref=${STUB_REF}`,
		...links[key],
	};
}

function studioDetail(
	data: Fixtures,
	studio: StubStudio,
	links: Record<string, { bookingUrl?: string; storefrontUrl?: string }>,
	hidden: Set<string>,
) {
	const index = data.studios.indexOf(studio);
	const artists = profileArtists(data, studio).filter(
		(artist) => !hidden.has(`${studio.slug}/${artist.slug}`),
	);
	const photos = artists.flatMap((artist, n) =>
		profilePhotos(artist, index * 100 + n),
	);
	// Newest first across artists: interleaved, at most 12, as the API caps it.
	const tattoos = Array.from({ length: 5 }, (_, n) =>
		photos.filter((_, at) => at % 5 === n),
	)
		.flat()
		.slice(0, 12);
	return {
		...studio,
		cover:
			index === 1
				? {
						url: "http://media.test/cover-1.jpg",
						width: 1600,
						height: 900,
						alt: null,
						variants: [],
					}
				: studio.cover,
		intro:
			index === 1
				? "Stub intro about the studio.\n\nWe work by appointment. <script>alert(1)</script>"
				: null,
		timezone: "Asia/Kathmandu",
		socialLinks: [
			{ platform: "instagram", url: `https://instagram.com/${studio.slug}` },
			{ platform: "website", url: "javascript:alert(1)" },
		],
		artists,
		tattoos,
		bookingUrl: `${new URL(studio.storefrontUrl).origin}/book?ref=${STUB_REF}`,
		...links[studio.slug],
	};
}

export type StubApi = {
	server: Server;
	url: string;
	requests: string[];
	/**
	 * What the stub answers now: how many rows, which endpoints fail or hang,
	 * and places added to `/locations` with nothing listed in them (as after
	 * a takedown the places list hasn't caught up with).
	 */
	scenario: {
		count: number;
		fail: Set<Endpoint>;
		hang: Set<Endpoint>;
		extraPlaces: {
			country: string;
			slug: string;
			name: string;
			region: string | null;
		}[];
		/** Not shown (D08): a studio's or independent's slug, or `<studio>/<artist>`. */
		hidden: Set<string>;
		/** A profile's booking and site links, replaced (D08): by studio slug or `<studio>/<artist>`. */
		links: Record<string, { bookingUrl?: string; storefrontUrl?: string }>;
	};
	close: () => void;
};

export async function stubApi(count = 1): Promise<StubApi> {
	const requests: string[] = [];
	const scenario = {
		count,
		fail: new Set<Endpoint>(),
		hang: new Set<Endpoint>(),
		extraPlaces: [] as StubApi["scenario"]["extraPlaces"],
		hidden: new Set<string>(),
		links: {} as StubApi["scenario"]["links"],
	};
	const hanging = new Set<() => void>();
	const server = createServer((request, response) => {
		requests.push(request.url ?? "");
		const address = new URL(request.url ?? "/", "http://stub");
		const path = address.pathname;
		const limit = Number(address.searchParams.get("limit") ?? 24);
		const segments = path.replace("/api/v1/discover/", "").split("/");
		const endpoint = (
			segments.length === 1
				? segments[0]
				: segments[0] === "studios" && segments.length === 2
					? "studio"
					: segments[0] === "studios" && segments[2] === "artists"
						? segments.length === 3
							? "studio-artists"
							: "studio-artist"
						: segments[0] === "artists" && segments.length === 2
							? "independent"
							: segments[0] === "tattoos" && segments.length === 2
								? "tattoo"
								: "unknown"
		) as Endpoint;
		response.setHeader("Content-Type", "application/json");
		// For an ad hoc browser check against the stub (the real API allows DISCOVER_URL).
		response.setHeader("Access-Control-Allow-Origin", "*");
		if (scenario.hang.has(endpoint)) {
			// Never answers; closed with the stub.
			hanging.add(() => response.destroy());
			return;
		}
		if (scenario.fail.has(endpoint)) {
			response.statusCode = 500;
			response.end(
				JSON.stringify({
					error: { code: "internal_error", message: "Stub failure" },
				}),
			);
			return;
		}
		const data = fixtures(scenario.count);
		const { hidden } = scenario;
		const missing = () => {
			response.statusCode = 404;
			response.end(
				JSON.stringify({
					error: { code: "not_found", message: "Not found" },
				}),
			);
		};
		// D08's detail reads: an old slug is `old-<current>`.
		const current = (slug: string | undefined) =>
			slug?.startsWith("old-") ? slug.slice(4) : slug;
		if (
			endpoint === "studio" ||
			endpoint === "studio-artists" ||
			endpoint === "studio-artist"
		) {
			const slug = current(segments[1]);
			const studio = data.studios.find(
				(each) => each.slug === slug && !hidden.has(each.slug),
			);
			if (!studio) return missing();
			const detail = studioDetail(data, studio, scenario.links, hidden);
			if (endpoint === "studio")
				return response.end(JSON.stringify({ data: detail }));
			if (endpoint === "studio-artists")
				return response.end(
					JSON.stringify({
						data: detail.artists.map(
							({
								id,
								slug,
								name,
								photo,
								styles,
								acceptingInquiries,
								independent,
								studio,
								location,
								storefrontUrl,
							}) => ({
								id,
								slug,
								name,
								photo,
								styles,
								acceptingInquiries,
								independent,
								studio,
								location,
								storefrontUrl,
							}),
						),
					}),
				);
			const index = detail.artists.findIndex(
				(each) => each.slug === segments[3],
			);
			const artist = detail.artists[index];
			if (!artist) return missing();
			return response.end(
				JSON.stringify({
					data: artistDetail(
						artist,
						data.studios.indexOf(studio) * 100 + index,
						scenario.links,
					),
				}),
			);
		}
		if (endpoint === "independent") {
			const slug = current(segments[1]);
			const index = data.artists.findIndex(
				(each) =>
					each.independent &&
					each.studio.slug === slug &&
					!hidden.has(each.studio.slug),
			);
			const artist = data.artists[index];
			if (!artist) return missing();
			return response.end(
				JSON.stringify({
					data: artistDetail(artist, 5000 + index * 2, scenario.links),
				}),
			);
		}
		if (endpoint === "tattoo") {
			const id = (segments[1] ?? "").toLowerCase();
			if (
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
					id,
				)
			)
				return missing();
			const found = photoIndex(data, hidden).get(id);
			if (!found || photoHidden(found.photo, hidden)) return missing();
			const { photo, place, accepting } = found;
			const origin = `http://${photo.studio.slug}.localhost:3000`;
			return response.end(
				JSON.stringify({
					data: {
						...photo,
						location: place,
						artistAcceptingInquiries: accepting,
						storefrontUrl: `${origin}/gallery/${photo.id}`,
						bookingUrl: `${origin}/book?artwork=${photo.id}&ref=${STUB_REF}`,
						...scenario.links[photo.id],
					},
				}),
			);
		}
		if (endpoint === "styles") {
			response.end(JSON.stringify({ data: data.styles }));
			return;
		}
		if (endpoint === "locations") {
			response.end(
				JSON.stringify({
					data: [...data.locations, ...scenario.extraPlaces],
				}),
			);
			return;
		}
		const all = data[endpoint as "studios" | "artists" | "tattoos"];
		if (!all) {
			response.statusCode = 404;
			response.end(
				JSON.stringify({ error: { code: "not_found", message: "No" } }),
			);
			return;
		}
		const params = address.searchParams;
		const invalid = (field: string) => {
			response.statusCode = 422;
			response.end(
				JSON.stringify({
					error: {
						code: "validation_failed",
						message: "Stub validation",
						fields: { [field]: ["invalid"] },
					},
				}),
			);
		};
		const country = params.get("country");
		const city = params.get("city");
		const style = params.get("style");
		const q = params.get("q");
		const independent = params.get("independent");
		const studio = params.get("studio");
		const artistId = params.get("artist");
		const sort = params.get("sort") ?? "newest";
		if (country !== null && !/^[A-Za-z]{2}$/.test(country))
			return invalid("country");
		if (city !== null && (!country || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(city)))
			return invalid("city");
		if (style !== null && !STYLES.some((each) => each.slug === style))
			return invalid("style");
		if (
			q !== null &&
			(q.trim().length < 2 ||
				q.trim().length > 80 ||
				// biome-ignore lint/suspicious/noControlCharactersInRegex: the API's NO_CONTROL rule.
				/[\u0000-\u001f\u007f]/.test(q.trim()))
		)
			return invalid("q");
		if (independent !== null && !["true", "false"].includes(independent))
			return invalid("independent");
		if (
			!["newest", "name", "-name"].includes(sort) ||
			(endpoint === "tattoos" && sort !== "newest")
		)
			return invalid("sort");
		if (!Number.isInteger(limit) || limit < 1 || limit > 48)
			return invalid("limit");
		let offset = 0;
		const cursor = params.get("cursor");
		if (cursor !== null) {
			try {
				const [mark, cursorSort, at] = JSON.parse(
					Buffer.from(cursor, "base64url").toString("utf8"),
				);
				if (mark !== "stub" || cursorSort !== sort || !Number.isInteger(at))
					throw new Error("cursor");
				offset = at;
			} catch {
				return invalid("cursor");
			}
		}
		type Row = {
			id: string;
			name?: string;
			location?: { country: string; slug: string } | null;
			styles?: ({ slug: string } | undefined)[];
			independent?: boolean;
			slug?: string;
			studio?: { slug?: string; name?: string };
			artist?: { id?: string; slug?: string; name?: string };
			image?: { alt?: string | null };
		};
		/** D09: what `q` reads on a photo (alt text, artist, studio, style names). */
		const photoText = (row: Row) =>
			[
				row.image?.alt ?? "",
				row.artist?.name ?? "",
				row.studio?.name ?? "",
				...(row.styles ?? []).map(
					(each) =>
						STYLES.find((style) => style.slug === each?.slug)?.name ?? "",
				),
			]
				.join("\n")
				.toLowerCase();
		const placeOf = (row: Row, index: number) =>
			endpoint === "tattoos" ? data.tattooPlaces[index] : row.location;
		let rows = (all as Row[])
			.map((row, index) => ({ row, place: placeOf(row, index) }))
			.filter(
				({ row, place }) =>
					(!country || place?.country === country.toUpperCase()) &&
					(!city || place?.slug === city) &&
					(!style || row.styles?.some((each) => each?.slug === style)) &&
					(!q ||
						(endpoint === "tattoos" ? photoText(row) : (row.name ?? ""))
							.toLowerCase()
							.includes(q.trim().toLowerCase())) &&
					(independent === null ||
						row.independent === (independent === "true")) &&
					(!studio || row.studio?.slug === studio) &&
					(!artistId || row.artist?.id === artistId.toLowerCase()) &&
					// Not shown (D08): gone from every list too.
					!hidden.has(row.studio?.slug ?? "") &&
					!(
						endpoint === "tattoos" &&
						(hidden.has(row.id) ||
							hidden.has(`${row.studio?.slug}/${row.artist?.slug}`))
					) &&
					!(endpoint === "studios" && hidden.has(row.slug ?? "")) &&
					!(
						endpoint === "artists" &&
						hidden.has(`${row.studio?.slug}/${row.slug}`)
					),
			)
			.map(({ row }) => row);
		if (sort !== "newest") {
			rows = [...rows].sort(
				(a, b) =>
					(a.name ?? "")
						.toLowerCase()
						.localeCompare((b.name ?? "").toLowerCase()) ||
					a.id.localeCompare(b.id),
			);
			if (sort === "-name") rows.reverse();
		}
		const page = rows.slice(offset, offset + limit);
		const more = offset + limit < rows.length;
		response.end(
			JSON.stringify({
				data: page,
				nextCursor: more
					? Buffer.from(
							JSON.stringify(["stub", sort, offset + limit]),
						).toString("base64url")
					: null,
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	return {
		server,
		url: `http://localhost:${(server.address() as AddressInfo).port}`,
		requests,
		scenario,
		close: () => {
			for (const end of hanging) end();
			server.closeAllConnections();
			server.close();
		},
	};
}
