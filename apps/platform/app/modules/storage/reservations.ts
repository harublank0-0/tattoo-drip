import { randomUUID } from "node:crypto";
import app from "@adonisjs/core/services/app";
import logger from "@adonisjs/core/services/logger";
import type { TransactionClientContract } from "@adonisjs/lucid/types/database";
import { StorageFullError } from "#modules/media/errors";
import type { ImagePurpose } from "#modules/media/services/image_service";
import {
	ALWAYS_ACCEPTED,
	formatBytes,
	STORAGE_CATEGORY,
} from "#modules/storage/categories";
import StorageMeterService from "#modules/storage/services/storage_meter_service";
import { storageEnforcement } from "#modules/storage/settings";
import { withSeparateContext } from "#services/db_context";

/**
 * The words of a refusal (spec, What people see): how much space the upload
 * needs and how much is left, where to free some, and Studio when it would
 * give room.
 */
export function storageFullMessage(
	requested: number,
	remaining: number,
	studioBytes: number | null,
): string {
	const offer =
		studioBytes === null
			? ""
			: ` Studio includes ${formatBytes(studioBytes)}: ask TattooDrip to move your studio to Studio.`;
	return `This upload needs ${formatBytes(requested)}, but your studio has ${formatBytes(remaining)} of storage left. Free up space under Settings, Billing, Storage.${offer}`;
}

/**
 * Reserves `bytes` of the studio's storage for an upload about to be stored
 * (docs/superpowers/specs/2026-11-16-storage-meter-design.md, Reserving).
 * Returns the reservation's key (`key`, else `reserve:<uuid>`), or null for
 * an always-accepted or uncounted purpose, which reserves nothing. See
 * `reserveStorageFor`.
 */
export async function reserveStorage(input: {
	tenantId: string;
	purpose: ImagePurpose;
	bytes: number;
	minutes: number;
	key?: string;
}): Promise<string | null> {
	const [key] = await reserveStorageFor({
		tenantId: input.tenantId,
		purpose: input.purpose,
		minutes: input.minutes,
		items: [
			{ key: input.key ?? `reserve:${randomUUID()}`, bytes: input.bytes },
		],
	});
	return key ?? null;
}

/** What a reservation's transaction decided; a refusal is thrown once it has committed. */
type Decision =
	| { kind: "reserved"; keys: string[] }
	| { kind: "refused"; requested: number; remaining: number; message: string };

/**
 * Reserves storage for several files of one purpose at once (a Design Lab
 * submit's variations), all or none: in a short transaction of its own
 * (never the request's, which runs on through processing and the upload),
 * under the studio's advisory lock, so two uploads at once can't both take
 * the last space. With STORAGE_ENFORCEMENT on, files that don't fit throw
 * StorageFullError before anything is stored; in observe mode it is logged
 * and allowed, and a reservation that can't be made at all (a busy pool, a
 * failing read) is logged and skipped, so observing never blocks an upload.
 * Each reservation is replaced by its stored row (`recordStoredFile`),
 * released (`releaseStorage`), or expires after `minutes`; a key reserved
 * again (a retry whose first attempt rolled back) is renewed. Returns the
 * keys reserved: none for an always-accepted or uncounted purpose.
 */
export async function reserveStorageFor(input: {
	tenantId: string;
	purpose: ImagePurpose;
	minutes: number;
	items: readonly { key: string; bytes: number }[];
}): Promise<string[]> {
	const { tenantId, purpose, items } = input;
	if (
		items.length === 0 ||
		STORAGE_CATEGORY[purpose] === null ||
		ALWAYS_ACCEPTED.has(purpose)
	) {
		return [];
	}
	const enforced = storageEnforcement() === "enforce";
	let decision: Decision;
	try {
		decision = await withSeparateContext({ tenantId }, (trx) =>
			decide(trx, input, enforced),
		);
	} catch (error) {
		if (enforced) throw error;
		logger.warn(
			{ err: error, tenantId, purpose },
			"storage was not reserved (observe mode): the reservation failed",
		);
		return [];
	}
	if (decision.kind === "refused") {
		throw new StorageFullError(
			decision.requested,
			decision.remaining,
			decision.message,
		);
	}
	return decision.keys;
}

/** The reservation's transaction: under the studio's lock, check, then reserve. */
async function decide(
	trx: TransactionClientContract,
	{
		tenantId,
		purpose,
		minutes,
		items,
	}: Parameters<typeof reserveStorageFor>[0],
	enforced: boolean,
): Promise<Decision> {
	await trx.rawQuery("select pg_advisory_xact_lock(hashtextextended(?, 0))", [
		`storage:${tenantId}`,
	]);
	const tenant = { id: tenantId };
	// A studio this context can't see (removed meanwhile) has no allowance
	// to hold: nothing is reserved, and its upload fails on its own.
	const studio = await trx
		.from("tenants")
		.where("id", tenantId)
		.select("id")
		.first();
	if (!studio) {
		logger.warn(
			{ tenantId, purpose },
			"storage was not reserved: the studio isn't visible",
		);
		return { kind: "reserved", keys: [] };
	}
	const meter = await app.container.make(StorageMeterService);
	const bytes = items.reduce((sum, item) => sum + item.bytes, 0);
	const usage = await meter.usage(tenant);
	const limit = usage.limitBytes;
	if (limit !== null && usage.usedBytes + bytes > limit) {
		const remaining = Math.max(0, limit - usage.usedBytes);
		if (enforced) {
			const studioBytes = await meter.studioOfferBytes(tenant, limit);
			return {
				kind: "refused",
				requested: bytes,
				remaining,
				message: storageFullMessage(
					bytes,
					remaining,
					studioBytes !== null && usage.usedBytes + bytes <= studioBytes
						? studioBytes
						: null,
				),
			};
		}
		logger.info(
			{
				tenantId,
				rule: "storage_limit",
				purpose,
				requested: bytes,
				usedBytes: usage.usedBytes,
				limitBytes: limit,
			},
			"Package rule would refuse",
		);
	}
	for (const item of items) {
		await trx.rawQuery(
			`insert into stored_files (tenant_id, key, purpose, bytes, status, reserved_at, expires_at, created_at, updated_at)
			 values (?, ?, ?, ?, 'reserved', now(), now() + make_interval(mins => ?), now(), now())
			 on conflict (key) do update set purpose = excluded.purpose, bytes = excluded.bytes,
			   reserved_at = excluded.reserved_at, expires_at = excluded.expires_at, updated_at = now()
			 where stored_files.status = 'reserved'`,
			[tenantId, item.key, purpose, item.bytes, minutes],
		);
	}
	return { kind: "reserved", keys: items.map((item) => item.key) };
}

/**
 * Holds a reservation longer, from now (a work video's upload has arrived
 * and waits for the worker). Best effort, in a transaction of its own: a
 * failure is logged and the reservation keeps its first expiry.
 */
export async function extendReservation(
	tenantId: string,
	key: string,
	minutes: number,
): Promise<void> {
	try {
		await withSeparateContext({ tenantId }, (trx) =>
			trx.rawQuery(
				`update stored_files set expires_at = now() + make_interval(mins => ?), updated_at = now()
				 where tenant_id = ? and key = ? and status = 'reserved'`,
				[minutes, tenantId, key],
			),
		);
	} catch (error) {
		logger.error(
			{ err: error, tenantId, key },
			"a storage reservation could not be extended",
		);
	}
}

/**
 * Releases reservations at once (the upload failed, was rolled back or was
 * stored under another key), in a transaction of its own. Best effort: a
 * failure is logged and the reservation expires on its own.
 */
export async function releaseStorage(
	tenantId: string,
	keys: string | readonly string[],
): Promise<void> {
	const list = typeof keys === "string" ? [keys] : [...keys];
	if (list.length === 0) return;
	try {
		await withSeparateContext({ tenantId }, (trx) =>
			trx
				.from("stored_files")
				.where("tenant_id", tenantId)
				.whereIn("key", list)
				.where("status", "reserved")
				.delete(),
		);
	} catch (error) {
		logger.error(
			{ err: error, tenantId, keys: list },
			"a storage reservation could not be released; it expires on its own",
		);
	}
}
