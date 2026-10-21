import { mock } from "node:test";
import type { HttpContext } from "@adonisjs/core/http";
import { test } from "@japa/runner";
import InertiaMiddleware from "#middleware/inertia_middleware";
import {
	INVITATION_LINK_FLASH,
	type NewInvitationLink,
} from "#modules/tenancy/invitations";

/**
 * TAT-33: a new invitation's link rides in Inertia's flash, which the
 * middleware puts on the page object of whichever page the session's next
 * request renders. Another tab's request can be that request, so the link is
 * only emitted on the Members page and a response that carries it is never
 * stored.
 */

const link: NewInvitationLink = {
	email: "mira@flash-33.example",
	url: "https://platform.example/invitations/Zm9vYmFyYmF6cXV4",
	message: "You're invited to join Flash 33 on Tattoo Drip.",
	whatsappUrl: "https://wa.me/?text=hi",
	expiresText: "27 Oct 2026, 14:05",
};

function pageContext(routeName: string | undefined, pending: unknown = link) {
	const header = mock.fn();
	const ctx = {
		route: routeName === undefined ? undefined : { name: routeName },
		session: {
			flashMessages: {
				get: (key: string) =>
					key === INVITATION_LINK_FLASH
						? pending
						: key === "success"
							? "Done."
							: undefined,
			},
		},
		response: { header },
	} as unknown as HttpContext;
	return { ctx, header };
}

test.group(
	"InertiaMiddleware: the invitation link in the flash (TAT-33)",
	() => {
		test("the Members page emits the pending link and is never stored", ({
			assert,
		}) => {
			const { ctx, header } = pageContext("tenant.settings.members");

			const flash = new InertiaMiddleware().flash(ctx);

			assert.deepEqual(flash.invitationLink, link);
			assert.deepEqual(header.mock.calls[0]?.arguments, [
				"Cache-Control",
				"no-store",
			]);
		});

		test("any other page leaves the pending link out of its response", ({
			assert,
		}) => {
			for (const name of [
				"tenant.inbox.index",
				"tenant.settings.members.invitations.store",
				"home",
				undefined,
			]) {
				const { ctx } = pageContext(name);

				const flash = new InertiaMiddleware().flash(ctx);

				assert.isUndefined(flash.invitationLink, `${name}`);
				assert.notInclude(JSON.stringify(flash), link.url, `${name}`);
				// The other flashes are for every page.
				assert.equal(flash.success, "Done.");
			}
		});

		test("a response that carries no link needs no header from the flash", ({
			assert,
		}) => {
			const { ctx, header } = pageContext("tenant.settings.members", {
				url: "https://x.example",
			});

			const flash = new InertiaMiddleware().flash(ctx);

			assert.isUndefined(flash.invitationLink);
			assert.equal(header.mock.callCount(), 0);
		});
	},
);
