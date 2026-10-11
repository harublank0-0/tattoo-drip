import { inject } from "@adonisjs/core";
import type { MultipartFile } from "@adonisjs/core/bodyparser";
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
import {
	afterCommit,
	afterRollback,
	withTransaction,
} from "#services/db_context";

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

		return withTransaction(async (trx) => {
			// Stored inside the transaction: if it cannot open, nothing was
			// stored. The cleanup is registered right after the store resolves,
			// with no await in between, so no failure can fall between the two.
			// If this level rolls back, or the request fails later, no row will
			// point at the file. The cost: outside a request, the image is
			// processed with a transaction open.
			const qr = input.qr
				? await this.images.store(input.qr, { tenant, purpose: QR })
				: undefined;
			if (qr) afterRollback(() => this.images.delete(QR, qr.key));
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
	}

	/**
	 * Saves an edit. A new `qr` replaces the stored one; `removeQr` drops
	 * it. The old file is deleted once the outermost transaction commits.
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

		return withTransaction(async (trx) => {
			// Stored inside the transaction, as in create(): nothing is stored
			// if it cannot open, and the cleanup is registered right after the
			// store resolves. It comes before the row lock below, so the lock is
			// not held while the image is processed.
			const qr = input.qr
				? await this.images.store(input.qr, { tenant, purpose: QR })
				: undefined;
			if (qr) afterRollback(() => this.images.delete(QR, qr.key));
			// Lock the live row: a delete that landed since the form
			// loaded makes this a 404, and a QR changed by another edit is
			// read from the row, not from the form's copy.
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
			// The replaced file goes only once the change is committed for good.
			if (previous && previous !== next) {
				afterCommit(() => this.images.delete(QR, previous));
			}
			return live;
		});
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
		await withTransaction(async (trx) => {
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
