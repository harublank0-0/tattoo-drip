import TenantJob from "#services/tenant_job";

type Payload = { tenantId: string };

/** Stub: the storage meter's 95% email (step 3, Task 2). */
export default class StorageAlertJob extends TenantJob<Payload> {
	protected async handle() {}
}
