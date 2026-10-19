import {
	ExceptionHandler,
	errors,
	type HttpContext,
} from "@adonisjs/core/http";
import app from "@adonisjs/core/services/app";
import type {
	StatusPageRange,
	StatusPageRenderer,
} from "@adonisjs/core/types/http";
import { errors as limiterErrors } from "@adonisjs/limiter";
import { abortRequestTransaction } from "#services/db_context";
import { isApiRequest } from "#services/public_api";
import { apiErrorFor, renderApiError } from "#services/public_api_errors";
import { tryAgainMessage } from "#services/rate_limits";

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
			return backWithThrottleMessage(error, ctx);
		}
		return super.handle(error, ctx);
	}

	/**
	 * The method is used to report error to the logging service or
	 * the a third party error monitoring service.
	 *
	 * @note You should not attempt to send a response from this method.
	 */
	async report(error: unknown, ctx: HttpContext) {
		if (isPathTraversal(error)) return;
		// A client's mistake on the public API (an unknown slug, a bad body) is
		// not logged: slug probing would flood the log. Server errors are.
		if (isApiRequest(ctx) && apiErrorFor(error).status < 500) return;
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
	ctx.session.flashExcept([
		"_csrf",
		"_method",
		"password",
		"passwordConfirmation",
	]);
	ctx.session.flash("error", tryAgainMessage(error.response.availableIn));
	ctx.response.redirect().back();
}
