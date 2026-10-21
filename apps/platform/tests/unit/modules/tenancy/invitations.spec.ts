import { test } from "@japa/runner";
import { DateTime } from "luxon";
import {
	expiryText,
	INVITATION_DAYS,
	invitationPath,
	invitationUrl,
	inviteMessage,
	isNewInvitationLink,
	ROLE_WORDS,
	whatsappShareUrl,
} from "#modules/tenancy/invitations";

const TOKEN = "a".repeat(43);

test.group("Invitations (TAT-33)", () => {
	test("an invitation link is the platform's origin plus /invitations/<token>", ({
		assert,
	}) => {
		assert.equal(INVITATION_DAYS, 7);
		assert.equal(invitationPath(TOKEN), `/invitations/${TOKEN}`);
		assert.equal(
			invitationUrl("https://app.example.com", TOKEN),
			`https://app.example.com/invitations/${TOKEN}`,
		);
		assert.equal(
			invitationUrl("http://localhost:3401/", TOKEN),
			`http://localhost:3401/invitations/${TOKEN}`,
		);
	});

	test("the chat message and its WhatsApp share link keep every character", ({
		assert,
	}) => {
		const url = `https://app.example.com/invitations/${TOKEN}`;
		const text = inviteMessage("कालो सुई & Co #1+", url);
		assert.equal(
			text,
			`You're invited to join कालो सुई & Co #1+ on Tattoo Drip. Open this link to accept: ${url}`,
		);

		const share = whatsappShareUrl(text);
		assert.isTrue(share.startsWith("https://wa.me/?text="));
		assert.equal(new URL(share).searchParams.get("text"), text);
		assert.notInclude(share, "& Co");
		assert.notInclude(share, "#1");
	});

	test("the expiry reads in the studio's timezone", ({ assert }) => {
		const at = DateTime.fromISO("2026-10-27T08:20:00Z");
		assert.equal(expiryText(at, "Asia/Kathmandu"), "27 Oct 2026, 14:05");
		assert.equal(expiryText(at, "UTC"), "27 Oct 2026, 08:20");
	});

	test("roles in a sentence, and what a flashed link must hold", ({
		assert,
	}) => {
		assert.deepEqual(ROLE_WORDS, { owner: "an owner", artist: "an artist" });
		const link = {
			email: "ink@example.com",
			url: "u",
			message: "m",
			whatsappUrl: "w",
			expiresText: "e",
		};
		assert.isTrue(isNewInvitationLink(link));
		assert.isFalse(isNewInvitationLink({ ...link, url: 1 }));
		assert.isFalse(isNewInvitationLink("u"));
		assert.isFalse(isNewInvitationLink(null));
	});
});
