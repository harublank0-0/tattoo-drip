import { test } from "@japa/runner";
import {
	portfolioBack,
	MAX_TATTOO_PHOTOS as SERVER_MAX_TATTOO_PHOTOS,
} from "#modules/artists/portfolio";
import { MAX_PHOTO_STYLES as SERVER_MAX_STYLES } from "#modules/artists/styles";
// @ts-expect-error TS6305: see above.
import * as photosModule from "../../../inertia/components/photos.js";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `PortfolioModule` below restates its shape and the inertia project type-checks the real one.
import * as portfolioModule from "../../../inertia/components/portfolio.js";

type Filters = {
	search: string;
	artist: string | null;
	style: string | null;
	status: "all" | "shown" | "hidden";
	healed: boolean;
	sort: "newest" | "oldest";
};
type Artist = {
	id: string;
	name: string;
	visible: boolean;
	photoCount: number;
};
type PortfolioModule = {
	NO_FILTERS: Filters;
	MAX_PHOTO_BYTES: number;
	WRONG_FORMAT: string;
	TOO_LARGE: string;
	portfolioHref(base: string, filters: Filters, page?: number): string;
	isFiltered(filters: Filters): boolean;
	resultLine(matching: number, everything: number, filtered: boolean): string;
	tileLabel(photo: {
		alt: string | null;
		artistName: string;
		published: boolean;
		shown: boolean;
		angles: unknown[];
	}): string;
	MAX_TATTOO_PHOTOS: number;
	photosMark(photo: { angles: unknown[] }): string | null;
	removeQuestion(photos: number): string;
	removeLabel(photos: number, busy: boolean): string;
	movedOrder(ids: string[], index: number, direction: "up" | "down"): string[];
	mainFirst(ids: string[], id: string): string[];
	movePhotoLabel(name: string, direction: "up" | "down"): string;
	tattooPhotoName(alt: string | null, n: number): string;
	tattooUploadProblem(
		ready: number,
		photos: number,
		artist: { name: string; photoCount: number } | null,
		maxPhotos: number,
	): string | null;
	canGroup(count: number): boolean;
	removeQuery(
		intent: { scope: "photo" } | { scope: "tattoo"; photos: number },
		back?: string,
	): string;
	deleteSizes(
		photos: { id: string; angles: unknown[] }[],
	): Record<string, number>;
	statusText(photo: { published: boolean; shown: boolean }): string;
	statusNote(photo: { published: boolean; shown: boolean }): string | null;
	stillUnchanged(
		action: "publish" | "unpublish" | "reassign" | "delete",
		ids: string[],
		photos: { id: string; published: boolean; artistId: string }[],
		artistId: string | null,
	): string[];
	deleteQuestion(count: number, photos?: number): string;
	tileMeta(
		styles: string[],
		healed: boolean,
		names: Record<string, string>,
	): string | null;
	fileProblem(file: {
		name: string;
		type: string;
		size: number;
	}): string | null;
	fileSizeText(bytes: number): string;
	planUpload(files: { name: string; type: string; size: number }[]): {
		send: number[];
		skip: { index: number; reason: string }[];
	};
	uploadProblem(
		artist: Artist | null,
		ready: number,
		maxPhotos: number,
	): string | null;
	uploadButton(
		ready: number,
		sending: { index: number; total: number; percentage?: number } | null,
	): string;
};
const p = portfolioModule as PortfolioModule;
const { MAX_PHOTO_STYLES } = photosModule as { MAX_PHOTO_STYLES: number };

const base = "/t/ink/portfolio";

test.group("Portfolio: the address", () => {
	test("only what differs from the defaults, in one order", ({ assert }) => {
		assert.equal(p.portfolioHref(base, p.NO_FILTERS), base);
		assert.equal(
			p.portfolioHref(
				base,
				{
					search: "koi fish",
					artist: "a1",
					style: "fine-line",
					status: "hidden",
					healed: true,
					sort: "oldest",
				},
				3,
			),
			`${base}?q=koi%20fish&artist=a1&style=fine-line&status=hidden&healed=1&sort=oldest&page=3`,
		);
		assert.equal(p.portfolioHref(base, p.NO_FILTERS, 1), base);
	});

	test("any search makes an address the server takes back", ({ assert }) => {
		for (const search of ["it's (new)!", "*~", "a&b=c?#", "किरण", "100%_"]) {
			const href = p.portfolioHref(base, { ...p.NO_FILTERS, search }, 2);
			assert.equal(portfolioBack(href, "ink"), href, search);
			assert.equal(new URL(href, "http://x").searchParams.get("q"), search);
		}
	});

	test("the order is not a filter", ({ assert }) => {
		assert.isFalse(p.isFiltered({ ...p.NO_FILTERS, sort: "oldest" }));
		assert.isTrue(p.isFiltered({ ...p.NO_FILTERS, healed: true }));
		// A tile is a tattoo, however many photos it has (angles).
		assert.equal(p.resultLine(5, 5, false), "5 tattoos");
		assert.equal(p.resultLine(1, 1, false), "1 tattoo");
		assert.equal(p.resultLine(1, 9, true), "1 tattoo matches, of 9");
		assert.equal(p.resultLine(0, 9, true), "0 tattoos match, of 9");
	});
});

test.group("Portfolio: tiles", () => {
	test("a tile is named by what it shows, by whom, and its status when it is off the page", ({
		assert,
	}) => {
		assert.equal(
			p.tileLabel({
				alt: "Koi",
				artistName: "Sita",
				published: true,
				shown: true,
				angles: [],
			}),
			"Koi, by Sita",
		);
		assert.equal(
			p.tileLabel({
				alt: null,
				artistName: "Sita",
				published: false,
				shown: false,
				angles: [{}, {}],
			}),
			"Photo by Sita, 3 photos, unpublished",
		);
		assert.equal(
			p.tileLabel({
				alt: null,
				artistName: "Sita",
				published: true,
				shown: false,
				angles: [],
			}),
			"Photo by Sita, artist hidden",
		);
		assert.equal(
			p.tileMeta(["blackwork", "unknown"], true, { blackwork: "Blackwork" }),
			"Blackwork · unknown · Healed",
		);
		assert.isNull(p.tileMeta([], false, {}));
	});

	test("the status and why a photo is off the page", ({ assert }) => {
		assert.equal(
			p.statusText({ published: true, shown: true }),
			"On your page",
		);
		assert.isNull(p.statusNote({ published: true, shown: true }));
		assert.equal(
			p.statusText({ published: false, shown: false }),
			"Unpublished",
		);
		assert.match(
			p.statusNote({ published: false, shown: false }) ?? "",
			/Publish it/,
		);
		assert.equal(
			p.statusText({ published: true, shown: false }),
			"Artist hidden",
		);
		assert.match(
			p.statusNote({ published: true, shown: false }) ?? "",
			/Show the artist/,
		);
	});
});

test.group("Portfolio: selecting", () => {
	test("what a bulk change left unchanged stays selected", ({ assert }) => {
		const photos = [
			{ id: "a", published: true, artistId: "s" },
			{ id: "b", published: false, artistId: "h" },
		];
		// "c" left the view: changed out of the filter, or deleted.
		assert.deepEqual(
			p.stillUnchanged("publish", ["a", "b", "c"], photos, null),
			["b"],
		);
		assert.deepEqual(p.stillUnchanged("unpublish", ["a", "b"], photos, null), [
			"a",
		]);
		assert.deepEqual(p.stillUnchanged("delete", ["a", "c"], photos, null), [
			"a",
		]);
		assert.deepEqual(p.stillUnchanged("reassign", ["a", "b"], photos, "h"), [
			"a",
		]);
		assert.match(p.deleteQuestion(1), /^Delete this photo\?/);
		assert.match(p.deleteQuestion(3), /^Delete these 3 photos\?/);
	});
});

test.group("Portfolio: the upload", () => {
	test("a wrong or oversized file is named before anything is sent", ({
		assert,
	}) => {
		assert.isNull(
			p.fileProblem({ name: "a.jpg", type: "image/jpeg", size: 1000 }),
		);
		assert.isNull(p.fileProblem({ name: "a.WEBP", type: "", size: 1000 }));
		assert.equal(
			p.fileProblem({ name: "a.gif", type: "image/gif", size: 1 }),
			p.WRONG_FORMAT,
		);
		assert.equal(
			p.fileProblem({ name: "a.heic", type: "", size: 1 }),
			p.WRONG_FORMAT,
		);
		assert.equal(
			p.fileProblem({
				name: "a.png",
				type: "image/png",
				size: p.MAX_PHOTO_BYTES + 1,
			}),
			p.TOO_LARGE,
		);
		assert.isNull(
			p.fileProblem({
				name: "a.png",
				type: "image/png",
				size: p.MAX_PHOTO_BYTES,
			}),
		);
		assert.equal(p.fileSizeText(2.4 * 1024 * 1024), "2.4 MB");
		assert.equal(p.fileSizeText(10), "1 KB");
	});

	test("planUpload sends the files fileProblem takes, in order, and names the rest with the server's words", ({
		assert,
	}) => {
		const jpg = { name: "a.jpg", type: "image/jpeg", size: 1000 };
		const txt = { name: "notes.txt", type: "text/plain", size: 10 };
		const huge = {
			name: "big.png",
			type: "image/png",
			size: p.MAX_PHOTO_BYTES + 1,
		};
		assert.deepEqual(p.planUpload([jpg, txt, jpg, huge]), {
			send: [0, 2],
			skip: [
				{ index: 1, reason: "Use a JPEG, PNG or WebP image." },
				{ index: 3, reason: "Use an image of 10 MB or less." },
			],
		});
		assert.deepEqual(p.planUpload([]), { send: [], skip: [] });
		assert.deepEqual(p.planUpload([txt]).send, []);
	});

	test("it needs an artist, a photo and room", ({ assert }) => {
		const sita = { id: "s", name: "Sita", visible: true, photoCount: 98 };
		assert.equal(p.uploadProblem(null, 2, 100), "Choose whose work this is.");
		assert.equal(p.uploadProblem(sita, 0, 100), "Add a photo to upload.");
		assert.isNull(p.uploadProblem(sita, 2, 100));
		assert.equal(
			p.uploadProblem(sita, 5, 100),
			"Sita has room for 2 more photos. Remove 3 from the list.",
		);
		assert.equal(
			p.uploadProblem({ ...sita, photoCount: 99 }, 2, 100),
			"Sita has room for 1 more photo. Remove 1 from the list.",
		);
		assert.equal(
			p.uploadProblem({ ...sita, photoCount: 100 }, 1, 100),
			"Sita already has 100 photos. Remove one to add another.",
		);
	});

	test("the button says what it sends and where it is", ({ assert }) => {
		assert.equal(p.uploadButton(0, null), "Upload photo");
		assert.equal(p.uploadButton(3, null), "Upload 3 photos");
		assert.equal(
			p.uploadButton(3, { index: 2, total: 3, percentage: 40 }),
			"Uploading 2 of 3… 40%",
		);
		assert.equal(p.uploadButton(1, { index: 1, total: 1 }), "Uploading…");
	});

	test("the style limit is the server's", ({ assert }) => {
		assert.equal(MAX_PHOTO_STYLES, SERVER_MAX_STYLES);
	});
});

test.group("Portfolio: a tattoo's photos (angles)", () => {
	test("a tile marks a tattoo of several photos, and Remove says the whole tattoo goes", ({
		assert,
	}) => {
		assert.isNull(p.photosMark({ angles: [] }));
		assert.equal(p.photosMark({ angles: [{}, {}, {}] }), "4 photos");
		assert.match(p.removeQuestion(1), /^Remove this photo\?/);
		assert.match(
			p.removeQuestion(3),
			/^Remove this tattoo and all 3 of its photos\?/,
		);
		assert.equal(p.removeLabel(1, false), "Remove photo");
		assert.equal(p.removeLabel(3, false), "Remove 3 photos");
		assert.equal(p.removeLabel(3, true), "Removing…");
		assert.match(
			p.deleteQuestion(1, 4),
			/^Delete this tattoo and all 4 of its photos\?/,
		);
		assert.match(
			p.deleteQuestion(2, 5),
			/^Delete these 2 tattoos, 5 photos in all\?/,
		);
		assert.match(p.deleteQuestion(2, 2), /^Delete these 2 photos\?/);
	});

	test("moving a photo earlier or later; the second moved earlier becomes the main photo; at the ends nothing moves", ({
		assert,
	}) => {
		const ids = ["a", "b", "c"];
		assert.deepEqual(p.movedOrder(ids, 1, "up"), ["b", "a", "c"]);
		assert.deepEqual(p.movedOrder(ids, 1, "down"), ["a", "c", "b"]);
		assert.deepEqual(p.movedOrder(ids, 0, "up"), ids);
		assert.deepEqual(p.movedOrder(ids, 2, "down"), ids);
		assert.deepEqual(p.mainFirst(ids, "c"), ["c", "a", "b"]);
		assert.deepEqual(p.mainFirst(ids, "x"), ids);
		assert.equal(p.movePhotoLabel("Koi, side", "up"), "Move Koi, side earlier");
		assert.equal(
			p.movePhotoLabel(p.tattooPhotoName(null, 3), "down"),
			"Move Photo 3 later",
		);
	});

	test("adding photos fits the tattoo's eight and the artist's room; grouping takes 2 to 8", ({
		assert,
	}) => {
		const sita = { name: "Sita", photoCount: 10 };
		assert.equal(p.MAX_TATTOO_PHOTOS, SERVER_MAX_TATTOO_PHOTOS);
		assert.equal(
			p.tattooUploadProblem(0, 2, sita, 100),
			"Add a photo to upload.",
		);
		assert.isNull(p.tattooUploadProblem(6, 2, sita, 100));
		assert.equal(
			p.tattooUploadProblem(7, 2, sita, 100),
			"This tattoo has room for 6 more photos. Remove 1 from the list.",
		);
		assert.equal(
			p.tattooUploadProblem(1, 8, sita, 100),
			"This tattoo already has 8 photos. Remove one to add another.",
		);
		assert.equal(
			p.tattooUploadProblem(3, 2, { ...sita, photoCount: 98 }, 100),
			"Sita has room for 2 more photos. Remove 1 from the list.",
		);
		assert.isFalse(p.canGroup(1));
		assert.isTrue(p.canGroup(2));
		assert.isTrue(p.canGroup(8));
		assert.isFalse(p.canGroup(9));
	});
});

test.group("Portfolio: what a remove asks for (angles)", () => {
	test("the DELETE's query names the scope and, for a tattoo, the photos shown", ({
		assert,
	}) => {
		assert.equal(p.removeQuery({ scope: "photo" }), "?scope=photo");
		assert.equal(
			p.removeQuery(
				{ scope: "tattoo", photos: 3 },
				"/t/ink/portfolio?q=koi fish",
			),
			"?back=%2Ft%2Fink%2Fportfolio%3Fq%3Dkoi%20fish&scope=tattoo&photos=3",
		);
		assert.deepEqual(
			p.deleteSizes([
				{ id: "a", angles: [] },
				{ id: "b", angles: [{}, {}] },
			]),
			{ a: 1, b: 3 },
		);
	});
});
