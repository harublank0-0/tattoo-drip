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
