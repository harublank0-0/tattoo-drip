import type { ApiClient } from "@japa/api-client";
import type { Assert } from "@japa/assert";
import type { Studio } from "#tests/helpers/tenants";
import type { PublicIsolationCase } from "#tests/isolation/public_cases";

/**
 * Strings that identify `studio` in any public answer: its tenant's id,
 * slug and name, and the ids and names of what twoStudios() seeded (names
 * that both studios share, such as the artist slug "sita", are left out).
 * Studio B's must never appear in an answer to studio A's path.
 */
export function publicMarkers(studio: Studio): string[] {
	return [
		studio.tenant.id,
		studio.tenant.slug,
		studio.tenant.name,
		studio.artistProfile.id,
		studio.artistProfile.name,
		studio.paymentMethod.id,
		studio.client.id,
		studio.project.id,
		studio.newInquiry.id,
	];
}

/**
 * The case's URL under `studio`'s slug. Routes with more parameters than
 * :tenant need the harness to grow an attack with B's values under A's slug
 * (TAT-44's /artists/:artist will); until then they are refused.
 */
function urlFor({ pattern }: PublicIsolationCase, studio: Studio) {
	const url = pattern.replace(/:tenant(?=\/|$)/, studio.tenant.slug);
	if (/\/:/.test(url)) {
		throw new Error(
			`${pattern}: the public harness only handles :tenant so far`,
		);
	}
	return url;
}

/**
 * Proves a public route under studio A's path never reads or writes studio
 * B. The positive control: A's own request gives ownStatus and mentions A
 * (ownMarkers), so an empty or failing answer can't pass. Then the answer
 * must mention none of B's markers, and B's snapshot must be unchanged.
 */
export async function assertPublicIsolation(
	client: ApiClient,
	assert: Assert,
	{ a, b }: { a: Studio; b: Studio },
	isolationCase: PublicIsolationCase,
) {
	const before = await isolationCase.snapshot(b);

	const request = client.request(
		urlFor(isolationCase, a),
		isolationCase.method,
	);
	const body = isolationCase.body?.(a);
	if (body && isolationCase.encoding === "multipart") {
		request.fields(body as Record<string, string>);
	} else if (body) {
		request.json(body);
	}
	const response = await request.redirects(0);

	response.assertStatus(isolationCase.ownStatus);
	const text = JSON.stringify(response.body());
	for (const marker of isolationCase.ownMarkers(a)) {
		assert.include(
			text,
			marker,
			`the answer to A's path mentions A (${marker})`,
		);
	}
	for (const marker of publicMarkers(b)) {
		assert.notInclude(
			text,
			marker,
			`the answer to A's path mentions studio B (${marker})`,
		);
	}
	assert.deepEqual(
		await isolationCase.snapshot(b),
		before,
		`${isolationCase.method} ${isolationCase.pattern} changed studio B`,
	);
}
