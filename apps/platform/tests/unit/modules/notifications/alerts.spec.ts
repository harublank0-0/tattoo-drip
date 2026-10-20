import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	alertCopy,
	alertTarget,
	alertTimeText,
	dashboardUrl,
	depositProofSubject,
	excerpt,
	inquiryIntro,
	inquiryRecipients,
	newInquirySubject,
	paymentsCardPath,
	proofIntro,
} from "#modules/notifications/alerts";

const KTM = "Asia/Kathmandu";

test.group("excerpt", () => {
	test("short text is kept, with its whitespace collapsed", ({ assert }) => {
		assert.equal(excerpt("A koi  on\nthe calf"), "A koi on the calf");
		assert.equal(excerpt("x".repeat(140)), "x".repeat(140));
	});

	test("long text is cut at a word, or at the limit, with an ellipsis", ({
		assert,
	}) => {
		const long =
			"A fine-line peony with two leaves wrapping around the wrist, shaded softly, with a tiny bee near the stem and some dots like pollen falling down towards the hand";
		assert.equal(
			excerpt(long),
			"A fine-line peony with two leaves wrapping around the wrist, shaded softly, with a tiny bee near the stem and some dots like pollen falling…",
		);
		assert.equal(excerpt("x".repeat(150)), `${"x".repeat(140)}…`);
	});

	test("never cuts a Devanagari syllable or an emoji in half", ({ assert }) => {
		assert.equal(excerpt("नमस्ते ".repeat(30), 10), "नमस्ते नमस्ते…");
		assert.equal(excerpt("नमस्तेनमस्तेनमस्तेनमस्ते", 4), "नमस्तेन…");
		assert.equal(excerpt("🙏🏽".repeat(5), 3), "🙏🏽🙏🏽🙏🏽…");
	});
});

test.group("new-inquiry alerts", () => {
	test("every owner, then the asked-for artist's member, each once", ({
		assert,
	}) => {
		const owner = {
			userId: "u-owner",
			role: "owner",
			email: "o@x.test",
			fullName: "Ram",
		};
		const second = {
			userId: "u-second",
			role: "owner",
			email: "s@x.test",
			fullName: null,
		};
		const asha = {
			userId: "u-asha",
			role: "artist",
			email: "a@x.test",
			fullName: "Asha",
		};
		const other = {
			userId: "u-other",
			role: "artist",
			email: "x@x.test",
			fullName: null,
		};
		const members = [owner, asha, second, other];
		const who = (preferred: string | null) =>
			inquiryRecipients(members, preferred).map(({ userId, askedForYou }) => [
				userId,
				askedForYou,
			]);

		assert.deepEqual(who(null), [
			["u-owner", false],
			["u-second", false],
		]);
		assert.deepEqual(who("u-asha"), [
			["u-owner", false],
			["u-second", false],
			["u-asha", true],
		]);
		assert.deepEqual(who("u-second"), [
			["u-owner", false],
			["u-second", true],
		]);
		assert.deepEqual(who("u-stranger"), [
			["u-owner", false],
			["u-second", false],
		]);
	});

	test("the email's intro, subject and link", ({ assert }) => {
		const intro = (over: Partial<Parameters<typeof inquiryIntro>[0]>) =>
			inquiryIntro({
				clientName: "Sita Rai",
				studioName: "Black Needle",
				artistName: null,
				askedForYou: false,
				...over,
			});

		assert.equal(
			intro({ artistName: "Asha", askedForYou: true }),
			"Sita sent Black Needle a new tattoo inquiry and asked for you:",
		);
		assert.equal(
			intro({ artistName: "Asha" }),
			"Sita sent Black Needle a new tattoo inquiry and asked for Asha:",
		);
		assert.equal(intro({}), "Sita sent Black Needle a new tattoo inquiry:");
		assert.equal(
			intro({ clientName: "  " }),
			"A client sent Black Needle a new tattoo inquiry:",
		);
		assert.equal(
			newInquirySubject("Black Needle"),
			"New inquiry for Black Needle",
		);
		assert.equal(
			dashboardUrl("https://app.example.com", "/t/black-needle/inbox/abc"),
			"https://app.example.com/t/black-needle/inbox/abc",
		);
		assert.equal(
			dashboardUrl("http://localhost:3401/", "/t/x/inbox/1"),
			"http://localhost:3401/t/x/inbox/1",
		);
	});

	test("the in-app line and where opening it goes", ({ assert }) => {
		assert.deepEqual(alertCopy("new_inquiry", true), {
			title: "New inquiry",
			detail: "Open it in the inbox.",
		});
		assert.deepEqual(alertCopy("new_inquiry", false), {
			title: "A new inquiry asks for you",
			detail: "An owner reviews it in the inbox.",
		});
		assert.deepEqual(
			alertTarget({ kind: "new_inquiry", inquiryId: "i-1" }, "owner"),
			{ route: "tenant.inbox.show", id: "i-1" },
		);
		assert.isNull(
			alertTarget({ kind: "new_inquiry", inquiryId: "i-1" }, "artist"),
		);
		assert.isNull(
			alertTarget({ kind: "new_inquiry", inquiryId: null }, "owner"),
		);
	});

	test("when it came, in the studio's timezone", ({ assert }) => {
		const now = DateTime.fromISO("2026-10-19T10:00:00Z");
		const at = (iso: string) => DateTime.fromISO(iso);

		assert.equal(
			alertTimeText(at("2026-10-19T08:00:00Z"), KTM, now),
			"Today, 13:45",
		);
		// 20:00 UTC on 18 Oct is 01:45 on 19 Oct in Kathmandu.
		assert.equal(
			alertTimeText(at("2026-10-18T20:00:00Z"), KTM, now),
			"Today, 01:45",
		);
		assert.equal(
			alertTimeText(at("2026-10-18T20:00:00Z"), "UTC", now),
			"Yesterday, 20:00",
		);
		assert.equal(
			alertTimeText(at("2026-10-18T05:00:00Z"), KTM, now),
			"Yesterday, 10:45",
		);
		assert.equal(
			alertTimeText(at("2026-10-01T05:00:00Z"), KTM, now),
			"1 Oct, 10:45",
		);
		assert.equal(
			alertTimeText(at("2025-12-31T05:00:00Z"), KTM, now),
			"31 Dec 2025, 10:45",
		);
	});
});

test.group("deposit-proof alerts (TAT-88)", () => {
	test("the email's intro, subject and link to the Payments card", ({
		assert,
	}) => {
		const intro = (over: Partial<Parameters<typeof proofIntro>[0]>) =>
			proofIntro({
				clientName: "Sita Rai",
				studioName: "Black Needle",
				yourProject: false,
				...over,
			});

		assert.equal(intro({}), "Sita sent Black Needle a deposit screenshot.");
		assert.equal(
			intro({ yourProject: true }),
			"Sita sent Black Needle a deposit screenshot for your project.",
		);
		assert.equal(
			intro({ clientName: "  " }),
			"A client sent Black Needle a deposit screenshot.",
		);
		assert.equal(
			intro({ clientName: "सीता राई" }),
			"सीता sent Black Needle a deposit screenshot.",
		);
		assert.equal(
			depositProofSubject("Black Needle"),
			"Deposit screenshot for Black Needle",
		);
		assert.equal(
			paymentsCardPath("black-needle", "p-1"),
			"/t/black-needle/projects/p-1#payments",
		);
		assert.equal(
			dashboardUrl("https://app.example.com", paymentsCardPath("x", "p-1")),
			"https://app.example.com/t/x/projects/p-1#payments",
		);
	});

	test("the in-app line and where opening it goes", ({ assert }) => {
		assert.deepEqual(alertCopy("deposit_proof", true), {
			title: "Deposit screenshot to check",
			detail: "Open the project's Payments card.",
		});
		assert.deepEqual(alertCopy("deposit_proof", false), {
			title: "A deposit screenshot for your project",
			detail: "An owner checks it on the Payments card.",
		});
		const proof = {
			kind: "deposit_proof" as const,
			inquiryId: null,
			projectId: "p-1",
		};
		for (const role of ["owner", "artist"]) {
			assert.deepEqual(
				alertTarget(proof, role),
				{ route: "tenant.projects.show", id: "p-1", hash: "payments" },
				role,
			);
		}
		assert.isNull(alertTarget({ ...proof, projectId: null }, "owner"));
		// A new-inquiry alert never opens a project, whatever the row holds.
		assert.isNull(
			alertTarget(
				{ kind: "new_inquiry", inquiryId: null, projectId: "p-1" },
				"owner",
			),
		);
	});
});
