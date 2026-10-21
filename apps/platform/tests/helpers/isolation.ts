import type { ApiClient } from "@japa/api-client";
import type { Assert } from "@japa/assert";
import type User from "#models/user";
import type { Studio } from "#tests/helpers/tenants";
import type { IsolationCase } from "#tests/isolation/cases";

/** Whole path segments only: ":identity" or ":idx" are not the :id. */
const TENANT_SEGMENT = /:tenant(?=\/|$)/;
const ID_SEGMENT = /:id(?=\/|$)/;

/**
 * The case's URL for `studio`'s slug. A route with an :id gets the id of
 * `resourceOwner`'s seeded resource that the case names (`resource`); a
 * case that leaves it out is a mistake in the table, so fail loudly instead
 * of guessing.
 */
function urlFor(
	{ method, pattern, resource }: IsolationCase,
	studio: Studio,
	resourceOwner: Studio,
) {
	const url = pattern.replace(TENANT_SEGMENT, studio.tenant.slug);
	if (!ID_SEGMENT.test(pattern)) return url;
	if (!resource) {
		throw new Error(
			`${method} ${pattern} has an :id but its isolation case names no \`resource\``,
		);
	}
	return url.replace(ID_SEGMENT, resourceOwner[resource].id);
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
 * Sends `isolationCase` as `user` to `studio`'s slug, with
 * `resourceOwner`'s resource for an :id and the case's body built for
 * `studio`: one request of the harness, for other walks over the cases
 * (role_access.spec.ts, TAT-30).
 */
export function caseRequest(
	client: ApiClient,
	isolationCase: IsolationCase,
	studio: Studio,
	resourceOwner: Studio,
	user: User,
) {
	return send(
		client,
		isolationCase,
		urlFor(isolationCase, studio, resourceOwner),
		user,
		isolationCase.body?.(studio),
	);
}

/**
 * Proves studio A's actor cannot reach studio B through one route.
 *
 * First a positive control: the same request, with the same body, against
 * A's own studio must give the case's status. Without it a wrong role or an
 * invalid body would fail for other reasons and the attacks would pass
 * vacuously. For a write, the control must also change A's snapshot: a
 * snapshot that cannot see the write would make "unchanged" below mean
 * nothing. B's snapshot is taken before the control and must be unchanged
 * right after it: A's own valid request may not touch B. Then the attacks,
 * as the same actor: B's slug in the URL, and (for routes with an :id) A's
 * slug with B's resource id. Each must be a 404, and B's snapshot must be
 * unchanged afterwards.
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

	// B's baseline is taken before anything is sent: a handler that also
	// writes to B on A's own valid request must not get to define "unchanged".
	const before = await isolationCase.snapshot(b);
	const ownBefore = writes ? await isolationCase.snapshot(a) : undefined;
	const control = await send(
		client,
		isolationCase,
		urlFor(isolationCase, a, a),
		actor,
		body,
	);
	control.assertStatus(isolationCase.ownStatus);
	assert.deepEqual(
		await isolationCase.snapshot(b),
		before,
		`${isolationCase.method} ${isolationCase.pattern}: A's own valid request changed studio B`,
	);
	if (writes) {
		assert.notDeepEqual(
			await isolationCase.snapshot(a),
			ownBefore,
			`${isolationCase.method} ${isolationCase.pattern} did not change studio A's snapshot: the snapshot cannot see what this route writes`,
		);
	}

	const attacks = [urlFor(isolationCase, b, b)];
	if (ID_SEGMENT.test(isolationCase.pattern)) {
		attacks.push(urlFor(isolationCase, a, b));
	}

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
