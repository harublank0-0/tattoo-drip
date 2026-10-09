import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
import db from "@adonisjs/lucid/services/db";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { PaymentMethodRuleError } from "#modules/payments/errors";
import PaymentMethod, {
	type PaymentMethodKind,
} from "#modules/payments/models/payment_method";
import {
	checkPaymentMethod,
	kindDetails,
	type PaymentMethodState,
} from "#modules/payments/rules";
import type Tenant from "#modules/tenancy/models/tenant";

type Upload = Pick<MultipartFile, "tmpPath">;
type TenantRef = Pick<Tenant, "id">;

export type NewPaymentMethod = {
	kind: PaymentMethodKind;
	label: string;
	accountName?: string | null;
	accountNumber?: string | null;
	bankName?: string | null;
	showOnDepositPage?: boolean;
	qr?: Upload;
};

/**
 * An edit. The kind is fixed; without `qr` or `removeQr` the stored QR
 * stays.
 */
export type PaymentMethodChanges = Omit<NewPaymentMethod, "kind"> & {
	removeQr?: boolean;
};

const QR = "payment_qr";

/**
 * The way to read and change a studio's payment methods. Every call is
 * scoped to the tenant. Kind rules come from checkPaymentMethod; QR files
 * are stored through ImageService and cleaned up here.
 */
@inject()
export default class PaymentMethodService {
	constructor(private images: ImageService) {}

	/**
	 * The tenant's live methods, in the owner's order.
	 */
	async list(tenant: TenantRef): Promise<PaymentMethod[]> {
		return PaymentMethod.query()
			.where("tenant_id", tenant.id)
			.orderBy("position", "asc")
			.orderBy("id", "asc");
	}

	/**
	 * The tenant's live method with this id. An unknown id, a deleted method
	 * and another tenant's method all throw E_ROW_NOT_FOUND (a 404), so
	 * callers can't tell them apart.
	 */
	async findFor(tenant: TenantRef, id: string): Promise<PaymentMethod> {
		return PaymentMethod.query()
			.where("tenant_id", tenant.id)
			.where("id", id)
			.firstOrFail();
	}

	/**
	 * Adds a method at the end of the list. Throws PaymentMethodRuleError
	 * before storing anything if it breaks its kind's rules.
	 */
	async create(
		tenant: TenantRef,
		input: NewPaymentMethod,
	): Promise<PaymentMethod> {
		const details = kindDetails(input.kind, input);
		const showOnDepositPage = input.showOnDepositPage ?? false;
		assertRules({
			kind: input.kind,
			...details,
			hasQr: !!input.qr,
			showOnDepositPage,
		});

		const qr = input.qr
			? await this.images.store(input.qr, { tenant, purpose: QR })
			: undefined;
		try {
			return await db.transaction(async (trx) => {
				const last = await trx
					.from("payment_methods")
					.where("tenant_id", tenant.id)
					.whereNull("deleted_at")
					.max("position as max")
					.first();
				return PaymentMethod.create(
					{
						tenantId: tenant.id,
						kind: input.kind,
						label: input.label,
						...details,
						showOnDepositPage,
						qrImageKey: qr?.key ?? null,
						// The first method gets 0. Ties from two adds at once are
						// harmless: move() renumbers.
						position: (last?.max ?? -1) + 1,
					},
					{ client: trx },
				);
			});
		} catch (error) {
			if (qr) await this.images.delete(QR, qr.key);
			throw error;
		}
	}

	/**
	 * Saves an edit. A new `qr` replaces the stored one; `removeQr` drops
	 * it. The old file is deleted once the row is saved.
	 */
	async update(
		tenant: TenantRef,
		method: PaymentMethod,
		input: PaymentMethodChanges,
	): Promise<PaymentMethod> {
		assertOwnedBy(tenant, method);
		const details = kindDetails(method.kind, input);
		const showOnDepositPage = input.showOnDepositPage ?? false;
		// Fail fast on the form's copy, before storing anything. The locked
		// row below decides for real.
		assertRules({
			kind: method.kind,
			...details,
			hasQr: !!input.qr || (!!method.qrImageKey && !input.removeQr),
			showOnDepositPage,
		});

		const qr = input.qr
			? await this.images.store(input.qr, { tenant, purpose: QR })
			: undefined;
		let saved: PaymentMethod;
		let oldKey: string | null;
		let newKey: string | null;
		try {
			// Lock the live row first: a delete that landed since the form
			// loaded makes this a 404, and a QR changed by another edit is
			// read from the row, not from the form's copy.
			({ saved, oldKey, newKey } = await db.transaction(async (trx) => {
				const live = await PaymentMethod.query({ client: trx })
					.where("tenant_id", tenant.id)
					.where("id", method.id)
					.forUpdate()
					.firstOrFail();
				const previous = live.qrImageKey;
				const keepsQr = !!previous && !input.qr && !input.removeQr;
				assertRules({
					kind: live.kind,
					...details,
					hasQr: !!input.qr || keepsQr,
					showOnDepositPage,
				});
				const next = qr?.key ?? (keepsQr ? previous : null);
				live.merge({
					label: input.label,
					...details,
					showOnDepositPage,
					qrImageKey: next,
				});
				await live.save();
				return { saved: live, oldKey: previous, newKey: next };
			}));
		} catch (error) {
			if (qr) await this.images.delete(QR, qr.key);
			throw error;
		}

		if (oldKey && oldKey !== newKey) await this.images.delete(QR, oldKey);
		return saved;
	}

	/**
	 * Swaps the method with its live neighbour. The whole list is renumbered
	 * from 0 in the new order, so gaps from deletes and ties from two adds
	 * at once fix themselves. Past either end, nothing changes.
	 */
	async move(
		tenant: TenantRef,
		method: PaymentMethod,
		direction: "up" | "down",
	): Promise<void> {
		await db.transaction(async (trx) => {
			const methods = await PaymentMethod.query({ client: trx })
				.where("tenant_id", tenant.id)
				.orderBy("position", "asc")
				.orderBy("id", "asc")
				.forUpdate();
			const from = methods.findIndex(({ id }) => id === method.id);
			const to = direction === "up" ? from - 1 : from + 1;
			if (from === -1 || to < 0 || to >= methods.length) return;

			[methods[from], methods[to]] = [methods[to], methods[from]];
			for (const [position, each] of methods.entries()) {
				if (each.position === position) continue;
				each.position = position;
				await each.save();
			}
		});
	}

	/**
	 * Soft-deletes the method. Its QR file stays, like every soft-deleted
	 * record's files.
	 */
	async delete(tenant: TenantRef, method: PaymentMethod): Promise<void> {
		assertOwnedBy(tenant, method);
		await method.softDelete();
	}
}

function assertRules(state: PaymentMethodState) {
	const violations = checkPaymentMethod(state);
	if (violations.length > 0) throw new PaymentMethodRuleError(violations);
}

/**
 * A caller bug, not a user error: methods come from findFor(tenant, id).
 */
function assertOwnedBy(tenant: TenantRef, method: PaymentMethod) {
	if (method.tenantId !== tenant.id) {
		throw new Error(`Payment method ${method.id} belongs to another tenant`);
	}
}
