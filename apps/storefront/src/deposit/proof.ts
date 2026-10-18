import type { PhotoProblem } from "../intake/copy.ts";
import {
	type DecodedImage,
	type EncodeProfile,
	type ImageCodec,
	type PreparedReference,
	type PrepareOptions,
	prepareImage,
} from "../intake/images.ts";

/*
 * The payment screenshot (TAT-65b, spec rulings 14 and 15): one image,
 * prepared by the intake form's pipeline (src/intake/images.ts) with every
 * bound and timeout it has, and a profile of its own. Pure: the form runs
 * prepareProof and makes the preview URL (previewOf) around this state.
 */

const MIB = 1024 * 1024;

/**
 * 2048 px on the long edge, as the platform keeps proofs, so the small text
 * the studio checks (the amount, the transaction ID, the remark) stays
 * readable; at most 1.5 MiB when it can be, never over 4 MiB.
 */
export const PROOF_PROFILE: EncodeProfile = {
	steps: [
		{ edge: 2048, quality: 0.85 },
		{ edge: 2048, quality: 0.72 },
		{ edge: 1600, quality: 0.72 },
	],
	targetBytes: 1.5 * MIB,
	maxBytes: 4 * MIB,
	name: "payment.jpg",
};

/** The picked screenshot as the JPEG the page sends, or why it can't be. */
export function prepareProof<Image extends DecodedImage>(
	source: File,
	codec: ImageCodec<Image>,
	options?: PrepareOptions,
): Promise<PreparedReference> {
	return prepareImage(source, codec, PROOF_PROFILE, options);
}

export type ProofState =
	| {
			readonly kind: "empty";
			/** Why the last pick wasn't added, with the picked file's name (for the message only). */
			readonly problem: {
				readonly kind: PhotoProblem;
				readonly name: string;
			} | null;
	  }
	| { readonly kind: "preparing"; readonly id: number }
	| { readonly kind: "ready"; readonly id: number; readonly file: File };

export type ProofAction =
	| { readonly type: "picked"; readonly id: number }
	| { readonly type: "prepared"; readonly id: number; readonly file: File }
	| {
			readonly type: "refused";
			readonly id: number;
			readonly problem: PhotoProblem;
			readonly name: string;
	  }
	| { readonly type: "removed" };

export const NO_PROOF: ProofState = { kind: "empty", problem: null };

/** A result for a pick that is no longer the one being prepared is dropped. */
export function proofReducer(
	state: ProofState,
	action: ProofAction,
): ProofState {
	switch (action.type) {
		case "picked":
			return { kind: "preparing", id: action.id };
		case "prepared":
			return state.kind === "preparing" && state.id === action.id
				? { kind: "ready", id: action.id, file: action.file }
				: state;
		case "refused":
			return state.kind === "preparing" && state.id === action.id
				? {
						kind: "empty",
						problem: { kind: action.problem, name: action.name },
					}
				: state;
		case "removed":
			return NO_PROOF;
	}
}

export interface PreviewUrls {
	create(file: Blob): string;
	revoke(url: string): void;
}

/** A preview URL for `file`, and what frees it (once, however often it is called). */
export function previewOf(
	file: Blob,
	urls: PreviewUrls,
): { readonly url: string; release(): void } {
	const url = urls.create(file);
	let released = false;
	return {
		url,
		release() {
			if (released) return;
			released = true;
			urls.revoke(url);
		},
	};
}
