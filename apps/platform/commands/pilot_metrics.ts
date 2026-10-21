import { BaseCommand, flags } from "@adonisjs/core/ace";
import type { CommandOptions } from "@adonisjs/core/types/ace";
import type { DateTime } from "luxon";
import {
	combineFacts,
	GATE_DAYS,
	lastDays,
	type PilotFacts,
	pilotLines,
} from "#modules/reports/pilot_metrics";
import { terminalText } from "#services/terminal_text";

/** A live studio as the command lists it: no more than it prints. */
export type Studio = { id: string; slug: string; name: string };

/**
 * The team's view of the pilot (TAT-70): every live studio's three numbers
 * (link share, inquiry to verified deposit, no-shows), then all studios
 * together, for the last --days days (42 by default: gate 1's six weeks).
 * Only the list of studios crosses tenants, read as the owner role; each
 * studio's numbers come from PilotMetricsService as the app role inside that
 * studio's row-level security context, exactly as its owners' card does.
 * Prints names, slugs and aggregates only; a name's or slug's control
 * characters are shown as escapes (`terminalText`), because a studio owner
 * chooses the name and it must not be able to rewrite the operator's
 * terminal. The app's default connection must be the restricted app role,
 * like the web server's and the worker's: the command refuses to start as a
 * role that bypasses RLS, since RLS is what proves each studio's numbers are
 * its own (the owner connection only lists the studios). Run it where the
 * owner role's password is (the migration step's environment, which also has
 * DB_USER set to the app role), never from the web or the worker:
 *
 *   node ace metrics:pilot --days=42           (development)
 *   node build/ace.js metrics:pilot --days=42  (production)
 */
export default class PilotMetrics extends BaseCommand {
	static commandName = "metrics:pilot";
	static description =
		"Print every studio's pilot numbers: link share, inquiry to deposit, no-shows";
	static options: CommandOptions = { startApp: true };

	@flags.number({
		description: "How many days to count, ending now (gate 1 uses 42)",
		default: GATE_DAYS,
	})
	declare days: number;

	async run() {
		if (!Number.isInteger(this.days) || this.days < 1 || this.days > 3650) {
			this.logger.error("Give --days a whole number from 1 to 3650.");
			this.exitCode = 1;
			return;
		}
		// Imported once the app has started: models need a booted app.
		const { withDbContext } = await import("#services/db_context");
		const { default: PilotMetricsService } = await import(
			"#modules/reports/services/pilot_metrics_service"
		);
		const metrics = await this.app.container.make(PilotMetricsService);
		const window = lastDays(this.days);

		this.logger.log(
			`Pilot numbers for the last ${this.days} days: ${utc(window.from)} to ${utc(window.to)} UTC.`,
		);
		const studios = await this.studios();
		if (studios.length === 0) {
			this.logger.log("No studios yet.");
			return;
		}
		const all: PilotFacts[] = [];
		for (const studio of studios) {
			// The app role, in this studio's context: RLS keeps every number its own.
			const facts = await withDbContext({ tenantId: studio.id }, () =>
				metrics.forStudio(studio, window),
			);
			all.push(facts);
			// A studio owner typed the name: show it, never let it drive the terminal.
			const heading = `${terminalText(studio.name)} (${terminalText(studio.slug)})`;
			for (const line of pilotLines(heading, facts)) {
				this.logger.log(line);
			}
		}
		for (const line of pilotLines(
			`All studios (${studios.length})`,
			combineFacts(all),
		)) {
			this.logger.log(line);
		}
	}

	/**
	 * The live studios, oldest first: the one read across tenants, as the
	 * owner role (row-level security doesn't apply to it), and only ids,
	 * slugs and names. Protected so a test can list its own studios: the
	 * owner connection can't see rows a test's transaction holds.
	 */
	protected async studios(): Promise<Studio[]> {
		const { default: db } = await import("@adonisjs/lucid/services/db");
		return db
			.connection("owner")
			.from("tenants")
			.whereNull("deleted_at")
			.orderBy("created_at", "asc")
			.orderBy("id", "asc")
			.select("id", "slug", "name");
	}
}

/** "2026-10-20 09:30", in UTC. */
function utc(at: DateTime): string {
	return at.toUTC().toFormat("yyyy-MM-dd HH:mm");
}
