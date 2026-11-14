import { test } from "@japa/runner";
import {
	checkBflApiUrl,
	checkBflModel,
	checkDesignLabProvider,
	checkDesignLabSettings,
	checkMaxVariations,
	checkMonthlyLimit,
	designLabProvider,
} from "#services/design_lab_settings";

test.group("Design Lab settings", () => {
	test("the provider defaults to off in production and preview elsewhere", ({
		assert,
	}) => {
		assert.equal(designLabProvider(undefined, true), "off");
		assert.equal(designLabProvider(undefined, false), "preview");
		assert.equal(designLabProvider("bfl", true), "bfl");
		assert.throws(
			() => checkDesignLabProvider("X", "flux"),
			"off, preview or bfl",
		);
	});

	test("bfl needs a key and an explicit model; production refuses preview", ({
		assert,
	}) => {
		const base = { production: false, apiUrl: undefined };
		assert.throws(
			() =>
				checkDesignLabSettings({
					...base,
					provider: "bfl",
					apiKey: false,
					model: true,
				}),
			"BFL_API_KEY",
		);
		assert.throws(
			() =>
				checkDesignLabSettings({
					...base,
					provider: "bfl",
					apiKey: true,
					model: false,
				}),
			"BFL_MODEL",
		);
		assert.throws(
			() =>
				checkDesignLabSettings({
					provider: "preview",
					production: true,
					apiKey: false,
					model: false,
					apiUrl: undefined,
				}),
			"placeholder",
		);
		assert.doesNotThrow(() =>
			checkDesignLabSettings({
				...base,
				provider: "bfl",
				apiKey: true,
				model: true,
			}),
		);
	});

	test("values are shape-checked", ({ assert }) => {
		assert.equal(checkBflModel("M", " flux-2-pro "), "flux-2-pro");
		assert.throws(() => checkBflModel("M", "../v2/x"), "model endpoint name");
		assert.equal(
			checkBflApiUrl("U", "https://api.eu.bfl.ai/"),
			"https://api.eu.bfl.ai",
		);
		assert.throws(
			() => checkBflApiUrl("U", "https://a:b@api.bfl.ai"),
			"no query or credentials",
		);
		assert.equal(checkMonthlyLimit("L", undefined), 40);
		assert.equal(checkMonthlyLimit("L", "0"), 0);
		assert.throws(() => checkMonthlyLimit("L", "-1"), "whole number");
		assert.equal(checkMaxVariations("V", undefined), 2);
		assert.throws(() => checkMaxVariations("V", "5"), "from 1 to 4");
	});
});
