import {
	ExceptionHandler,
	errors,
	type HttpContext,
} from "@adonisjs/core/http";
import app from "@adonisjs/core/services/app";
import type {
	HttpError,
	StatusPageRange,
	StatusPageRenderer,
} from "@adonisjs/core/types/http";
import { errors as limiterErrors } from "@adonisjs/limiter";
import { abortRequestTransaction } from "#services/db_context";
import { isApiRequest } from "#services/public_api";
import {
	apiErrorIsReported,
	renderApiError,
} from "#services/public_api_errors";
import {
	ACCOUNT_LINK_ROUTES,
	LINK_THROTTLED_MESSAGE,
	tryAgainMessage,
} from "#services/rate_limits";

/**
 * What a refused form never keeps in the session's flash: the CSRF token, the
 * method spoof, and every password field under every spelling the forms or
 * the session package use (TAT-95): camelCase, snake_case, the account page's
 * current password. A password must never sit in the session. `flashTypedInput`
 * also drops any other field whose name looks like a password, at any depth.
 */
const UNFLASHED_INPUTS = [
	"_csrf",
	"_method",
	"password",
	"password_confirmation",
	"passwordConfirmation",
	"current_password",
	"currentPassword",
	"new_password",
	"newPassword",
];

/** A field name that holds a password: password, passwd, passcode, newPasswordConfirmation... */
const PASSWORD_LIKE = /pass/i;

/** Whether a value is, or holds at any depth, a field named like a password. */
function holdsPassword(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(holdsPassword);
	if (value !== null && typeof value === "object") {
		return Object.entries(value).some(
			([name, inner]) => PASSWORD_LIKE.test(name) || holdsPassword(inner),
		);
	}
	return false;
}

/**
 * Flashes what the person typed so the form can show it again, minus every
 * password (UNFLASHED_INPUTS, any field named like a password, nested ones
 * too). The session package's `flashExcept` omits only the exact names it is
 * given at the top level, so the allowed names are worked out first.
 */
function flashTypedInput(ctx: HttpContext) {
	const keep = Object.entries(ctx.request.original())
		.filter(
			([name, value]) =>
				!UNFLASHED_INPUTS.includes(name) &&
				!PASSWORD_LIKE.test(name) &&
				!holdsPassword(value),
		)
		.map(([name]) => name);
	ctx.session.flashOnly(keep);
}

export default class HttpExceptionHandler extends ExceptionHandler {
	/**
	 * In debug mode, the exception handler will display verbose errors
	 * with pretty printed stack traces.
	 */
	protected debug = !app.inProduction;

	/**
	 * Status pages are used to display a custom HTML pages for certain error
	 * codes. You might want to enable them in production only, but feel
	 * free to enable them in development as well.
	 */
	protected renderStatusPages = app.inProduction;

	/**
	 * Status pages is a collection of error code range and a callback
	 * to return the HTML contents to send as a response.
	 */
	protected statusPages: Record<StatusPageRange, StatusPageRenderer> = {
		"404": (_, { inertia }) => inertia.render("errors/not_found", {}),
		"500..599": (_, { inertia }) => inertia.render("errors/server_error", {}),
	};

	/**
	 * The method is used for handling errors and returning
	 * response to the client
	 */
	async handle(error: unknown, ctx: HttpContext) {
		// Any exception rolls the request back before anything renders, so
		// earlier writes never commit after a failure, and the error page
		// runs with no ambient transaction.
		await abortRequestTransaction();
		// The public API answers every error with its JSON envelope, never a
		// page, a redirect or a stack (TAT-32).
		if (isApiRequest(ctx)) return renderApiError(error, ctx);
		if (isPathTraversal(error)) {
			return super.handle(
				new errors.E_ROUTE_NOT_FOUND([ctx.request.method(), ctx.request.url()]),
				ctx,
			);
		}
		if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS && wantsPage(ctx)) {
			return ACCOUNT_LINK_ROUTES.includes(ctx.route?.name ?? "")
				? toLandingWithThrottleMessage(ctx)
				: backWithThrottleMessage(error, ctx);
		}
		return super.handle(error, ctx);
	}

	/**
	 * A plain HTML form post that fails validation goes back to its form with
	 * the errors and what was typed, like the session package does (it replaces
	 * this method with its own), but the typed input is flashed through
	 * `flashTypedInput`: the package alone leaves out only `password` and
	 * `password_confirmation`, so `passwordConfirmation` and the account page's
	 * `currentPassword` would sit in the session, and a snake_case spelling must
	 * not come back when the list changes (TAT-95). An Inertia request flashes
	 * no input at all. The order is the package's: input first, then
	 * the errors, so a field named like an error key can't hide one.
	 */
	override async renderValidationErrorAsHTML(
		error: HttpError,
		ctx: HttpContext,
	) {
		if (!ctx.session) return super.renderValidationErrorAsHTML(error, ctx);
		if (!ctx.request.header("X-Inertia")) flashTypedInput(ctx);
		ctx.session.flashValidationErrors(error, false);
		ctx.response.redirect("back", true);
	}

	/**
	 * The method is used to report error to the logging service or
	 * the a third party error monitoring service.
	 *
	 * @note You should not attempt to send a response from this method.
	 */
	async report(error: unknown, ctx: HttpContext) {
		if (isPathTraversal(error)) return;
		// A client's mistake on the public API (an unknown slug, a bad body) and
		// a deliberate busy refusal are not logged: slug probing would flood the
		// log. Server errors are, a pool timeout included.
		if (isApiRequest(ctx) && !apiErrorIsReported(error)) return;
		return super.report(error, ctx);
	}
}

/**
 * A `..` in a file URL (/uploads, /files). Drive refuses the key; answer
 * like any unknown URL instead of with a logged 500.
 */
function isPathTraversal(error: unknown) {
	return (
		error instanceof Error &&
		"code" in error &&
		error.code === "E_PATH_TRAVERSAL_DETECTED"
	);
}

/**
 * A browser or Inertia request (HTML, or no Accept header) with a session,
 * as opposed to a JSON client.
 */
function wantsPage(ctx: HttpContext) {
	const type = ctx.request.accepts([
		"html",
		"application/vnd.api+json",
		"json",
	]);
	return (type === "html" || type === null) && Boolean(ctx.session);
}

/**
 * A form that hit a rate limit (TAT-8) goes back to its page with the error
 * toast, like a wrong password does, keeping what was typed except
 * passwords. JSON clients keep the limiter's own 429 with Retry-After.
 */
function backWithThrottleMessage(
	error: InstanceType<typeof limiterErrors.E_TOO_MANY_REQUESTS>,
	ctx: HttpContext,
) {
	flashTypedInput(ctx);
	ctx.session.flash("error", tryAgainMessage(error.response.availableIn));
	ctx.response.redirect().back();
}

/**
 * An emailed or shared account link (TAT-119) that hit the limit. It has no
 * form to go back to, and `back()` ends at `/`, whose own redirect would use
 * up the flash, so the person goes straight to the page they would land on
 * anyway: the sign-in page for a guest, /dashboard for someone signed in
 * (which keeps the flash through its redirects). The words are the same
 * whatever the token is, and nothing of the link is stored.
 */
function toLandingWithThrottleMessage(ctx: HttpContext) {
	ctx.session.flash("error", LINK_THROTTLED_MESSAGE);
	ctx.response.header("Cache-Control", "no-store");
	ctx.response
		.redirect()
		.toPath(ctx.auth.isAuthenticated ? "/dashboard" : "/login");
}
