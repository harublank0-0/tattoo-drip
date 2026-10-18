import { mock } from "node:test";
import logger from "@adonisjs/core/services/logger";

export const LEVELS = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"silent",
] as const;

/**
 * Silences every log level, `log()` itself and the child and named loggers
 * (they answer with the silenced logger), and keeps what each was given.
 */
export function captureLogs() {
	const fields = logger as unknown as Record<
		string,
		(...args: unknown[]) => unknown
	>;
	const levels = LEVELS.map((level) => ({
		level,
		spy: mock.method(fields, level, () => {}),
	}));
	const log = mock.method(fields, "log", () => {});
	const child = mock.method(fields, "child", () => logger);
	const use = mock.method(fields, "use", () => logger);
	const at = (...wanted: (typeof LEVELS)[number][]) =>
		levels
			.filter(({ level }) => wanted.includes(level))
			.flatMap(({ spy }) => spy.mock.calls.map((call) => call.arguments));
	return {
		warnings: () => at("warn"),
		errors: () => at("error"),
		/** Everything logged at any level, however it was called. */
		everything: () => [
			...at(...LEVELS),
			...log.mock.calls.map((call) => call.arguments),
		],
		/** Anything but warn and error: the verifier only ever logs those two. */
		quiet: () => [
			...at("trace", "debug", "info", "fatal", "silent"),
			...log.mock.calls.map((call) => call.arguments),
		],
		restore: () => {
			for (const { spy } of levels) spy.mock.restore();
			log.mock.restore();
			child.mock.restore();
			use.mock.restore();
		},
	};
}
