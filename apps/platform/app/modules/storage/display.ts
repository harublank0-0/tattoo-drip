import { formatBytes } from "#modules/storage/categories";
import type { StorageUsage } from "#modules/storage/services/storage_meter_service";
import { storageEnforcement } from "#modules/storage/settings";

/** A studio's storage as its pages say it: "1.2 GB" of "5 GB", 24%. */
export type StorageLine = {
	usedText: string;
	/** Null when the studio's bundle isn't metered. */
	limitText: string | null;
	/** Whole percent of the allowance used; null when not metered. */
	percent: number | null;
	/** Nothing is left (the rounded percent can say 100 before that). */
	full: boolean;
	/** STORAGE_ENFORCEMENT is on: a full studio's uploads are refused. */
	enforced: boolean;
};

export function storageLine(usage: StorageUsage): StorageLine {
	const { usedBytes, limitBytes } = usage;
	return {
		usedText: formatBytes(usedBytes),
		limitText: limitBytes === null ? null : formatBytes(limitBytes),
		percent:
			limitBytes === null || limitBytes === 0
				? null
				: Math.round((usedBytes / limitBytes) * 100),
		full: limitBytes !== null && usedBytes >= limitBytes,
		enforced: storageEnforcement() === "enforce",
	};
}

const perRequest = new WeakMap<object, Promise<StorageUsage>>();

/**
 * The studio's usage, read once per request (`request` is the request's
 * HttpContext): the shared `storage` prop and a page that shows more of it
 * (Billing) share one read.
 */
export function usageForRequest(
	request: object,
	read: () => Promise<StorageUsage>,
): Promise<StorageUsage> {
	let usage = perRequest.get(request);
	if (!usage) {
		usage = read();
		perRequest.set(request, usage);
	}
	return usage;
}
