import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import type { DateTime } from "luxon";
import {
	combineFacts,
	GATE_DAYS,
	lastDays,
	pilotTiles,
} from "#modules/reports/pilot_metrics";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PilotMetricsService from "#modules/reports/services/pilot_metrics_service";
import { forEachLiveStudio } from "#services/live_studios";

const MAX_DAYS = 3650;
const BAD_DAYS = `Give days a whole number from 1 to ${MAX_DAYS}.`;

/** "2026-10-20 09:30 UTC". */
const utc = (at: DateTime) => at.toUTC().toFormat("yyyy-MM-dd HH:mm 'UTC'");

/**
 * The days to count: a whole number from 1 to 3650 (metrics:pilot's rule),
 * 42 when absent. A bad value isn't redirected (a GET would loop): the page
 * renders with 42 and an error flash.
 */
function daysOf(raw: unknown): { days: number; error: string | null } {
	if (raw === undefined || raw === null || raw === "") {
		return { days: GATE_DAYS, error: null };
	}
	const days = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : 0;
	return days >= 1 && days <= MAX_DAYS
		? { days, error: null }
		: { days: GATE_DAYS, error: BAD_DAYS };
}

/**
 * TattooDrip's operator view of the pilot numbers (platformAdmin middleware):
 * what `metrics:pilot` prints, for every live studio and all together. Each
 * studio is read as the app role in its own context, so RLS keeps every
 * number its own.
 */
@inject()
export default class AdminMetricsController {
	constructor(private metrics: PilotMetricsService) {}

	async index(ctx: HttpContext) {
		const { days, error } = daysOf(ctx.request.input("days"));
		// Shown by this render: the flash bag is only what the last request left.
		if (error) ctx.session.flashMessages.set("error", error);
		const window = lastDays(days);
		const studios = await forEachLiveStudio((tenant) =>
			this.metrics.forStudio(tenant, window),
		);
		return ctx.inertia.render("admin/metrics", {
			days,
			fromText: utc(window.from),
			toText: utc(window.to),
			studios: studios.map(({ tenant, value }) => ({
				slug: tenant.slug,
				name: tenant.name,
				tiles: pilotTiles(value),
			})),
			total: {
				count: studios.length,
				tiles: pilotTiles(combineFacts(studios.map(({ value }) => value))),
			},
		});
	}
}
