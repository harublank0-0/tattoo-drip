import { inject } from "@adonisjs/core";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import type Tenant from "#modules/tenancy/models/tenant";
import { type SetupChecklist, setupChecklist } from "#modules/tenancy/setup";

/**
 * The new-studio checklist (TAT-101) for the tenant a request is in. It asks
 * each module's own service, never its tables, and every service call is
 * scoped to the tenant (row-level security backs it): another studio's
 * artists, methods or inquiries cannot tick a step. Call it in the tenant's
 * context. The deposit policy is the tenant row's own column.
 */
@inject()
export default class SetupService {
	constructor(
		private artists: ArtistService,
		private paymentMethods: PaymentMethodService,
		private inquiries: InquiryService,
	) {}

	async checklist(tenant: Tenant): Promise<SetupChecklist> {
		const [artists, depositMethods, hasInquiry] = await Promise.all([
			this.artists.list(tenant),
			this.paymentMethods.listForDepositPage(tenant),
			this.inquiries.hasAny(tenant),
		]);
		return setupChecklist({
			artists: artists.length,
			depositMethods: depositMethods.length,
			depositPolicy: tenant.depositPolicy,
			inquiries: hasInquiry ? 1 : 0,
		});
	}
}
