import { EventEmitter } from "node:events";
import { mock } from "node:test";
import type { HttpContext } from "@adonisjs/core/http";
import limiter from "@adonisjs/limiter/services/main";
import { test } from "@japa/runner";
import PublicGateMiddleware from "#middleware/public_gate_middleware";
import { writeSlots } from "#services/write_slots";
import { testServerKeys } from "#tests/helpers/api_limits";

/**
 * TAT-38 ruling 13: a write holds a slot until its response closes. The
 * gate counts the request first (a database round trip), so a client can
 * hang up while it waits; its "close" event is then over before the gate
 * could listen for it. These tests drive the gate with stand-ins for the
 * Node objects, and a limiter count they finish by hand.
 */
class Socket extends EventEmitter {
	destroyed = false;
}
class Response extends EventEmitter {
	destroyed = false;
	closed = false;
}
class Incoming extends EventEmitter {
	destroyed = false;
	socket = new Socket();
}

function gateContext(
	options: { authorization?: string; ip?: () => string } = {},
) {
	const incoming = new Incoming();
	const response = new Response();
	const ctx = {
		route: { pattern: "/api/v1/__test/echo" },
		request: {
			request: incoming,
			method: () => "POST",
			url: () => "/api/v1/__test/echo",
			header: (name: string) =>
				name === "authorization" ? options.authorization : undefined,
			ip: options.ip ?? (() => "203.0.113.90"),
		},
		response: { response },
	} as unknown as HttpContext;
	/** The client goes away: what Node does to the objects, in its order. */
	const hangUp = () => {
		incoming.socket.destroyed = true;
		incoming.destroyed = true;
		response.destroyed = true;
		response.closed = true;
		incoming.socket.emit("close");
		response.emit("close");
	};
	return { ctx, incoming, response, hangUp };
}

/** A limiter count that finishes when the test says so. */
function slowCount() {
	let finish!: () => void;
	const counted = new Promise<void>((resolve) => {
		finish = resolve;
	});
	mock.method(limiter, "use", (() => ({ consume: () => counted })) as never);
	return finish;
}

const [KEY] = testServerKeys();

test.group("PublicGateMiddleware: write slots", (group) => {
	group.each.setup(() => {
		if (writeSlots.inFlight !== 0) throw new Error("a slot is still held");
	});
	group.each.teardown(() => mock.restoreAll());

	test("a write holds a slot until its response closes", async ({ assert }) => {
		const finish = slowCount();
		const { ctx, response, incoming } = gateContext();
		const next = mock.fn(async () => {});

		const pending = new PublicGateMiddleware().handle(ctx, next);
		finish();
		await pending;

		assert.equal(next.mock.callCount(), 1);
		assert.equal(writeSlots.inFlight, 1);
		response.emit("close");
		assert.equal(writeSlots.inFlight, 0);
		assert.equal(incoming.socket.listenerCount("close"), 0);
		assert.equal(response.listenerCount("close"), 0);
	});

	test("a client that hangs up while its request is counted takes no slot", async ({
		assert,
	}) => {
		const finish = slowCount();
		const { ctx, hangUp } = gateContext();
		const next = mock.fn(async () => {});

		const pending = new PublicGateMiddleware().handle(ctx, next);
		hangUp();
		finish();
		await pending;

		assert.equal(writeSlots.inFlight, 0);
		assert.equal(next.mock.callCount(), 0);
	});

	test("a keyed call without a visitor does not read the address of a dead request", async ({
		assert,
	}) => {
		const finish = slowCount();
		let gone = false;
		const { ctx, hangUp } = gateContext({
			authorization: `Bearer ${KEY}`,
			ip: () => {
				if (gone) throw new Error("request.ip() on a request that is gone");
				return "203.0.113.91";
			},
		});
		const next = mock.fn(async () => {});

		const pending = new PublicGateMiddleware().handle(ctx, next);
		gone = true;
		hangUp();
		finish();
		await pending;

		assert.equal(writeSlots.inFlight, 0);
		assert.equal(next.mock.callCount(), 0);
	});

	test("a request queued behind another on one connection frees its slot when the connection closes", async ({
		assert,
	}) => {
		// Node gives a pipelined request no socket until the one before it has
		// answered, so its response never emits "close" (checked on Node 24).
		const finish = slowCount();
		const { ctx, incoming } = gateContext();
		const next = mock.fn(async () => {});

		const pending = new PublicGateMiddleware().handle(ctx, next);
		finish();
		await pending;
		assert.equal(writeSlots.inFlight, 1);

		incoming.socket.emit("close");
		assert.equal(writeSlots.inFlight, 0);
	});

	test("a request already destroyed when the count finishes takes no slot", async ({
		assert,
	}) => {
		// The queued request of the pipelined case: its connection closed, its
		// response never will.
		const finish = slowCount();
		const { ctx, incoming } = gateContext();
		const next = mock.fn(async () => {});

		const pending = new PublicGateMiddleware().handle(ctx, next);
		incoming.destroyed = true;
		finish();
		await pending;

		assert.equal(writeSlots.inFlight, 0);
		assert.equal(next.mock.callCount(), 0);
	});

	test("the response and the connection both closing frees the slot once", async ({
		assert,
	}) => {
		const finish = slowCount();
		const first = gateContext();
		const second = gateContext();
		const next = mock.fn(async () => {});
		const gate = new PublicGateMiddleware();

		const pending = [
			gate.handle(first.ctx, next),
			gate.handle(second.ctx, next),
		];
		finish();
		await Promise.all(pending);
		assert.equal(writeSlots.inFlight, 2);

		first.hangUp();
		first.response.emit("close");
		first.incoming.socket.emit("close");
		assert.equal(writeSlots.inFlight, 1);
		second.response.emit("close");
		assert.equal(writeSlots.inFlight, 0);
	});
});
