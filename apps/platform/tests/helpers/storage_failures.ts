import drive from "@adonisjs/drive/services/main";

/**
 * Makes a disk's `delete` fail for the keys `fails` picks, as an unreachable
 * object store would (TAT-116: a removal must not report success while a
 * file is still there). Every other key is deleted for real. `attempts` lists
 * each key it was asked to delete; `restore()` heals the disk, and the test
 * must call it (use `finally`) because the disk is shared by the whole run.
 */
export function failDeletes(
	visibility: "public" | "private",
	fails: (key: string) => boolean,
) {
	const disk = drive.use(visibility);
	const original = disk.delete.bind(disk);
	const attempts: string[] = [];
	disk.delete = async (key: string) => {
		attempts.push(key);
		if (fails(key)) throw new Error("storage unreachable");
		return original(key);
	};
	return {
		attempts,
		restore() {
			disk.delete = original;
		},
	};
}

/**
 * Makes a disk's `put` fail for the keys `fails` picks (the image's copies are
 * written one at a time, so a test can let the first succeed and fail the
 * next). Every other key is written for real; `restore()` heals the disk.
 */
export function failPuts(
	visibility: "public" | "private",
	fails: (key: string) => boolean,
) {
	const disk = drive.use(visibility);
	const original = disk.put.bind(disk);
	disk.put = (async (key: string, ...rest: unknown[]) => {
		if (fails(key)) throw new Error("storage unreachable");
		return (original as (...args: unknown[]) => Promise<void>)(key, ...rest);
	}) as typeof disk.put;
	return {
		restore() {
			disk.put = original;
		},
	};
}

/**
 * The state a failed upload can leave (TAT-116 fix round 2): the first copy
 * is written, a later copy fails, and the cleanup of the first fails too, so
 * the image is stored under its plain key (`<id>.jpg`, naming no copies) while
 * the first copy stays on the disk. Run `store` inside `during`; the disk is
 * healed before this returns.
 */
export async function withStrayCopy<T>(
	visibility: "public" | "private",
	copies: { writtenFirst: string; failing: string },
	during: () => Promise<T>,
): Promise<T> {
	const puts = failPuts(visibility, (key) => key.endsWith(copies.failing));
	const deletes = failDeletes(visibility, (key) =>
		key.endsWith(copies.writtenFirst),
	);
	try {
		return await during();
	} finally {
		puts.restore();
		deletes.restore();
	}
}
