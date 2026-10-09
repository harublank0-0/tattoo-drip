import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import { InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { PaymentMethodRuleError } from "#modules/payments/errors";
import type PaymentMethod from "#modules/payments/models/payment_method";
import { PAYMENT_METHOD_KINDS } from "#modules/payments/models/payment_method";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentMethodService from "#modules/payments/services/payment_method_service";
import {
	createPaymentMethodValidator,
	movePaymentMethodValidator,
	updatePaymentMethodValidator,
} from "#modules/payments/validators/payment_method";

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

	async create({ inertia }: HttpContext) {
		return inertia.render("settings/payment_method_form", {
			kinds: [...PAYMENT_METHOD_KINDS],
			method: null,
		});
	}

	async store(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const input = await ctx.request.validateUsing(createPaymentMethodValidator);

		const method = await asFieldErrors(() =>
			this.methods.create(tenant, input),
		);

		ctx.session.flash("success", `"${method.label}" added.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
	}

	async edit(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		const method = await this.methods.findFor(tenant, ctx.params.id);

		return ctx.inertia.render("settings/payment_method_form", {
			kinds: [...PAYMENT_METHOD_KINDS],
			method: await this.toProps(method),
		});
	}

	async update(ctx: HttpContext) {
		const { tenant } = tenantContext(ctx);
		// Load first: another tenant's id is a 404 even with a bad body.
		const method = await this.methods.findFor(tenant, ctx.params.id);
		const input = await ctx.request.validateUsing(updatePaymentMethodValidator);

		const saved = await asFieldErrors(() =>
			this.methods.update(tenant, method, input),
		);

		ctx.session.flash("success", `"${saved.label}" saved.`);
		return ctx.response
			.redirect()
			.toRoute("tenant.settings.payments", { tenant: tenant.slug });
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

/**
 * Turns the service's rule errors and an unusable image into field
 * errors, so the form shows them next to their inputs.
 */
async function asFieldErrors<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof PaymentMethodRuleError) {
			throw new errors.E_VALIDATION_ERROR(
				error.violations.map(({ field, message }) => ({
					field,
					message,
					rule: "paymentMethod",
				})),
			);
		}
		if (error instanceof InvalidImageError) {
			throw new errors.E_VALIDATION_ERROR([
				{ field: "qr", message: error.message, rule: "image" },
			]);
		}
		throw error;
	}
}
