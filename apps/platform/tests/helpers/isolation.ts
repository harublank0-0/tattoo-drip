import type { ApiClient } from "@japa/api-client";
import type { Assert } from "@japa/assert";
import type User from "#models/user";
import type { Studio } from "#tests/helpers/tenants";
import type { IsolationCase } from "#tests/isolation/cases";

function urlFor(pattern: string, studio: Studio, resourceOwner?: Studio) {
	return pattern
		.replace(":tenant", studio.tenant.slug)
		.replace(":id", resourceOwner?.paymentMethod.id ?? "");
}

function send(
	client: ApiClient,
	isolationCase: IsolationCase,
	url: string,
	user: User,
	body?: Record<string, unknown>,
) {
	// client.get() and friends type the body as `never`; request() is what they
	// all call.
	const request = client.request(url, isolationCase.method);
	if (isolationCase.method === "GET") request.withInertia();
	else request.withCsrfToken();
	if (body) request.form(body);
	return request.loginAs(user).redirects(0);
}

/**
 * Proves studio A's actor cannot reach studio B through one route.
 *
 * First a positive control: the same request, with the same body, against
 * A's own studio must give the case's status. Without it a wrong role or an
 * invalid body would fail for other reasons and the attacks would pass
 * vacuously. For a write, the control must also change A's snapshot: a
 * snapshot that cannot see the write would make "unchanged" below mean
 * nothing. Then the attacks, as the same actor: B's slug in the URL, and
 * (for routes with an :id) A's slug with B's resource id. Each must be a
 * 404, and B's snapshot must be unchanged afterwards.
 */
export async function assertCrossTenantIsolation(
	client: ApiClient,
	assert: Assert,
	{ a, b }: { a: Studio; b: Studio },
	isolationCase: IsolationCase,
) {
	const actor = isolationCase.actor === "owner" ? a.owner : a.artist;
	const body = isolationCase.body?.(a);
	const writes = isolationCase.method !== "GET";

	const ownBefore = writes ? await isolationCase.snapshot(a) : undefined;
	const control = await send(
		client,
		isolationCase,
		urlFor(isolationCase.pattern, a, a),
		actor,
		body,
	);
	control.assertStatus(isolationCase.ownStatus);
	if (writes) {
		assert.notDeepEqual(
			await isolationCase.snapshot(a),
			ownBefore,
			`${isolationCase.method} ${isolationCase.pattern} did not change studio A's snapshot: the snapshot cannot see what this route writes`,
		);
	}

	const attacks = [urlFor(isolationCase.pattern, b, b)];
	if (isolationCase.pattern.includes(":id")) {
		attacks.push(urlFor(isolationCase.pattern, a, b));
	}

	const before = await isolationCase.snapshot(b);
	for (const url of attacks) {
		const response = await send(client, isolationCase, url, actor, body);
		response.assertStatus(404);
		assert.deepEqual(
			await isolationCase.snapshot(b),
			before,
			`${isolationCase.method} ${url} changed studio B`,
		);
	}
}
