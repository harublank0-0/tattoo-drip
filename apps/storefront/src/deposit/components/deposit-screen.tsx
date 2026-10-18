import { useDeposit } from "@tattoo-drip/react";
import type { DepositState } from "@tattoo-drip/sdk";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { DepositShell } from "../loader.ts";
import { isGone, screenFor } from "../problems.ts";
import { readDepositToken } from "../token.ts";
import {
	depositContact,
	depositView,
	formatReceived,
	todayIn,
} from "../view-model.ts";
import {
	ContactLine,
	DepositFrame,
	DepositIntro,
	DepositLoading,
	DueView,
	LoadProblemView,
	StateMessage,
} from "./deposit-page.tsx";
import { ProofForm } from "./proof-form.tsx";

const subscribeToHash = (onChange: () => void) => {
	window.addEventListener("hashchange", onChange);
	return () => window.removeEventListener("hashchange", onChange);
};

/**
 * The URL's fragment, in the browser only: undefined on the server (which
 * never receives it) and while hydrating, so both render the same shell.
 */
function useLocationHash(): string | undefined {
	return useSyncExternalStore(
		subscribeToHash,
		() => window.location.hash,
		() => undefined,
	);
}

/**
 * The deposit page (TAT-65b): the token from the fragment (spec ruling 3),
 * then the page from useDeposit. A missing or malformed token is the
 * dead-link message, with no request.
 */
export function DepositScreen({ shell }: { shell: DepositShell }) {
	const hash = useLocationHash();
	const token = hash === undefined ? undefined : readDepositToken(hash);
	const contact = depositContact(shell, null);
	return (
		<DepositFrame studioName={shell.studioName}>
			{token === undefined ? (
				<>
					<DepositLoading studioName={shell.studioName} />
					<ContactLine studioName={shell.studioName} contact={contact} />
				</>
			) : token === null ? (
				<>
					<LoadProblemView problem="dead" />
					<ContactLine studioName={shell.studioName} contact={contact} />
				</>
			) : (
				<DepositLoaded key={token} token={token} shell={shell} />
			)}
		</DepositFrame>
	);
}

/** Exported for the render tests; the screen is its only user. */
export function DepositLoaded({
	token,
	shell,
}: {
	token: string;
	shell: DepositShell;
}) {
	const query = useDeposit(token);
	const { refetch } = query;
	const screen = screenFor({
		data: query.data,
		error: query.error,
		fetchStatus: query.fetchStatus,
	});
	const view = screen.kind === "page" ? depositView(screen.page) : null;
	const shown = view ? view.state : screen.kind;
	const [moveFocus, setMoveFocus] = useState(false);
	const messageRef = useRef<HTMLParagraphElement>(null);

	const reread = useCallback(async (): Promise<
		DepositState | "gone" | "failed"
	> => {
		const result = await refetch();
		if (result.error) return isGone(result.error) ? "gone" : "failed";
		return result.data?.state ?? "failed";
	}, [refetch]);

	const leftDue = useCallback(() => setMoveFocus(true), []);

	// After the client's own Send, once the page shows its new state (or the
	// dead link), focus goes to that message (TAT-65: "focus moves to its
	// message"). Never on load: nothing takes focus by itself.
	useEffect(() => {
		if (!moveFocus || shown === "due" || shown === "loading") return;
		setMoveFocus(false);
		messageRef.current?.focus();
	}, [moveFocus, shown]);

	return (
		<>
			{view ? <DepositIntro view={view} /> : null}
			<div className="deposit-live" aria-live="polite">
				{view && view.state !== "due" ? (
					<StateMessage
						ref={messageRef}
						view={view}
						studioName={shell.studioName}
						received={formatReceived(view.proofSubmittedAt, shell.timezone)}
					/>
				) : null}
			</div>
			{screen.kind === "loading" ? (
				<DepositLoading studioName={shell.studioName} />
			) : null}
			{screen.kind === "problem" ? (
				<LoadProblemView
					ref={messageRef}
					problem={screen.problem}
					onRetry={() => {
						void refetch();
					}}
				/>
			) : null}
			{view && view.state === "due" ? (
				<DueView
					view={view}
					studioName={shell.studioName}
					today={todayIn(shell.timezone)}
					form={
						view.takesProof ? (
							<ProofForm
								token={token}
								view={view}
								studioName={shell.studioName}
								reread={reread}
								onLeftDue={leftDue}
							/>
						) : null
					}
				/>
			) : null}
			<ContactLine
				studioName={shell.studioName}
				contact={depositContact(shell, view?.referenceCode || null)}
			/>
		</>
	);
}
