/*
|--------------------------------------------------------------------------
| Scheduler
|--------------------------------------------------------------------------
|
| Recurring jobs. adonisrc.ts loads this file in the web server only: at
| boot it upserts each schedule into queue_schedules by its id (a restart
| or a second server changes nothing), and the worker claims the due ones
| and runs them. Awaited, so a web server that can't write its schedules
| doesn't start.
|
| Only when the app runs: `node ace codegen` boots the web environment in
| "warmup" mode, where nothing shuts the database down, so a connection
| opened here would keep that command from ever exiting.
|
*/

import app from "@adonisjs/core/services/app";
import SweepStuckVideosJob from "#modules/artists/jobs/sweep_stuck_videos_job";
import SweepExpiredQuotesJob from "#modules/projects/jobs/sweep_expired_quotes_job";
import SweepStaleSubmittersJob from "#modules/reviews/jobs/sweep_stale_submitters_job";

if (app.getMode() === "run") {
	await SweepExpiredQuotesJob.schedule({})
		.id(SweepExpiredQuotesJob.scheduleId)
		.cron(SweepExpiredQuotesJob.cron)
		.run();
	// Video angles: fails videos still processing an hour after they were added.
	await SweepStuckVideosJob.schedule({})
		.id(SweepStuckVideosJob.scheduleId)
		.cron(SweepStuckVideosJob.cron)
		.run();
	// Reviews and Fresh ink: clears dispute records older than 90 days.
	await SweepStaleSubmittersJob.schedule({})
		.id(SweepStaleSubmittersJob.scheduleId)
		.cron(SweepStaleSubmittersJob.cron)
		.run();
}
