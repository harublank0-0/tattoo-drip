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
		studio.depositProject.id,
		studio.depositReferenceCode,
	];
}

/** Whole path segments only: ":tokens" is not ":token". */
const segment = (name: string) => new RegExp(`:${name}(?=/|$)`);

/**
 * The case's URL under `slugOwner`'s slug, with `params` for the pattern's
 * other parameters. A parameter left without a value is a mistake in the
 * case table, so it fails loudly.
 */
function urlFor(
	{ pattern }: PublicIsolationCase,
	slugOwner: Studio,
	params: Record<string, string> = {},
) {
	let url = pattern.replace(segment("tenant"), slugOwner.tenant.slug);
	for (const [name, value] of Object.entries(params)) {
		url = url.replace(segment(name), encodeURIComponent(value));
	}
	if (/\/:/.test(url)) {
		throw new Error(
			`${pattern}: give the case \`params\` for every parameter but :tenant`,
		);
	}
	return url;
}

/** Sends the case's request to `url` with `own`'s body and files. */
async function send(
	client: ApiClient,
	isolationCase: PublicIsolationCase,
	url: string,
	own: Studio,
) {
	const request = client.request(url, isolationCase.method);
	const body = isolationCase.body?.(own);
	if (isolationCase.encoding === "multipart") {
		if (body) request.fields(body as Record<string, string>);
		for (const part of (await isolationCase.files?.(own)) ?? []) {
			request.file(part.field, part.data, {
				filename: part.name,
				contentType: part.type,
			});
		}
	} else if (body) {
		request.json(body);
	}
	return request.redirects(0);
}

/**
 * Proves a public route under studio A's path never reads or writes studio
 * B. A route with parameters besides :tenant first gets B's own values
 * under A's slug, which must be the 404 and leave B as it was. Then the
 * positive control: A's own request gives ownStatus and mentions A
 * (ownMarkers), so an empty or failing answer can't pass; it must mention
 * none of B's markers, and B's snapshot must be unchanged.
 */
export async function assertPublicIsolation(
	client: ApiClient,
	assert: Assert,
	{ a, b }: { a: Studio; b: Studio },
	isolationCase: PublicIsolationCase,
) {
	const before = await isolationCase.snapshot(b);

	if (isolationCase.params) {
		const attack = await send(
			client,
			isolationCase,
			urlFor(isolationCase, a, isolationCase.params(b)),
			a,
		);
		attack.assertStatus(404);
		assert.equal(attack.body().error?.code, "not_found");
		assert.deepEqual(
			await isolationCase.snapshot(b),
			before,
			`${isolationCase.method} ${isolationCase.pattern} with B's values under A's slug changed studio B`,
		);
	}

	const response = await send(
		client,
		isolationCase,
		urlFor(isolationCase, a, isolationCase.params?.(a)),
		a,
	);

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
