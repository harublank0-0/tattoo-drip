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

test.group("alert details (TAT-102)", () => {
	const inquiry = (clientName: string, idea: string) => ({
		kind: "new_inquiry" as const,
		clientName,
		idea,
	});
	const proof = (clientName: string, amountText: string | null) => ({
		kind: "deposit_proof" as const,
		clientName,
		amountText,
	});

	test("a new inquiry reads as the client's first name and the start of the idea", ({
		assert,
	}) => {
		const content = inquiry("Sita Thapa", "A koi fish swimming up my calf");

		assert.deepEqual(alertCopy("new_inquiry", true, content), {
			title: "New inquiry",
			detail: "Sita: A koi fish swimming up my calf",
		});
		// The asked-for artist hears the same words the email gave them.
		assert.deepEqual(alertCopy("new_inquiry", false, content), {
			title: "A new inquiry asks for you",
			detail: "Sita: A koi fish swimming up my calf",
		});
	});

	test("a long idea is cut at a word after 80 characters, with an ellipsis, on one line", ({
		assert,
	}) => {
		const idea =
			"A koi fish swimming up my calf with a few waves and some lotus flowers around it,\nshaded softly\tin grey";
		const { detail } = alertCopy("new_inquiry", true, inquiry("Sita", idea));

		assert.equal(
			detail,
			"Sita: A koi fish swimming up my calf with a few waves and some lotus flowers around…",
		);
		assert.notMatch(detail, /[\n\t]/);
		assert.equal(
			alertCopy("new_inquiry", true, inquiry("Sita", "x".repeat(81))).detail,
			`Sita: ${"x".repeat(80)}…`,
		);
	});

	test("a Devanagari name and idea stay whole: the first name is the first word and no syllable is cut", ({
		assert,
	}) => {
		const words = alertCopy(
			"new_inquiry",
			true,
			inquiry("सीता थापा", "नमस्ते ".repeat(30)),
		).detail;
		assert.equal(words, `सीता: ${Array(20).fill("नमस्ते").join(" ")}…`);

		// No space to cut at: the cut falls between syllables, never inside one.
		const joined = alertCopy(
			"new_inquiry",
			true,
			inquiry("सीता थापा", "नमस्ते".repeat(40)),
		).detail;
		assert.equal(joined, `सीता: ${"नमस्ते".repeat(26)}नम…`);
	});

	test("a blank name reads as 'A client'; a blank idea keeps the old line after the name", ({
		assert,
	}) => {
		assert.equal(
			alertCopy("new_inquiry", true, inquiry("   ", "A koi fish")).detail,
			"A client: A koi fish",
		);
		assert.equal(
			alertCopy("new_inquiry", true, inquiry("Sita Thapa", " \n ")).detail,
			"Sita: Open it in the inbox.",
		);
	});

	test("a deposit screenshot reads as the first name and the amount for an owner", ({
		assert,
	}) => {
		assert.deepEqual(
			alertCopy("deposit_proof", true, proof("Sita Thapa", "NPR 3,000")),
			{ title: "Deposit screenshot to check", detail: "Sita: NPR 3,000" },
		);
		assert.deepEqual(
			alertCopy("deposit_proof", true, proof("सीता थापा", "NPR 1,50,000")),
			{
				title: "Deposit screenshot to check",
				detail: "सीता: NPR 1,50,000",
			},
		);
		// Without an amount the owner still gets the name and the pointer.
		assert.equal(
			alertCopy("deposit_proof", true, proof("Sita", null)).detail,
			"Sita: Open the project's Payments card.",
		);
	});

	test("an artist's deposit alert names the client but never shows an amount", ({
		assert,
	}) => {
		assert.deepEqual(
			alertCopy("deposit_proof", false, proof("Sita Thapa", "NPR 3,000")),
			{
				title: "A deposit screenshot for your project",
				detail: "Sita: An owner checks it on the Payments card.",
			},
		);
	});

	test("without content, or with content of the other kind, the line is the old one", ({
		assert,
	}) => {
		assert.equal(
			alertCopy("new_inquiry", true, null).detail,
			"Open it in the inbox.",
		);
		assert.equal(
			alertCopy("deposit_proof", false, undefined).detail,
			"An owner checks it on the Payments card.",
		);
		assert.equal(
			alertCopy("new_inquiry", true, proof("Sita", "NPR 3,000")).detail,
			"Open it in the inbox.",
		);
	});
});
