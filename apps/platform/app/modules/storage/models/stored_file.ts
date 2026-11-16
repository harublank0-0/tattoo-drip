import { column } from "@adonisjs/lucid/orm";
import { StoredFileSchema } from "#database/schema";

/**
 * One counted file's size (the storage meter): `reserved` while an upload
 * runs, until `expiresAt`; `stored` once it landed. Usage counts a stored row
 * only while a live record holds its key (`liveKeysSql`).
 */
export default class StoredFile extends StoredFileSchema {
	declare status: "reserved" | "stored";

	// bigint comes back from Postgres as a string; sizes fit in a number.
	@column({ consume: (value: string | number | null) => Number(value ?? 0) })
	declare bytes: number;
}
