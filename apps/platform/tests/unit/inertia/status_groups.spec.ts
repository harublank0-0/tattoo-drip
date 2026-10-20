import { test } from "@japa/runner";
import { INQUIRY_STATUSES } from "#modules/inquiries/models/inquiry";
import { PROJECT_STATUSES } from "#modules/projects/models/tattoo_project";
// @ts-expect-error TS6305: the server project only references the inertia project, so it cannot read its sources and the module is untyped here; `ProjectsModule` below restates its shape and the inertia project type-checks the real one.
import * as projectsModule from "../../../inertia/components/projects.js";

type Group = "studio" | "client" | "booked" | "chair" | "closed";
type ProjectsModule = {
	STATUS_LABELS: Record<string, string>;
	STATUS_GROUPS: Record<string, Group>;
	STATUS_GROUP_LABELS: Record<Group, string>;
	PROOF_WAITING_STATUS: string;
	statusGroup(status: string): Group;
};
const {
	STATUS_LABELS,
	STATUS_GROUPS,
	STATUS_GROUP_LABELS,
	PROOF_WAITING_STATUS,
	statusGroup,
} = projectsModule as ProjectsModule;

const GROUPS: Group[] = ["studio", "client", "booked", "chair", "closed"];

/** Every status a badge can show: the server's, plus the screenshot flag. */
const SHOWN = [
	...PROJECT_STATUSES,
	...INQUIRY_STATUSES,
	"screenshot_to_check",
] as string[];

test.group("Status groups", () => {
	test("every status a badge shows is in exactly one of the five groups", ({
		assert,
	}) => {
		for (const status of new Set(SHOWN)) {
			const group = STATUS_GROUPS[status];
			assert.include(GROUPS, group, `${status} has no group`);
			assert.equal(statusGroup(status), group);
		}
		assert.equal(PROOF_WAITING_STATUS, "screenshot_to_check");
	});

	test("the map names no status the server doesn't have", ({ assert }) => {
		assert.sameMembers(Object.keys(STATUS_GROUPS), [...new Set(SHOWN)]);
	});

	test("the groups are the studio's table: whose move it is", ({ assert }) => {
		const members = (group: Group) =>
			Object.keys(STATUS_GROUPS)
				.filter((status) => STATUS_GROUPS[status] === group)
				.sort();
		assert.deepEqual(members("studio"), [
			"new",
			"reviewing",
			"screenshot_to_check",
		]);
		assert.deepEqual(members("client"), [
			"deposit_pending",
			"on_hold",
			"quoted",
		]);
		assert.deepEqual(members("booked"), ["booked"]);
		assert.deepEqual(members("chair"), ["healing_check", "in_progress"]);
		assert.deepEqual(members("closed"), [
			"accepted",
			"cancelled",
			"completed",
			"declined",
		]);
	});

	test("every status has a word, and every group has a name", ({ assert }) => {
		assert.sameMembers(Object.keys(STATUS_LABELS), Object.keys(STATUS_GROUPS));
		for (const status of Object.keys(STATUS_GROUPS)) {
			assert.isAbove(STATUS_LABELS[status].length, 0, status);
		}
		assert.sameMembers(Object.keys(STATUS_GROUP_LABELS), GROUPS);
		assert.equal(STATUS_LABELS.screenshot_to_check, "Screenshot to check");
	});

	test("a status nobody mapped is shown as closed, never as someone's move", ({
		assert,
	}) => {
		assert.equal(statusGroup("something_new"), "closed");
	});
});
