import { test } from "@japa/runner";
import {
	cardKinds,
	cardValues,
	defaultCardKind,
} from "#modules/notifications/project_messages";

test.group("cardKinds", () => {
	test("inquiry received under review; the session messages with a session to come; aftercare once work is done", ({
		assert,
	}) => {
		const none = { upcomingSession: false, finishedWork: false };
		assert.deepEqual(cardKinds({ status: "reviewing", ...none }), [
			"inquiry_received",
		]);
		assert.deepEqual(cardKinds({ status: "quoted", ...none }), []);
		assert.deepEqual(
			cardKinds({
				status: "booked",
				upcomingSession: true,
				finishedWork: false,
			}),
			["booking_confirmation", "session_reminder"],
		);
		assert.deepEqual(
			cardKinds({
				status: "in_progress",
				upcomingSession: true,
				finishedWork: true,
			}),
			["booking_confirmation", "session_reminder", "aftercare"],
		);
		assert.deepEqual(
			cardKinds({
				status: "completed",
				upcomingSession: false,
				finishedWork: true,
			}),
			["aftercare"],
		);
		assert.deepEqual(
			cardKinds({
				status: "reviewing",
				upcomingSession: true,
				finishedWork: false,
			}),
			["inquiry_received", "booking_confirmation", "session_reminder"],
		);
	});

	test("a declined or cancelled project offers none", ({ assert }) => {
		for (const status of ["declined", "cancelled"] as const) {
			assert.deepEqual(
				cardKinds({ status, upcomingSession: true, finishedWork: true }),
				[],
				status,
			);
		}
	});
});

test.group("defaultCardKind", () => {
	test("starts on what the project's status most likely needs", ({
		assert,
	}) => {
		assert.equal(
			defaultCardKind("reviewing", [
				"inquiry_received",
				"booking_confirmation",
				"session_reminder",
			]),
			"inquiry_received",
		);
		assert.equal(
			defaultCardKind("booked", [
				"booking_confirmation",
				"session_reminder",
				"aftercare",
			]),
			"booking_confirmation",
		);
		assert.equal(
			defaultCardKind("in_progress", [
				"booking_confirmation",
				"session_reminder",
				"aftercare",
			]),
			"aftercare",
		);
		assert.equal(
			defaultCardKind("deposit_pending", [
				"booking_confirmation",
				"session_reminder",
			]),
			"session_reminder",
		);
		assert.isNull(defaultCardKind("quoted", []));
	});
});

test.group("cardValues", () => {
	test("names the next session and its artist, and 'your artist' when there is none", ({
		assert,
	}) => {
		const facts = {
			clientName: " Sita Rai",
			studioName: "Black Needle",
			studioAddress: null,
			projectArtistName: null,
			session: { whenText: "Mon 2 Nov 2026, 15:45–17:45", artistName: "Asha" },
		};

		assert.deepEqual(cardValues("inquiry_received", facts), {
			client_name: "Sita",
			studio_name: "Black Needle",
		});
		assert.deepEqual(cardValues("session_reminder", facts), {
			client_name: "Sita",
			studio_name: "Black Needle",
			artist_name: "Asha",
			session_time: "Mon 2 Nov 2026, 15:45–17:45",
			studio_address: "",
		});
		assert.deepEqual(cardValues("aftercare", facts), {
			client_name: "Sita",
			studio_name: "Black Needle",
			artist_name: "your artist",
		});
		assert.equal(
			cardValues("booking_confirmation", {
				...facts,
				session: { whenText: "x", artistName: null },
			}).artist_name,
			"your artist",
		);
	});
});
