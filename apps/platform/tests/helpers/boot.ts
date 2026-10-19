import { execFile } from "node:child_process";
import { promisify } from "node:util";
import app from "@adonisjs/core/services/app";
import env from "#start/env";

const run = promisify(execFile);

/**
 * Boots a real process. It has to end by itself within `timeout`; one that
 * keeps running is killed and comes back as `killed`, which is a failure.
 * SIGKILL, not execFile's default SIGTERM: a warmup app (codegen) handles
 * SIGTERM with app.terminate(), which skips provider shutdown there, so a
 * hung one would ignore it, keep the promise pending until Japa's timeout and
 * outlive the test run.
 */
export async function boot(
	args: string[],
	overrides: Record<string, string>,
	timeout = 30_000,
) {
	try {
		const { stdout, stderr } = await run("node", args, {
			cwd: app.makePath(),
			timeout,
			killSignal: "SIGKILL",
			env: {
				...process.env,
				PORT: String(env.get("PORT") + 1),
				...overrides,
			},
		});
		return { exitCode: 0, killed: false, output: `${stdout}\n${stderr}` };
	} catch (error) {
		const { code, killed, stdout, stderr } = error as {
			code: number | string;
			killed: boolean;
			stdout: string;
			stderr: string;
		};
		return { exitCode: code, killed, output: `${stdout}\n${stderr}` };
	}
}
