import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LeaveGuard } from "../../src/intake/components/leave-guard.tsx";
import { copy } from "../../src/intake/copy.ts";

/**
 * Leaving while an inquiry is on its way asks first (spec ruling 7), for an
 * in-app link too: the router's blocker, alongside the form's beforeunload
 * listener. Checked in Chromium: an idle form leaves without asking; mid-send
 * a header link and Back ask, "Cancel" keeps the page and the send.
 */
const form = readFileSync(
	new URL("../../src/intake/components/intake-form.tsx", import.meta.url),
	"utf8",
);

describe("the in-app leave guard", () => {
	test("renders nothing, and needs no router (react-dom/server renders the form without one)", () => {
		for (const active of [true, false]) {
			assert.equal(
				renderToStaticMarkup(
					createElement(LeaveGuard, { active, message: "Leave?" }),
				),
				"",
			);
		}
	});

	test("guards exactly while the beforeunload listener does", () => {
		assert.match(
			form,
			/if \(phase === "idle" \|\| phase === "preparing"\) return;\n\t\tconst warn = \(event: BeforeUnloadEvent\)/,
		);
		assert.match(
			form,
			/<LeaveGuard\n\t+active=\{phase !== "idle" && phase !== "preparing"\}\n\t+message=\{copy\.status\.leaveWhileSending\}/,
		);
	});

	test("asks a plain question", () => {
		assert.equal(
			copy.status.leaveWhileSending,
			"Your inquiry is still sending. Leave this page anyway?",
		);
	});
});
