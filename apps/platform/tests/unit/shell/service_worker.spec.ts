import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "@japa/runner";

const ORIGIN = "http://app.test";
const source = await readFile(
	new URL("../../../public/sw.js", import.meta.url),
	"utf8",
);

type FakeEvent = {
	request: { url: string; method: string; mode: string };
	respondWith(response: Promise<Response> | Response): void;
	waitUntil(work: Promise<unknown>): void;
};
type Handler = (event: FakeEvent) => void;

/**
 * Loads public/sw.js into a sandbox with an in-memory Cache Storage and a
 * controllable network, so the worker's rules can be tested without a
 * browser. `control` injects the failures a real phone has: no network,
 * and a cache that throws (a full disk, blocked storage).
 */
function loadWorker() {
	const handlers: Record<string, Handler> = {};
	const stores = new Map<string, Map<string, Response>>();
	const control = {
		online: true,
		failOpen: false,
		failMatch: false,
		failPut: false,
		failKeys: false,
		fetched: [] as string[],
	};
	const quota = () => new Error("QuotaExceededError");
	const absolute = (url: string) => new URL(url, ORIGIN).href;

	const openCache = (name: string) => {
		if (!stores.has(name)) stores.set(name, new Map());
		const store = stores.get(name) as Map<string, Response>;
		return {
			addAll: async (urls: string[]) => {
				for (const url of urls) {
					store.set(absolute(url), new Response(`stored ${url}`));
				}
			},
			match: async (request: string | { url: string }) => {
				if (control.failMatch) throw quota();
				const key =
					typeof request === "string" ? absolute(request) : request.url;
				return store.get(key)?.clone();
			},
			put: async (request: { url: string }, response: Response) => {
				if (control.failPut) throw quota();
				store.set(request.url, response);
			},
			keys: async () => {
				if (control.failKeys) throw quota();
				return [...store.keys()].map((url) => ({ url }));
			},
			delete: async (key: { url: string }) => store.delete(key.url),
		};
	};

	const sandbox = {
		URL,
		Response,
		self: {
			location: { origin: ORIGIN },
			addEventListener: (type: string, handler: Handler) => {
				handlers[type] = handler;
			},
			skipWaiting: async () => {},
			clients: { claim: async () => {} },
		},
		caches: {
			open: async (name: string) => {
				if (control.failOpen) throw quota();
				return openCache(name);
			},
			keys: async () => [...stores.keys()],
			delete: async (name: string) => stores.delete(name),
			match: async (url: string) => {
				for (const store of stores.values()) {
					const hit = store.get(absolute(url));
					if (hit) return hit.clone();
				}
				return undefined;
			},
		},
		fetch: async (request: { url: string }) => {
			control.fetched.push(request.url);
			if (!control.online) throw new Error("offline");
			return new Response(`network ${request.url}`);
		},
	};
	vm.runInNewContext(source, sandbox);

	/** Fires the event; the text the worker answered with, or undefined if it left the request alone. */
	async function dispatch(
		type: string,
		url = `${ORIGIN}/`,
		{ method = "GET", mode = "cors" } = {},
	): Promise<string | undefined> {
		let answer: Promise<unknown> | undefined;
		handlers[type]({
			request: { url, method, mode },
			respondWith: (response) => {
				answer = Promise.resolve(response);
			},
			waitUntil: (work) => {
				answer = Promise.resolve(work);
			},
		});
		const result = await answer;
		return result instanceof Response ? result.text() : undefined;
	}

	return { control, stores, dispatch };
}

const cached = (stores: Map<string, Map<string, Response>>) => [
	...(stores.get("td-shell-v1")?.keys() ?? []),
];

test.group("Service worker", () => {
	test("installs the offline page and two icons, and drops older caches", async ({
		assert,
	}) => {
		const { stores, dispatch } = loadWorker();

		await dispatch("install");
		assert.sameMembers(cached(stores), [
			`${ORIGIN}/offline.html`,
			`${ORIGIN}/icons/favicon.svg`,
			`${ORIGIN}/icons/icon-192.png`,
		]);

		stores.set("td-shell-v0", new Map());
		await dispatch("activate");
		assert.deepEqual([...stores.keys()], ["td-shell-v1"]);
	});

	test("leaves everything but navigations and build files alone", async ({
		assert,
	}) => {
		const { dispatch } = loadWorker();
		const cases: [string, { method?: string; mode?: string }][] = [
			[`${ORIGIN}/t/bnt/inbox`, { method: "POST" }],
			[`${ORIGIN}/t/bnt/inbox`, { mode: "cors" }], // an Inertia visit
			[`${ORIGIN}/files/reference_image/x?signature=1`, {}],
			[`${ORIGIN}/uploads/tenants/1/a.jpg`, {}],
			["https://other.test/assets/x.js", {}],
		];
		for (const [url, options] of cases) {
			assert.isUndefined(
				await dispatch("fetch", url, options),
				`${options.method ?? "GET"} ${url}`,
			);
		}
	});

	test("pages come from the network, the offline page only when it fails, and no page is stored", async ({
		assert,
	}) => {
		const { control, stores, dispatch } = loadWorker();
		await dispatch("install");

		const page = `${ORIGIN}/t/bnt/inbox`;
		assert.equal(
			await dispatch("fetch", page, { mode: "navigate" }),
			`network ${page}`,
		);

		control.online = false;
		assert.equal(
			await dispatch("fetch", page, { mode: "navigate" }),
			"stored /offline.html",
		);
		assert.isFalse(cached(stores).some((url) => url.includes("/t/bnt")));
	});

	test("build files are stored once, then served from the device", async ({
		assert,
	}) => {
		const { control, dispatch } = loadWorker();
		const file = `${ORIGIN}/assets/app-1.js`;

		assert.equal(await dispatch("fetch", file), `network ${file}`);
		await dispatch("fetch", file);
		assert.deepEqual(control.fetched, [file]);
	});

	test("keeps at most 100 build files, dropping the oldest", async ({
		assert,
	}) => {
		const { stores, dispatch } = loadWorker();
		for (let i = 1; i <= 105; i++) {
			await dispatch("fetch", `${ORIGIN}/assets/f-${i}.js`);
		}

		const files = cached(stores).filter((url) => url.includes("/assets/"));
		assert.lengthOf(files, 100);
		assert.notInclude(files, `${ORIGIN}/assets/f-1.js`);
		assert.include(files, `${ORIGIN}/assets/f-105.js`);
	});

	for (const failure of [
		"failOpen",
		"failMatch",
		"failPut",
		"failKeys",
	] as const) {
		test(`a build file still loads when the cache fails (${failure})`, async ({
			assert,
		}) => {
			const { control, dispatch } = loadWorker();
			control[failure] = true;
			const file = `${ORIGIN}/assets/app-1.js`;

			assert.equal(await dispatch("fetch", file), `network ${file}`);
		});
	}
});
