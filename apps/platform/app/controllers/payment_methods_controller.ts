import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import type PaymentMethod from "#modules/payments/models/payment_method";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import { movePaymentMethodValidator } from "#modules/payments/validators/payment_method";

/**
 * The studio's payment methods, managed by its owners. Every :id loads
 * through findFor(tenant, id), so another tenant's method is a 404.
 */
@inject()
export default class PaymentMethodsController {
	constructor(
		private methods: PaymentMethodService,
		private images: ImageService,
	) {}

	async index(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const methods = await this.methods.list(tenant);

		return ctx.inertia.render("settings/payments", {
			deposits: {
				defaultDepositPercent: tenant.defaultDepositPercent,
				depositPolicy: tenant.depositPolicy,
			},
			methods: await Promise.all(methods.map((method) => this.toProps(method))),
		});
	}

	// Task 7 replaces these two with the form page.
	async create({ response }: HttpContext) {
		return response.notFound();
	}

	async edit({ response }: HttpContext) {
		return response.notFound();
	}

	async move(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const method = await this.methods.findFor(tenant, ctx.params.id);
		const { direction } = await ctx.request.validateUsing(
			movePaymentMethodValidator,
		);

		await this.methods.move(tenant, method, direction);

		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}

	async destroy(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const method = await this.methods.findFor(tenant, ctx.params.id);

		await this.methods.delete(tenant, method);

		ctx.session.flash("success", `"${method.label}" deleted.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}

	/**
	 * What the pages get for one method, with its QR's public URL.
	 */
	private async toProps(method: PaymentMethod) {
		return {
			id: method.id,
			kind: method.kind,
			label: method.label,
			accountName: method.accountName,
			accountNumber: method.accountNumber,
			bankName: method.bankName,
			showOnDepositPage: method.showOnDepositPage,
			qrUrl: method.qrImageKey
				? await this.images.url("payment_qr", method.qrImageKey)
				: null,
		};
	}
}
