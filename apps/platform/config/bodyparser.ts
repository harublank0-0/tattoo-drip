import { randomUUID } from "node:crypto";
import { defineConfig } from "@adonisjs/core/bodyparser";
import app from "@adonisjs/core/services/app";

const bodyParserConfig = defineConfig({
	/**
	 * Parse request bodies for these HTTP methods.
	 * Keep this aligned with methods that receive payloads in your routes.
	 */
	allowedMethods: ["POST", "PUT", "PATCH", "DELETE"],

	/**
	 * Config for the "application/x-www-form-urlencoded"
	 * content-type parser.
	 */
	form: {
		/**
		 * Normalize empty string values to null.
		 */
		convertEmptyStringsToNull: true,

		/**
		 * Content types handled by the form parser.
		 */
		types: ["application/x-www-form-urlencoded"],
	},

	/**
	 * Config for the JSON parser.
	 */
	json: {
		/**
		 * Normalize empty string values to null.
		 */
		convertEmptyStringsToNull: true,

		/**
		 * Content types handled by the JSON parser.
		 */
		types: [
			"application/json",
			"application/json-patch+json",
			"application/vnd.api+json",
			"application/csp-report",
		],
	},

	/**
	 * Config for the "multipart/form-data" content-type parser.
	 * File uploads are handled by the multipart parser.
	 */
	multipart: {
		/**
		 * The parser reads no multipart body itself (TAT-38). Its handler
		 * table is a plain object, so a file part named like an
		 * Object.prototype property (`constructor`, `__proto__`) would throw
		 * inside an async listener and end the process. Every multipart body
		 * is read with receiveUploads (#services/uploads), which covers those
		 * names: by WebMultipartMiddleware for a signed-in dashboard request,
		 * and by a public API upload route's handler after publicTenant and
		 * the limits (TAT-32 ruling 16).
		 */
		autoProcess: false,

		/**
		 * Normalize empty string values to null.
		 */
		convertEmptyStringsToNull: true,

		/**
		 * Maximum accepted payload size for multipart requests.
		 */
		limit: "20mb",

		/**
		 * Tests keep uploads in tmp/storage/uploads (made and cleared by
		 * tests/bootstrap.ts), so a test can check that a request left no temp
		 * file behind (TAT-51). Elsewhere they go to the OS temp folder.
		 */
		...(app.inTest
			? { tmpFileName: () => app.tmpPath("storage", "uploads", randomUUID()) }
			: {}),

		/**
		 * Content types handled by the multipart parser.
		 */
		types: ["multipart/form-data"],
	},
});

export default bodyParserConfig;
