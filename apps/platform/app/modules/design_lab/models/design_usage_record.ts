import { DesignUsageRecordSchema } from "#database/schema";
import type { UsageStatus } from "#modules/design_lab/rules";

/** One generation attempt in the studio's allowance ledger. */
export default class DesignUsageRecord extends DesignUsageRecordSchema {
	declare status: UsageStatus;
}
