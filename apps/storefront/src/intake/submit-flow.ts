import type { CreateInquiryInput, InquiryReceipt } from "@tattoo-drip/sdk";
import type { ChallengeFailure, ChallengeResult } from "./challenge.ts";

/*
 * One attempt to send an inquiry (TAT-57, spec ruling 8): a fresh token,
 * one send, the widget reset whatever happened. A second call while one
 * runs is `busy` and sends nothing (a double tap on a slow phone).
 */

export type SubmitPhase = "checking" | "sending";

export type SubmitResult =
	| { readonly kind: "busy" }
	| { readonly kind: "sent"; readonly receipt: InquiryReceipt }
	| { readonly kind: "challenge"; readonly reason: ChallengeFailure }
	| { readonly kind: "failed"; readonly error: unknown };

export interface SubmitDeps {
	/** null without a site key (development): no token is sent. */
	readonly challenge: {
		token(): Promise<ChallengeResult>;
		reset(): void;
	} | null;
	send(input: CreateInquiryInput): Promise<InquiryReceipt>;
	onPhase(phase: SubmitPhase): void;
}

export function createSubmitter(
	deps: SubmitDeps,
): (input: CreateInquiryInput) => Promise<SubmitResult> {
	let running = false;
	return async (input) => {
		if (running) return { kind: "busy" };
		running = true;
		try {
			let challengeToken: string | undefined;
			if (deps.challenge) {
				deps.onPhase("checking");
				let result: ChallengeResult;
				try {
					result = await deps.challenge.token();
				} catch {
					// A widget that threw is a check that didn't finish, not a dead form.
					result = { ok: false, reason: "blocked" };
				}
				if (!result.ok) {
					resetQuietly(deps.challenge);
					return { kind: "challenge", reason: result.reason };
				}
				challengeToken = result.token;
			}
			deps.onPhase("sending");
			try {
				const receipt = await deps.send({ ...input, challengeToken });
				return { kind: "sent", receipt };
			} catch (error) {
				return { kind: "failed", error };
			} finally {
				resetQuietly(deps.challenge);
			}
		} finally {
			running = false;
		}
	};
}

/** A reset that fails (the widget is gone) must not hide how the attempt ended. */
function resetQuietly(challenge: SubmitDeps["challenge"]): void {
	try {
		challenge?.reset();
	} catch {
		// Nothing left to reset; the next attempt renders a new widget.
	}
}
