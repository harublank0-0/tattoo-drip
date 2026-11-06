import { test } from "@japa/runner";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `ClientsModule` below restates its shape and the inertia project type-checks the real one.
import * as clientsModule from "../../../inertia/components/clients.js";

type ClientsModule = {
	initialsOf(name: string): string;
	clientsHref(
		base: string,
		query: { search: string; filter: string; page: number },
	): string;
};
const { initialsOf, clientsHref } = clientsModule as ClientsModule;

test.group("Clients directory", () => {
	test("initials are the first letters of the first two words, whole letters", ({
		assert,
	}) => {
		assert.equal(initialsOf("Priya Thapa"), "PT");
		assert.equal(initialsOf("  maya  "), "M");
		assert.equal(initialsOf("Sita Devi Karki"), "SD");
		assert.equal(initialsOf("किरण थापा"), "कि था".replace(" ", ""));
	});

	test("the address keeps the search, the filter and the page, each only when set", ({
		assert,
	}) => {
		const base = "/t/bn/clients";
		assert.equal(
			clientsHref(base, { search: "", filter: "all", page: 1 }),
			base,
		);
		assert.equal(
			clientsHref(base, { search: "ram", filter: "upcoming", page: 3 }),
			"/t/bn/clients?q=ram&filter=upcoming&page=3",
		);
		assert.equal(
			clientsHref(base, { search: "a&b", filter: "all", page: 1 }),
			"/t/bn/clients?q=a%26b",
		);
	});
});
