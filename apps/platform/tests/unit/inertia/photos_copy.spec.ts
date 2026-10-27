import { test } from "@japa/runner";
import { MAX_WORK_PHOTOS as SERVER_MAX } from "#modules/artists/services/work_photo_service";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PhotosModule` below restates its shape and the inertia project type-checks the real one.
import * as photosModule from "../../../inertia/components/photos.js";

type PhotosModule = {
	MAX_WORK_PHOTOS: number;
	MAX_PHOTO_ALT: number;
	photoCount(count: number): string;
	photoAlt(alt: string | null, n: number, count: number): string;
	trayIntro(owner: boolean): string;
	uploadingText(percentage?: number): string;
	canAddPhoto(count: number): boolean;
	moves(index: number, count: number): { earlier: boolean; later: boolean };
	moveLabel(direction: "up" | "down", n: number): string;
	removeLabel(n: number): string;
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
	test("the limit is the server's", ({ assert }) => {
		assert.equal(photos.MAX_WORK_PHOTOS, 6);
		assert.equal(photos.MAX_WORK_PHOTOS, SERVER_MAX);
	});

	test("the count reads 'n of 6 photos'", ({ assert }) => {
		assert.equal(photos.photoCount(0), "0 of 6 photos");
		assert.equal(photos.photoCount(4), "4 of 6 photos");
		assert.equal(photos.photoCount(6), "6 of 6 photos");
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
			"Up to 6 photos of this artist's work. The first three show on the studio page and all of them on the artist's own page, in this order.",
		);
		assert.equal(
			photos.trayIntro(false),
			"Up to 6 photos of your work. The first three show on the studio page and all of them on your own page, in this order.",
		);
	});

	test("the upload button names the progress when there is one", ({
		assert,
	}) => {
		assert.equal(photos.uploadingText(42), "Uploading… 42%");
		assert.equal(photos.uploadingText(0), "Uploading… 0%");
		assert.equal(photos.uploadingText(undefined), "Uploading…");
	});

	test("a photo can be added until there are six", ({ assert }) => {
		assert.isTrue(photos.canAddPhoto(0));
		assert.isTrue(photos.canAddPhoto(5));
		assert.isFalse(photos.canAddPhoto(6));
		assert.isFalse(photos.canAddPhoto(7));
	});

	test("the first photo can't move earlier and the last can't move later", ({
		assert,
	}) => {
		assert.deepEqual(photos.moves(0, 3), { earlier: false, later: true });
		assert.deepEqual(photos.moves(1, 3), { earlier: true, later: true });
		assert.deepEqual(photos.moves(2, 3), { earlier: true, later: false });
		assert.deepEqual(photos.moves(0, 1), { earlier: false, later: false });
	});

	test("buttons are named for the photo, counted from 1", ({ assert }) => {
		assert.equal(photos.moveLabel("up", 2), "Move photo 2 earlier");
		assert.equal(photos.moveLabel("down", 2), "Move photo 2 later");
		assert.equal(photos.removeLabel(3), "Remove photo 3");
	});

	test("the fixed sentences", ({ assert }) => {
		assert.equal(photos.NO_PHOTOS, "No photos yet.");
		assert.equal(
			photos.TRAY_FULL,
			"That's 6 photos, the most an artist can show. Remove one to add another.",
		);
		assert.equal(
			photos.TRAY_CREATE_NOTE,
			"Once the artist is saved, you can add up to 6 photos of their work here.",
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
