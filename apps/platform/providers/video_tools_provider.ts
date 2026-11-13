import type { ApplicationService } from "@adonisjs/core/types";

/**
 * Video angles: the worker (`queue:work`) transcodes videos with ffmpeg and
 * ffprobe, so it refuses to start without them, with an error that says
 * which is missing, rather than fail every video later. Only the worker:
 * the web server never runs them, and tests and other commands don't need
 * them to start. Like the role guard in db_context_provider.ts, the check
 * runs once the command has loaded, before it is created.
 */
export default class VideoToolsProvider {
	constructor(protected app: ApplicationService) {}

	async boot() {
		if (this.app.getEnvironment() !== "console") return;
		const ace = await this.app.container.make("ace");
		ace.loaded(async (command) => {
			if (command.commandName !== "queue:work") return;
			const { assertVideoTools } = await import(
				"#modules/media/services/video_tools"
			);
			try {
				await assertVideoTools();
			} catch (error) {
				await this.app.terminate();
				throw error;
			}
		});
	}
}
