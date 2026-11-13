import { test } from "@japa/runner";
import { tokenFor } from "#modules/payments/deposit_links";
import { REVIEW_LIMITS, reviewLimitKeys } from "#modules/reviews/review_limits";
import {
	hashReviewToken,
	newReviewNonce,
	REVIEW_TOKEN,
	reviewPageUrl,
	reviewTokenFor,
} from "#modules/reviews/review_links";
import {
	charLength,
	defaultShownName,
	leadFirst,
	orderWithout,
	postContentEditable,
	reviewEditable,
	TAKEDOWN_REASONS,
	TAKEDOWN_SENTENCES,
} from "#modules/reviews/rules";

test.group("Reviews: the shown name (ruling 9)", () => {
	test("first name and the initial of the last name, never the rest", ({
		assert,
	}) => {
		assert.equal(defaultShownName("Sita Rai"), "Sita R.");
		assert.equal(defaultShownName("  Sita   Kumari   Rai "), "Sita R.");
		assert.equal(defaultShownName("Sita"), "Sita");
	});

	test("any script: the initial is the first user-perceived character", ({
		assert,
	}) => {
		assert.equal(defaultShownName("सीता राई"), "सीता रा.");
		assert.equal(defaultShownName("Zoë Ångström"), "Zoë Å.");
	});

	test("a record with no name left shows Client; a long name is cut to 40 characters", ({
		assert,
	}) => {
		assert.equal(defaultShownName("   "), "Client");
		const long = defaultShownName(`${"a".repeat(60)} Rai`);
		assert.equal(charLength(long), 40);
	});
});

test.group("Reviews: counting and the angles order", () => {
	test("characters are counted as code points, as PostgreSQL's char_length", ({
		assert,
	}) => {
		assert.equal(charLength("abc"), 3);
		assert.equal(charLength("😀😀"), 2);
		assert.equal("😀😀".length, 4);
	});

	test("a video never leads: the first photo moves to the front, and only videos is null", ({
		assert,
	}) => {
		const photo = { id: "p", kind: "photo" };
		const video = { id: "v", kind: "video" };
		const second = { id: "q", kind: "photo" };

		assert.deepEqual(leadFirst([video, photo, second]), [photo, video, second]);
		assert.isNull(leadFirst([video]));
		assert.deepEqual(leadFirst([]), []);
		assert.deepEqual(orderWithout([photo, video, second], "p"), [
			second,
			video,
		]);
		assert.isNull(orderWithout([photo, video], "p"));
		assert.deepEqual(orderWithout([photo], "p"), []);
	});

	test("what the client may still change", ({ assert }) => {
		assert.isTrue(
			postContentEditable({ status: "waiting", takenDownAt: null }),
		);
		assert.isTrue(
			postContentEditable({ status: "approved", takenDownAt: null }),
		);
		assert.isFalse(
			postContentEditable({ status: "declined", takenDownAt: null }),
		);
		assert.isFalse(
			postContentEditable({ status: "unpublished", takenDownAt: null }),
		);
		assert.isFalse(
			postContentEditable({ status: "waiting", takenDownAt: new Date() }),
		);
		assert.isTrue(reviewEditable({ takenDownAt: null }));
		assert.isFalse(reviewEditable({ takenDownAt: new Date() }));
	});

	test("every takedown reason has its fixed sentence", ({ assert }) => {
		for (const reason of TAKEDOWN_REASONS) {
			assert.isString(TAKEDOWN_SENTENCES[reason]);
		}
	});
});

test.group("Reviews: the link's token", () => {
	test("43 base64url characters from a 22-character nonce, the same for one nonce", ({
		assert,
	}) => {
		const nonce = newReviewNonce();
		assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
		const token = reviewTokenFor(nonce);
		assert.match(token, REVIEW_TOKEN);
		assert.equal(reviewTokenFor(nonce), token);
		assert.notEqual(reviewTokenFor(newReviewNonce()), token);
		assert.match(hashReviewToken(token), /^[0-9a-f]{64}$/);
	});

	test("its key is its own: a deposit link's nonce makes another token", ({
		assert,
	}) => {
		const nonce = newReviewNonce();
		assert.notEqual(reviewTokenFor(nonce), tokenFor(nonce));
	});

	test("the page's URL keeps the token in the fragment, never the path or query", ({
		assert,
	}) => {
		const token = "T".repeat(43);
		const url = reviewPageUrl(
			"black-needle",
			token,
			"https://{tenant}.tattoodrip.app",
		);
		assert.equal(url, `https://black-needle.tattoodrip.app/review#${token}`);
		const parsed = new URL(url);
		assert.notInclude(parsed.pathname + parsed.search, token);
		assert.throws(() => reviewPageUrl("x", token, "https://example.com"));
	});

	test("limit keys are digests: neither the address nor the token is stored", ({
		assert,
	}) => {
		const token = "T".repeat(43);
		const keys = reviewLimitKeys("read", "203.0.113.9", token);
		assert.notInclude(keys.perAddress, "203.0.113.9");
		assert.notInclude(keys.perToken, token);
		assert.notEqual(
			reviewLimitKeys("write", "203.0.113.9", token).perToken,
			keys.perToken,
		);
		assert.isAbove(
			REVIEW_LIMITS.read.perAddress.requests,
			REVIEW_LIMITS.read.perToken.requests,
		);
	});
});
