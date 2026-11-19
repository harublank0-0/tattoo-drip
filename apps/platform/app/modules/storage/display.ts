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
		enforced: storageEnforcement() === "enforce",
	};
}
