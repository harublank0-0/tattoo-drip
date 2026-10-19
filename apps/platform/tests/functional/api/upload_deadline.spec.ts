import testUtils from "@adonisjs/core/services/test_utils";
import { test } from "@japa/runner";
import {
	closedWithin,
	rawRequest,
	readResponse,
	waitFor,
} from "#tests/helpers/raw_http";
import { studioWithOwner } from "#tests/helpers/tenants";
import { newTempUploads, tempUploads } from "#tests/helpers/uploads";
import { hooks } from "#tests/support/test_routes";

const SLUG = "deadline-38";

test.group("Public API: the upload deadline", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());
	group.each.setup(() => {
		hooks.length = 0;
	});

	test("an upload that trickles past its deadline is a 408, rolls back, frees its file and closes", async ({
		assert,
	}) => {
		await studioWithOwner(SLUG);
		const before = await tempUploads();
		const socket = await rawRequest(
			[
				`POST /api/v1/tenants/${SLUG}/__test/upload HTTP/1.1`,
				"Content-Type: multipart/form-data; boundary=td38",
				"Content-Length: 1000000",
			],
			'--td38\r\nContent-Disposition: form-data; name="photo"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nAAAA',
		);
		const trickle = setInterval(() => {
			if (!socket.destroyed) socket.write("A");
		}, 100);
		try {
			const started = Date.now();
			const response = await readResponse(socket, 3000);

			assert.equal(response.status, 408);
			assert.equal(JSON.parse(response.body).error.code, "request_timeout");
			assert.isBelow(Date.now() - started, 2000);
			assert.equal(response.headers.connection, "close");
			assert.isTrue(await closedWithin(socket, 1000));
			assert.include(hooks, "upload-rollback");
			await waitFor(
				async () => (await newTempUploads(before)).length === 0,
				"the trickled upload's temp file to go",
			);
		} finally {
			clearInterval(trickle);
			socket.destroy();
		}
	});

	test("an upload within its deadline is read", async ({ client }) => {
		await studioWithOwner(SLUG);

		const response = await client
			.post(`/api/v1/tenants/${SLUG}/__test/upload`)
			.file("photo", Buffer.from("AAAA"), {
				filename: "a.png",
				contentType: "image/png",
			});

		response.assertStatus(200);
		response.assertBody({ data: { files: 1 } });
	});
});
