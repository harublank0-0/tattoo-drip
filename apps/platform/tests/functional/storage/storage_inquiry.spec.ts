import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import Inquiry from "#modules/inquiries/models/inquiry";
import { assertApiError } from "#tests/helpers/api";
import { intakeFields, png, postInquiry } from "#tests/helpers/intake";
import {
	enforceStorage,
	MB,
	smallStudio,
	storedFilesOf,
	unsetStorageEnforcement,
} from "#tests/helpers/storage";
import { inTenant } from "#tests/helpers/tenants";
import { storedReferenceImages } from "#tests/helpers/uploads";

/**
 * A client's inquiry for a studio whose storage is full (the storage meter,
 * spec ruling 4, option B): with photos it is refused as
 * `attachments_unavailable` and nothing is kept; the same inquiry without
 * them goes through.
 */
test.group("Storage: a client's inquiry for a full studio", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.teardown(() => unsetStorageEnforcement());

	test("with photos it is 409 attachments_unavailable and nothing is created; without them it is taken", async ({
		client,
		assert,
	}) => {
		const s = await smallStudio("inquiry-full", MB - 600);
		enforceStorage(true);
		const inquiries = () => inTenant(s.tenant, () => Inquiry.query());

		const refused = await postInquiry(client, s.tenant.slug, intakeFields(), [
			await png("one.png", 600, 400),
		]);

		assertApiError(refused, 409, "attachments_unavailable");
		assert.match(refused.body().error.message, /without them/);
		assert.lengthOf(await inquiries(), 0);
		assert.deepEqual(await storedReferenceImages(s.tenant), []);
		assert.deepEqual(
			(await storedFilesOf(s.tenant)).map((row) => row.status),
			["stored"],
			"only the filler; no reservation left",
		);

		const taken = await postInquiry(client, s.tenant.slug, intakeFields());
		taken.assertStatus(201);
		assert.lengthOf(await inquiries(), 1);
	});
});
