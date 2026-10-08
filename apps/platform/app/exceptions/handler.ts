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
		if (isPathTraversal(error)) {
			return super.handle(
				new errors.E_ROUTE_NOT_FOUND([ctx.request.method(), ctx.request.url()]),
				ctx,
			);
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
