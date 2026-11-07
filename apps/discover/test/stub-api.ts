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
	| "locations";

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
	return {
		studios,
		artists,
		tattoos,
		styles: STYLES,
		locations: PLACES.slice(0, Math.min(count, PLACES.length)),
		tattooPlaces,
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
	};
	const hanging = new Set<() => void>();
	const server = createServer((request, response) => {
		requests.push(request.url ?? "");
		const address = new URL(request.url ?? "/", "http://stub");
		const path = address.pathname;
		const limit = Number(address.searchParams.get("limit") ?? 24);
		const endpoint = path.replace("/api/v1/discover/", "") as Endpoint;
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
			studio?: { slug?: string };
		};
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
						(row.name ?? "").toLowerCase().includes(q.trim().toLowerCase())) &&
					(independent === null ||
						row.independent === (independent === "true")) &&
					(!studio || row.studio?.slug === studio),
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
