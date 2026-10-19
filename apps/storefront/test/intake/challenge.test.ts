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
	const widgets: { container: HTMLElement; options: TurnstileRenderOptions }[] =
		[];
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
	const challenge = new Challenge(SITE_KEY, host, (value) =>
		interactive.push(value),
	);
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
			Object.fromEntries(
				Object.entries(rest).filter(([, value]) => typeof value !== "function"),
			),
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
		assert.deepEqual(await result, {
			ok: true,
			token: "XXXX.DUMMY.TOKEN.XXXX",
		});
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
				assert.equal(
					callbacks[fail]("300030"),
					true,
					"handled: no console noise",
				);
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
		assert.deepEqual(calls, [
			"render",
			"execute widget-1",
			"reset widget-1",
			"execute widget-1",
		]);
	});

	test("a callback with no attempt waiting is ignored", async () => {
		const { challenge, options } = await ready();
		options().callback("stray");
		const result = challenge.token();
		await tick();
		options().callback("fresh");

		assert.deepEqual(await result, { ok: true, token: "fresh" });
	});

	test("the same callback arriving twice settles the attempt once", async () => {
		const { challenge, options } = await ready();
		const first = challenge.token();
		await tick();
		const { callback } = options();
		callback("once");
		callback("once");

		assert.deepEqual(await first, { ok: true, token: "once" });

		challenge.reset();
		const next = challenge.token();
		const state = await Promise.race([next, tick().then(() => "waiting")]);
		assert.equal(state, "waiting", "the repeat didn't answer the next attempt");
	});

	test("a spent token arriving again, after a reset, never answers the new attempt", async () => {
		const { challenge, options } = await ready();
		const first = challenge.token();
		await tick();
		const { callback } = options();
		callback("spent");
		assert.deepEqual(await first, { ok: true, token: "spent" });

		challenge.reset();
		const second = challenge.token();
		await tick();
		callback("spent");
		const state = await Promise.race([second, tick().then(() => "waiting")]);
		assert.equal(state, "waiting", "a used token must not be sent twice");

		callback("fresh");
		assert.deepEqual(await second, { ok: true, token: "fresh" });
	});

	test("a token that came while nothing waited is not spent: the next attempt may use it", async () => {
		const { challenge, options } = await ready();
		const { callback } = options();
		callback("early");
		const result = challenge.token();
		await tick();
		callback("early");

		assert.deepEqual(await result, { ok: true, token: "early" });
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
