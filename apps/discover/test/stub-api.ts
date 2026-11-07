import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stub of the Discover API for the built-server test (D06): it serves
 * `count` studios, artists and photos (0, 3 or 20 in the tests), the style
 * list and the places, lets an endpoint fail (500) or hang, and records
 * every request. Names are recognisably the stub's ("Stub …").
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
		return {
			id: uuid(2, index),
			slug: `stub-artist-${index}`,
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
				? `http://stub-solo-${index}.localhost:3000/artists/stub-artist-${index}`
				: `http://${studio?.slug}.localhost:3000/artists/stub-artist-${index}`,
		};
	});
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
	};
}

export type StubApi = {
	server: Server;
	url: string;
	requests: string[];
	/** What the stub answers now: how many rows, and which endpoints fail or hang. */
	scenario: { count: number; fail: Set<Endpoint>; hang: Set<Endpoint> };
	close: () => void;
};

export async function stubApi(count = 1): Promise<StubApi> {
	const requests: string[] = [];
	const scenario = {
		count,
		fail: new Set<Endpoint>(),
		hang: new Set<Endpoint>(),
	};
	const hanging = new Set<() => void>();
	const server = createServer((request, response) => {
		requests.push(request.url ?? "");
		const address = new URL(request.url ?? "/", "http://stub");
		const path = address.pathname;
		const limit = Number(address.searchParams.get("limit") ?? 24);
		const endpoint = path.replace("/api/v1/discover/", "") as Endpoint;
		response.setHeader("Content-Type", "application/json");
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
		if (endpoint === "styles" || endpoint === "locations") {
			response.end(JSON.stringify({ data: data[endpoint] }));
			return;
		}
		const rows = data[endpoint];
		if (!rows) {
			response.statusCode = 404;
			response.end(
				JSON.stringify({ error: { code: "not_found", message: "No" } }),
			);
			return;
		}
		response.end(
			JSON.stringify({ data: rows.slice(0, limit), nextCursor: null }),
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
