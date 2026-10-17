import { test } from "@japa/runner";
import { encryptsHistory } from "#services/history_encryption";

function request(protocol: string, hostname: string | null) {
	return { protocol: () => protocol, hostname: () => hostname };
}

test.group("encryptsHistory", () => {
	test("production always encrypts", ({ assert }) => {
		assert.isTrue(encryptsHistory(request("http", "192.168.1.20"), true));
		assert.isTrue(encryptsHistory(request("http", null), true));
	});

	test("development encrypts over HTTPS and on loopback hosts", ({
		assert,
	}) => {
		assert.isTrue(encryptsHistory(request("https", "192.168.1.20"), false));
		for (const host of [
			"localhost",
			"LOCALHOST",
			"app.localhost",
			"127.0.0.1",
			"127.1.2.3",
			"[::1]",
		]) {
			assert.isTrue(encryptsHistory(request("http", host), false), host);
		}
	});

	test("development skips it over plain HTTP from any other host", ({
		assert,
	}) => {
		for (const host of [
			"192.168.1.20",
			"0.0.0.0",
			"127.0.0.1.nip.io",
			"localhost.example.com",
			"mylocalhost",
			null,
		]) {
			assert.isFalse(
				encryptsHistory(request("http", host), false),
				String(host),
			);
		}
	});
});
