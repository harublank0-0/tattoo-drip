import { test } from "@japa/runner";
import { MAX_WORK_PHOTOS as SERVER_MAX } from "#modules/artists/services/work_photo_service";
import { MAX_PHOTO_STYLES as SERVER_MAX_STYLES } from "#modules/artists/styles";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PhotosModule` below restates its shape and the inertia project type-checks the real one.
import * as photosModule from "../../../inertia/components/photos.js";

type UploadOutcome =
	| { kind: "added" }
	| { kind: "refused"; message: string }
	| { kind: "cancelled" };

type PhotosModule = {
	MAX_WORK_PHOTOS: number;
	MAX_PHOTO_ALT: number;
	MAX_PHOTO_STYLES: number;
	photoCount(count: number): string;
	photoAlt(alt: string | null, n: number, count: number): string;
	trayIntro(owner: boolean): string;
	uploadingText(percentage?: number): string;
	canAddPhoto(count: number): boolean;
	uploadingPhotos(index: number, total: number, percentage?: number): string;
	roomNote(room: number, chosen: number): string | null;
	addedLine(added: number, refused: number): string;
	failureLine(name: string, message: string): string;
	trackUpload(): {
		outcome(): UploadOutcome;
		callbacks: {
			onSuccess(): void;
			onError(errors: Record<string, string | undefined>): void;
			onCancel(): void;
			onHttpException(): false;
			onNetworkError(): false;
		};
	};
	editLabel(n: number, alt: string | null): string;
	tileNote(styleCount: number, healed: boolean): string | null;
	UPLOAD_LABEL: string;
	UPLOAD_HELP: string;
	UPLOAD_FAILED: string;
	UPLOAD_INTERRUPTED: string;
	STYLES_HELP: string;
	HEALED_LABEL: string;
	HEALED_HELP: string;
	SHEET_HELP: string;
	TRAY_FULL: string;
	NO_PHOTOS: string;
	TRAY_CREATE_NOTE: string;
	REMOVE_PHOTO_QUESTION: string;
	REMOVE_COVER_QUESTION: string;
	COVER_PREVIEW_NOTE: string;
	NO_COVER: string;
	coverButton(
		hasCover: boolean,
		processing: boolean,
		percentage?: number,
	): string;
};
const photos = photosModule as PhotosModule;

test.group("work photo words (TAT-116)", () => {
	test("the limit is 100 and the server's", ({ assert }) => {
		assert.equal(photos.MAX_WORK_PHOTOS, 100);
		assert.equal(photos.MAX_WORK_PHOTOS, SERVER_MAX);
	});

	test("the count reads 'n of 100 photos'", ({ assert }) => {
		assert.equal(photos.photoCount(0), "0 of 100 photos");
		assert.equal(photos.photoCount(37), "37 of 100 photos");
		assert.equal(photos.photoCount(100), "100 of 100 photos");
	});

	test("a photo's alt is its description, else its place in the set", ({
		assert,
	}) => {
		assert.equal(photos.photoAlt(null, 2, 5), "Photo 2 of 5");
		assert.equal(photos.photoAlt("Koi", 2, 5), "Koi");
		assert.equal(photos.photoAlt("कालो माछा", 1, 2), "कालो माछा");
		assert.equal(photos.photoAlt("", 1, 2), "Photo 1 of 2");
	});

	test("the intro speaks to an owner about 'this artist' and to an artist about 'your work'", ({
		assert,
	}) => {
		assert.equal(
			photos.trayIntro(true),
			"Up to 100 photos of this artist's work. Your page shows them newest first: on the artist's page, in Recent work and in All work.",
		);
		assert.equal(
			photos.trayIntro(false),
			"Up to 100 photos of your work. The studio page shows them newest first: on your page, in Recent work and in All work.",
		);
	});

	test("the upload button names the progress when there is one", ({
		assert,
	}) => {
		assert.equal(photos.uploadingText(42), "Uploading… 42%");
		assert.equal(photos.uploadingText(0), "Uploading… 0%");
		assert.equal(photos.uploadingText(undefined), "Uploading…");
	});

	test("a photo can be added until there are 100", ({ assert }) => {
		assert.isTrue(photos.canAddPhoto(0));
		assert.isTrue(photos.canAddPhoto(99));
		assert.isFalse(photos.canAddPhoto(100));
		assert.isFalse(photos.canAddPhoto(101));
	});

	test("photos can no longer be moved", ({ assert }) => {
		assert.notProperty(photosModule, "moves");
		assert.notProperty(photosModule, "moveLabel");
	});

	test("a photo carries up to 3 styles, the server's limit", ({ assert }) => {
		assert.equal(photos.MAX_PHOTO_STYLES, 3);
		assert.equal(photos.MAX_PHOTO_STYLES, SERVER_MAX_STYLES);
	});

	test("the upload button counts the files and shows the one on its way", ({
		assert,
	}) => {
		assert.equal(photos.uploadingPhotos(1, 1), "Uploading…");
		assert.equal(photos.uploadingPhotos(1, 1, 40), "Uploading… 40%");
		assert.equal(photos.uploadingPhotos(1, 1, 0), "Uploading… 0%");
		assert.equal(photos.uploadingPhotos(2, 5), "Uploading 2 of 5…");
		assert.equal(photos.uploadingPhotos(2, 5, 40), "Uploading 2 of 5… 40%");
	});

	test("choosing more files than there is room for is told, and nothing is sent", ({
		assert,
	}) => {
		assert.equal(
			photos.roomNote(3, 5),
			"There's room for 3 more photos. Choose 3 or fewer.",
		);
		assert.equal(
			photos.roomNote(1, 2),
			"There's room for 1 more photo. Choose 1.",
		);
		assert.isNull(photos.roomNote(5, 5));
		assert.isNull(photos.roomNote(5, 1));
	});

	test("the summary after an upload counts what was added and what was refused", ({
		assert,
	}) => {
		assert.equal(photos.addedLine(1, 0), "1 photo added.");
		assert.equal(photos.addedLine(5, 0), "5 photos added.");
		assert.equal(
			photos.addedLine(4, 1),
			"4 photos added. This one couldn't be added:",
		);
		assert.equal(
			photos.addedLine(3, 2),
			"3 photos added. These 2 couldn't be added:",
		);
		assert.equal(photos.addedLine(0, 1), "This photo couldn't be added:");
		assert.equal(photos.addedLine(0, 3), "These 3 photos couldn't be added:");
		assert.equal(
			photos.failureLine("IMG_2.heic", "Use a JPEG, PNG or WebP image."),
			"IMG_2.heic: Use a JPEG, PNG or WebP image.",
		);
	});

	test("a tile is named for its place and description, and notes its styles and healed mark", ({
		assert,
	}) => {
		assert.equal(photos.editLabel(3, null), "Edit photo 3");
		assert.equal(photos.editLabel(3, "Koi"), "Edit photo 3: Koi");
		assert.equal(photos.editLabel(3, ""), "Edit photo 3");
		assert.equal(photos.tileNote(2, true), "2 styles · Healed");
		assert.equal(photos.tileNote(1, false), "1 style");
		assert.equal(photos.tileNote(0, true), "Healed");
		assert.isNull(photos.tileNote(0, false));
	});

	test("the upload and details words", ({ assert }) => {
		assert.equal(photos.UPLOAD_LABEL, "Add photos");
		assert.equal(
			photos.UPLOAD_HELP,
			"Choose one or more. JPEG, PNG or WebP, up to 10 MB each. Photos from a phone work as they are.",
		);
		assert.equal(photos.UPLOAD_FAILED, "It didn't upload. Try again.");
		assert.equal(
			photos.UPLOAD_INTERRUPTED,
			"Not sent: the upload was interrupted.",
		);
		assert.equal(photos.STYLES_HELP, "Up to 3.");
		assert.equal(photos.HEALED_LABEL, "Healed");
		assert.equal(
			photos.HEALED_HELP,
			"The photo shows the tattoo once it healed.",
		);
		assert.equal(
			photos.SHEET_HELP,
			"Tell clients what it shows, and tag it so they can find it.",
		);
	});

	test("the fixed sentences", ({ assert }) => {
		assert.equal(photos.NO_PHOTOS, "No photos yet.");
		assert.equal(
			photos.TRAY_FULL,
			"That's 100 photos, the most an artist can show. Remove one to add another.",
		);
		assert.equal(
			photos.TRAY_CREATE_NOTE,
			"Once the artist is saved, you can add up to 100 photos of their work here.",
		);
		assert.equal(
			photos.REMOVE_PHOTO_QUESTION,
			"Remove this photo? Clients won't see it any more, and it can't be brought back.",
		);
		assert.equal(
			photos.REMOVE_COVER_QUESTION,
			"Remove the cover photo? Your page will open with your studio's name on its own.",
		);
		assert.equal(
			photos.NO_COVER,
			"No cover yet. Your page opens with your studio's name on its own.",
		);
		assert.equal(
			photos.COVER_PREVIEW_NOTE,
			"Phones show it like this. Wide screens show a wider strip of it.",
		);
	});

	test("the cover button says upload, replace or the wait", ({ assert }) => {
		assert.equal(photos.coverButton(false, false), "Upload cover");
		assert.equal(photos.coverButton(true, false), "Replace cover");
		assert.equal(photos.coverButton(true, true, 10), "Uploading… 10%");
		assert.equal(photos.coverButton(false, true), "Uploading…");
	});
});

test.group("one file's upload visit (TAT-126 fix round 2)", () => {
	test("a visit that ends with no answer is refused, never added", ({
		assert,
	}) => {
		const upload = photos.trackUpload();

		assert.deepEqual(upload.outcome(), {
			kind: "refused",
			message: photos.UPLOAD_FAILED,
		});
	});

	test("an HTTP error status is refused and named: onHttpException returns false, so Inertia neither renders the error page nor runs onSuccess", ({
		assert,
	}) => {
		// What Inertia 3.8 does for a 5xx page in production: it calls onHttpException
		// and, only when that returns exactly false, stops (no onSuccess, no onError);
		// onFinish follows either way.
		const upload = photos.trackUpload();

		assert.strictEqual(upload.callbacks.onHttpException(), false);
		assert.deepEqual(upload.outcome(), {
			kind: "refused",
			message: photos.UPLOAD_FAILED,
		});
		const outcome = upload.outcome();
		assert.equal(outcome.kind, "refused");
		if (outcome.kind === "refused") {
			assert.equal(
				photos.failureLine("IMG_9.jpg", outcome.message),
				"IMG_9.jpg: It didn't upload. Try again.",
			);
		}
		// The connection lost is handled the same way.
		assert.strictEqual(upload.callbacks.onNetworkError(), false);
	});

	test("a clear answer decides the outcome", ({ assert }) => {
		const added = photos.trackUpload();
		added.callbacks.onSuccess();
		assert.deepEqual(added.outcome(), { kind: "added" });

		const refused = photos.trackUpload();
		refused.callbacks.onError({ photo: "Use a JPEG, PNG or WebP image." });
		assert.deepEqual(refused.outcome(), {
			kind: "refused",
			message: "Use a JPEG, PNG or WebP image.",
		});

		const unsaid = photos.trackUpload();
		unsaid.callbacks.onError({});
		assert.deepEqual(unsaid.outcome(), {
			kind: "refused",
			message: photos.UPLOAD_FAILED,
		});

		const cancelled = photos.trackUpload();
		cancelled.callbacks.onCancel();
		assert.deepEqual(cancelled.outcome(), { kind: "cancelled" });
	});

	test("each visit has its own outcome", ({ assert }) => {
		const first = photos.trackUpload();
		const second = photos.trackUpload();
		first.callbacks.onSuccess();

		assert.equal(first.outcome().kind, "added");
		assert.equal(second.outcome().kind, "refused");
	});
});
