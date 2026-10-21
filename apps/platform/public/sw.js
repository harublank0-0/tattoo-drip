/**
 * Tattoo Drip's service worker (TAT-67). It keeps only the app's hashed
 * build files and the offline page on the device: never pages, Inertia
 * responses or images, so nothing personal is left after logout. Pages
 * always come from the network; the offline page only when it fails.
 * Bump CACHE to drop everything stored by an older version.
 */
const CACHE = "td-shell-v2";
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
					names
						.filter((name) => name !== CACHE)
						.map((name) => caches.delete(name)),
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

/**
 * A hashed build file never changes, so a stored copy is always right.
 * The cache is only a speed-up: if it cannot be read or written (a full
 * disk, blocked storage), the page still gets the file from the network.
 */
async function fromCacheOrNetwork(request) {
	let cache;
	try {
		cache = await caches.open(CACHE);
		const stored = await cache.match(request);
		if (stored) return stored;
	} catch {
		// Fall through to the network.
	}
	const response = await fetch(request);
	if (response.ok && cache) {
		try {
			await cache.put(request, response.clone());
			await trim(cache);
		} catch {
			// Best effort: a failing cache must not lose a good response.
		}
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
