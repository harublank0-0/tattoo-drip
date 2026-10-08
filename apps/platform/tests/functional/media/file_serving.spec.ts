import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import app from "@adonisjs/core/services/app";
import drive from "@adonisjs/drive/services/main";
import { test } from "@japa/runner";

test.group("File serving", () => {
	test("tests write to tmp/storage, not the real storage folder", async ({
		assert,
	}) => {
		await drive.use("public").put("tests/where.txt", "here");

		assert.isTrue(existsSync(app.tmpPath("storage/public/tests/where.txt")));
	});

	test("a public file is served", async ({ client }) => {
		await drive.use("public").put("tests/a.txt", "hello");

		const response = await client.get("/uploads/tests/a.txt");

		response.assertStatus(200);
		response.assertTextIncludes("hello");
	});

	test("a private file without a signature gets 401", async ({ client }) => {
		await drive.use("private").put("tests/b.txt", "secret");

		const response = await client.get("/files/tests/b.txt");

		response.assertStatus(401);
	});

	test("a private file with a valid signature is served", async ({
		client,
	}) => {
		await drive.use("private").put("tests/b.txt", "secret");
		const url = await drive
			.use("private")
			.getSignedUrl("tests/b.txt", { expiresIn: "5 minutes" });

		const response = await client.get(url);

		response.assertStatus(200);
		response.assertTextIncludes("secret");
	});

	test("a signature for one file doesn't open another", async ({ client }) => {
		await drive.use("private").put("tests/b.txt", "secret");
		await drive.use("private").put("tests/c.txt", "other secret");
		const url = await drive.use("private").getSignedUrl("tests/b.txt");

		const response = await client.get(
			url.replace("tests/b.txt", "tests/c.txt"),
		);

		response.assertStatus(401);
	});

	test("an expired signature gets 401", async ({ client }) => {
		await drive.use("private").put("tests/b.txt", "secret");
		const url = await drive
			.use("private")
			.getSignedUrl("tests/b.txt", { expiresIn: "1s" });
		await sleep(1500);

		const response = await client.get(url);

		response.assertStatus(401);
	});

	test("a private file isn't reachable through the public route", async ({
		client,
		assert,
	}) => {
		await drive.use("private").put("tests/d.txt", "secret");

		const response = await client.get("/uploads/tests/d.txt");

		response.assertStatus(404);
		assert.notInclude(response.text(), "secret");
	});

	test("an encoded ../ can't escape the disk", async ({ client, assert }) => {
		const response = await client.get("/uploads/..%2F..%2Fpackage.json");

		response.assertStatus(404);
		assert.notInclude(response.text(), "@tattoo-drip/platform");
	});
});
