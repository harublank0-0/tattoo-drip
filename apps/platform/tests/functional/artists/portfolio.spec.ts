import testUtils from "@adonisjs/core/services/test_utils";
import type { ApiClient } from "@japa/api-client";
import { test } from "@japa/runner";
import { DateTime } from "luxon";
import type User from "#models/user";
import Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import { parsePortfolioQuery, portfolioBack } from "#modules/artists/portfolio";
import { addArtist, addWorkPhoto } from "#tests/helpers/artists";
import { testImages } from "#tests/helpers/images";
import { artistIn, inTenant, studioWithOwner } from "#tests/helpers/tenants";

type Photo = {
	id: string;
	artistId: string;
	artistName: string;
	shown: boolean;
	alt: string | null;
	styles: string[];
	healed: boolean;
	src: string;
	srcSet: string;
	largeUrl: string;
	fullUrl: string;
};

async function propsOf(client: ApiClient, url: string, user: User) {
	const response = await client.get(url).withInertia().loginAs(user);
	response.assertStatus(200);
	response.assertInertiaComponent("portfolio/index");
	return response.inertiaProps as {
		photos: Photo[];
		artists: {
			id: string;
			name: string;
			visible: boolean;
			photoCount: number;
		}[];
		filters: Record<string, unknown>;
		page: { current: number; last: number; total: number; size: number };
		isOwner: boolean;
	};
}

const at = (minutes: number) => DateTime.now().minus({ minutes });

/**
 * A studio with two artists of its own and their photos: Sita (shown) with
 * three, one healed blackwork koi, and Hari (hidden) with one; Hari is
 * linked to an artist member.
 */
async function gallery(slug: string) {
	const { tenant, owner } = await studioWithOwner(slug, `Studio ${slug}`);
	const sita = await addArtist(tenant, owner, {
		name: "Sita Rai",
		slug: "sita",
	});
	const hari = await addArtist(tenant, owner, {
		name: "Hari Thapa",
		slug: "hari",
		visible: false,
	});
	const member = await artistIn(tenant, `artist@${slug}.example`);
	const photos = await inTenant(tenant, async () => {
		await Artist.query().where("id", hari.id).update({ user_id: member.id });
		return {
			koi: await addWorkPhoto(tenant, sita, {
				alt: "Koi on the forearm",
				styles: ["blackwork", "japanese"],
				healed: true,
				createdAt: at(30),
			}),
			rose: await addWorkPhoto(tenant, sita, {
				alt: "100%_rose",
				styles: ["fine-line"],
				createdAt: at(20),
			}),
			plain: await addWorkPhoto(tenant, sita, { createdAt: at(10) }),
			hidden: await addWorkPhoto(tenant, hari, {
				alt: "Mandala back piece",
				styles: ["mandala"],
				createdAt: at(5),
			}),
		};
	});
	return { tenant, owner, sita, hari, member, ...photos };
}

const ids = (photos: Photo[]) => photos.map(({ id }) => id);

test.group("Portfolio (Studio OS)", (group) => {
	group.each.setup(() => testUtils.db().wrapInGlobalTransaction());

	test("an owner sees every live artist's work, hidden too, newest first, with its copies", async ({
		client,
		assert,
	}) => {
		const s = await gallery("pf-owner");
		const props = await propsOf(client, "/t/pf-owner/portfolio", s.owner);

		assert.deepEqual(ids(props.photos), [
			s.hidden.id,
			s.plain.id,
			s.rose.id,
			s.koi.id,
		]);
		assert.isTrue(props.isOwner);
		const hidden = props.photos[0];
		assert.equal(hidden.artistName, "Hari Thapa");
		assert.isFalse(hidden.shown);
		assert.isTrue(props.photos[3].shown);
		assert.deepEqual(props.photos[3].styles, ["blackwork", "japanese"]);
		// The tile's 640 copy, the panel's 1280 one, every copy in srcset, and the image.
		assert.match(hidden.src, /\.640w\.jpg$/);
		assert.match(hidden.largeUrl, /\.1280w\.jpg$/);
		assert.match(
			hidden.srcSet,
			/320w\.jpg 320w, .*640w\.jpg 640w, .*1280w\.jpg 1280w, .* 2048w$/,
		);
		assert.notMatch(hidden.fullUrl, /\d+w\.jpg$/);
		assert.equal(props.page.total, 4);
		const counts = Object.fromEntries(
			props.artists.map((row) => [row.name, row.photoCount]),
		);
		assert.equal(counts["Sita Rai"], 3);
		assert.equal(counts["Hari Thapa"], 1);
	});

	test("the filters and the order narrow the gallery, and the address holds them", async ({
		client,
		assert,
	}) => {
		const s = await gallery("pf-filters");
		const of = async (query: string) =>
			ids(
				(await propsOf(client, `/t/pf-filters/portfolio?${query}`, s.owner))
					.photos,
			);

		assert.deepEqual(await of(`artist=${s.sita.id}`), [
			s.plain.id,
			s.rose.id,
			s.koi.id,
		]);
		assert.deepEqual(await of("style=blackwork"), [s.koi.id]);
		assert.deepEqual(await of("healed=1"), [s.koi.id]);
		assert.deepEqual(await of("status=artist_hidden"), [s.hidden.id]);
		assert.deepEqual(await of("status=published&sort=oldest"), [
			s.koi.id,
			s.rose.id,
			s.plain.id,
		]);
		// The search reads the description and the artist's name, wildcards as text.
		assert.deepEqual(await of("q=koi"), [s.koi.id]);
		assert.deepEqual(await of("q=hari"), [s.hidden.id]);
		assert.deepEqual(await of("q=100%25_"), [s.rose.id]);
		assert.deepEqual(await of("q=%25"), [s.rose.id]);

		const props = await propsOf(
			client,
			"/t/pf-filters/portfolio?style=nope&status=gone&sort=up&page=-3",
			s.owner,
		);
		assert.deepEqual(props.filters, {
			search: "",
			artist: null,
			style: null,
			status: "all",
			healed: false,
			sort: "newest",
		});
		assert.lengthOf(props.photos, 4);
	});

	test("pages of 40, and a page past the last is the last", async ({
		client,
		assert,
	}) => {
		const { tenant, owner } = await studioWithOwner("pf-pages", "Pages");
		const sita = await addArtist(tenant, owner);
		await inTenant(tenant, async () => {
			for (let n = 0; n < 41; n += 1) {
				await addWorkPhoto(tenant, sita, { createdAt: at(100 - n) });
			}
		});
		const first = await propsOf(client, "/t/pf-pages/portfolio", owner);
		assert.lengthOf(first.photos, 40);
		assert.deepEqual(first.page, { current: 1, last: 2, total: 41, size: 40 });
		const past = await propsOf(client, "/t/pf-pages/portfolio?page=9", owner);
		assert.lengthOf(past.photos, 1);
		assert.equal(past.page.current, 2);
	});

	test("an artist sees only their own profile's work, whatever the address asks", async ({
		client,
		assert,
	}) => {
		const s = await gallery("pf-artist");
		const props = await propsOf(
			client,
			`/t/pf-artist/portfolio?artist=${s.sita.id}`,
			s.member,
		);
		assert.isFalse(props.isOwner);
		assert.deepEqual(ids(props.photos), [s.hidden.id]);
		assert.deepEqual(
			props.artists.map(({ name }) => name),
			["Hari Thapa"],
		);
		// The other artist's id is ignored, not kept as a filter.
		assert.isNull(props.filters.artist);
		assert.notInclude(JSON.stringify(props), "Koi on the forearm");

		// A member with no linked profile has nothing.
		const loose = await artistIn(s.tenant, "loose@pf-artist.example");
		const none = await propsOf(client, "/t/pf-artist/portfolio", loose);
		assert.deepEqual(none.photos, []);
		assert.deepEqual(none.artists, []);
	});

	test("a deleted artist's work and another studio's never show", async ({
		client,
		assert,
	}) => {
		const a = await gallery("pf-iso-a");
		const b = await gallery("pf-iso-b");
		await inTenant(a.tenant, async () => {
			const hari = await Artist.findOrFail(a.hari.id);
			await hari.softDelete();
		});
		const props = await propsOf(
			client,
			`/t/pf-iso-a/portfolio?artist=${b.sita.id}`,
			a.owner,
		);
		assert.deepEqual(ids(props.photos), [a.plain.id, a.rose.id, a.koi.id]);
		assert.notInclude(JSON.stringify(props), b.koi.id);

		// B's owner can't open A's portfolio.
		const response = await client
			.get("/t/pf-iso-a/portfolio")
			.withInertia()
			.loginAs(b.owner);
		response.assertStatus(404);
	});

	test("an upload from the portfolio saves its details and comes back to the portfolio", async ({
		client,
		assert,
	}) => {
		const s = await gallery("pf-upload");
		const back = `/t/pf-upload/portfolio?artist=${s.sita.id}`;
		const response = await client
			.post(`/t/pf-upload/artists/${s.sita.id}/photos`)
			.file("photo", await testImages.jpeg(800, 1000), { filename: "work.jpg" })
			.field("alt", "  Swallow on the hand  ")
			.field("styles[]", ["traditional", "colour"])
			.field("healed", "1")
			.field("back", back)
			.withCsrfToken()
			.loginAs(s.owner)
			.redirects(0);
		response.assertStatus(302);
		response.assertHeader("location", back);

		const newest = await inTenant(s.tenant, () =>
			ArtistWorkPhoto.query()
				.where("artist_id", s.sita.id)
				.orderBy("created_at", "desc")
				.firstOrFail(),
		);
		assert.equal(newest.alt, "Swallow on the hand");
		assert.deepEqual(newest.styles, ["traditional", "colour"]);
		assert.isTrue(newest.healed);
		assert.equal(newest.width, 800);
	});

	test("an upload's details are checked, and an artist can't upload to another's profile", async ({
		client,
		assert,
	}) => {
		const s = await gallery("pf-checks");
		const tooMany = await client
			.post(`/t/pf-checks/artists/${s.sita.id}/photos`)
			.file("photo", await testImages.jpeg(400, 400), { filename: "a.jpg" })
			.field("styles[]", ["blackwork", "japanese", "colour", "minimal"])
			.withCsrfToken()
			.loginAs(s.owner)
			.redirects(0);
		tooMany.assertStatus(302);
		const count = await inTenant(s.tenant, () =>
			ArtistWorkPhoto.query().where("artist_id", s.sita.id),
		);
		assert.lengthOf(count, 3);

		const foreign = await client
			.post(`/t/pf-checks/artists/${s.sita.id}/photos`)
			.file("photo", await testImages.jpeg(400, 400), { filename: "a.jpg" })
			.field("back", "/t/pf-checks/portfolio")
			.withCsrfToken()
			.loginAs(s.member)
			.redirects(0);
		foreign.assertStatus(404);
	});

	test("an edit and a removal from the portfolio come back to it; any other `back` goes to the profile", async ({
		client,
		assert,
	}) => {
		const s = await gallery("pf-back");
		const back = "/t/pf-back/portfolio?style=blackwork&page=2";
		const saved = await client
			.put(`/t/pf-back/artists/photos/${s.koi.id}`)
			.form({ alt: "Koi, healed", "styles[]": ["japanese"], healed: "1", back })
			.withCsrfToken()
			.loginAs(s.owner)
			.redirects(0);
		saved.assertStatus(302);
		saved.assertHeader("location", back);

		for (const elsewhere of [
			"https://evil.example/t/pf-back/portfolio",
			"/t/other/portfolio",
			"/t/pf-back/portfolio?q=<script>",
			"//evil.example",
		]) {
			const response = await client
				.put(`/t/pf-back/artists/photos/${s.koi.id}`)
				.form({ alt: "Koi", back: elsewhere })
				.withCsrfToken()
				.loginAs(s.owner)
				.redirects(0);
			response.assertStatus(302);
			response.assertHeader("location", `/t/pf-back/artists/${s.sita.id}/edit`);
		}

		const removed = await client
			.delete(
				`/t/pf-back/artists/photos/${s.rose.id}?back=${encodeURIComponent(back)}&scope=tattoo&photos=1`,
			)
			.withCsrfToken()
			.loginAs(s.owner)
			.redirects(0);
		removed.assertStatus(302);
		removed.assertHeader("location", back);
		assert.isNull(
			await inTenant(s.tenant, () => ArtistWorkPhoto.find(s.rose.id)),
		);
	});
});

test.group("Portfolio query rules (Studio OS)", () => {
	test("parsePortfolioQuery keeps only what it knows", ({ assert }) => {
		assert.deepEqual(
			parsePortfolioQuery({
				q: "  koi  ",
				artist: "0F8FAD5B-D9CB-469F-A165-70867728950E",
				style: "blackwork",
				status: "unpublished",
				healed: "1",
				sort: "oldest",
				page: "3",
			}),
			{
				search: "koi",
				artist: "0f8fad5b-d9cb-469f-a165-70867728950e",
				style: "blackwork",
				status: "unpublished",
				healed: true,
				sort: "oldest",
				page: 3,
			},
		);
		assert.deepEqual(
			parsePortfolioQuery({
				artist: "1 or 1=1",
				page: "1.5",
				healed: "yes",
				q: ["a"],
			}),
			{
				search: "",
				artist: null,
				style: null,
				status: "all",
				healed: false,
				sort: "newest",
				page: 1,
			},
		);
		assert.lengthOf(parsePortfolioQuery({ q: "x".repeat(500) }).search, 100);
	});

	test("portfolioBack takes only this studio's portfolio with a plain query", ({
		assert,
	}) => {
		assert.equal(portfolioBack("/t/ink/portfolio", "ink"), "/t/ink/portfolio");
		assert.equal(
			portfolioBack("/t/ink/portfolio?q=koi%20fish&page=2", "ink"),
			"/t/ink/portfolio?q=koi%20fish&page=2",
		);
		for (const value of [
			"/t/ink/portfolios",
			"/t/inky/portfolio",
			"/t/ink/calendar",
			"https://x.example/t/ink/portfolio",
			"/t/ink/portfolio?q=<b>",
			"/t/ink/portfolio#top",
			42,
			null,
		]) {
			assert.isNull(portfolioBack(value, "ink"), String(value));
		}
	});
});
