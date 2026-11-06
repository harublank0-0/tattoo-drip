import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import ReferenceCode from "#modules/references/models/reference_code";
import { REFERENCE_TRIES } from "#modules/references/reference_codes";
import ReferenceCodeService from "#modules/references/services/reference_code_service";
import { inTenant, studioWithOwner } from "#tests/helpers/tenants";

const FORMAT = /^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

/** A service whose draws come from `codes`, in order (the last repeats). */
class ScriptedService extends ReferenceCodeService {
	draws = 0;
	constructor(private codes: string[]) {
		super();
	}
	protected override newCode(): string {
		const code = this.codes[Math.min(this.draws, this.codes.length - 1)];
		this.draws++;
		return code;
	}
}

test.group("ReferenceCodeService", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("claim draws a code in the reference format and registers it for the studio", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		const code = await inTenant(tenant, () =>
			new ReferenceCodeService().claim(tenant),
		);

		assert.match(code, FORMAT);
		const rows = await inTenant(tenant, () => ReferenceCode.query());
		assert.deepEqual(
			rows.map((row) => [row.tenantId, row.code]),
			[[tenant.id, code]],
		);
	});

	test("a code the studio already holds is drawn again; after REFERENCE_TRIES collisions the unique violation surfaces", async ({
		assert,
	}) => {
		const { tenant } = await studioWithOwner();
		await inTenant(tenant, () => new ScriptedService(["K7MP3Q"]).claim(tenant));

		const retried = new ScriptedService(["K7MP3Q", "ZZZZZ2"]);
		const code = await inTenant(tenant, () => retried.claim(tenant));
		assert.equal(code, "ZZZZZ2");
		assert.equal(retried.draws, 2);

		const stuck = new ScriptedService(["K7MP3Q"]);
		await assert.rejects(
			() => inTenant(tenant, () => stuck.claim(tenant)),
			/reference_codes_tenant_id_code_unique/,
		);
		assert.equal(stuck.draws, REFERENCE_TRIES);
		// The failed tries rolled back their savepoints: two codes, nothing more.
		const rows = await inTenant(tenant, () => ReferenceCode.query());
		assert.lengthOf(rows, 2);
	});

	test("two studios may hold the same code", async ({ assert }) => {
		const a = await studioWithOwner("refs-a", "Refs A");
		const b = await studioWithOwner("refs-b", "Refs B");
		const codeA = await inTenant(a.tenant, () =>
			new ScriptedService(["K7MP3Q"]).claim(a.tenant),
		);
		const codeB = await inTenant(b.tenant, () =>
			new ScriptedService(["K7MP3Q"]).claim(b.tenant),
		);
		assert.equal(codeA, "K7MP3Q");
		assert.equal(codeB, "K7MP3Q");
	});

	test("another tenant's codes are invisible, and none can be inserted for it, from this tenant's context", async ({
		assert,
	}) => {
		const a = await studioWithOwner("refs-a", "Refs A");
		const b = await studioWithOwner("refs-b", "Refs B");
		await inTenant(a.tenant, () =>
			new ScriptedService(["K7MP3Q"]).claim(a.tenant),
		);

		const seenFromB = await inTenant(b.tenant, () => ReferenceCode.query());
		assert.lengthOf(seenFromB, 0);
		// Studio A's ref, studio B's context: row-level security's check refuses it.
		await assert.rejects(() =>
			inTenant(b.tenant, () => new ScriptedService(["ZZZZZ2"]).claim(a.tenant)),
		);
	});
});
