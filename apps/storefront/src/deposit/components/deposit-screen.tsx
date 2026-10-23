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
import { isGone, retryScreen, screenFor, sentGone } from "../problems.ts";
import { readDepositToken } from "../token.ts";
import {
	depositContact,
	depositView,
	formatReceived,
	formatSessionStart,
	type MethodPick,
	pickMethod,
	selectedMethod,
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
	StateRegion,
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
 * dead-link message, with no request. With a token, DepositLoaded draws the
 * frame itself, so its h1 can name the deposit's state (TAT-106).
 */
export function DepositScreen({ shell }: { shell: DepositShell }) {
	return <DepositForHash hash={useLocationHash()} shell={shell} />;
}

/**
 * The screen for the URL's fragment (`undefined` on the server and while
 * hydrating). Exported for the render tests, which cannot set a fragment;
 * the screen is its only user.
 */
export function DepositForHash({
	hash,
	shell,
}: {
	hash: string | undefined;
	shell: DepositShell;
}) {
	const token = hash === undefined ? undefined : readDepositToken(hash);
	if (typeof token === "string") {
		return <DepositLoaded key={token} token={token} shell={shell} />;
	}
	const contact = depositContact(shell, null);
	return (
		<DepositFrame
			studioName={shell.studioName}
			logo={shell.logo}
			problem={token === undefined ? null : "dead"}
		>
			{token === undefined ? (
				<DepositLoading studioName={shell.studioName} />
			) : (
				<LoadProblemView problem="dead" />
			)}
			<ContactLine studioName={shell.studioName} contact={contact} />
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
	// When a send was answered 404 (ms): the page is dead until a read succeeds after it.
	const [goneAt, setGoneAt] = useState<number | null>(null);
	// Try again is running (a read that can't start offline waits for the phone
	// to come back online, and so does this).
	const [retrying, setRetrying] = useState(false);
	const screen = retryScreen(
		screenFor({
			data: query.data,
			error: query.error,
			fetchStatus: query.fetchStatus,
			sendGone: sentGone(goneAt, query.dataUpdatedAt),
		}),
		retrying,
	);
	const view = screen.kind === "page" ? depositView(screen.page) : null;
	const shown = view ? view.state : screen.kind;
	// The client's latest pick in step 2 (by the method's identity, which survives
	// a reorder); null until they pick. If the picked method has left the list
	// the first one shows, and the answer in the form is left as it is.
	const [picked, setPicked] = useState<MethodPick | null>(null);
	const selected =
		view?.state === "due"
			? selectedMethod(view.methods, picked?.id ?? null)
			: null;
	const choose = (id: string) => {
		const method = view?.methods.find((each) => each.id === id);
		if (method) setPicked((previous) => pickMethod(previous, method));
	};
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
	// The client's own Send starts (it may move the page off `due`, and focus to
	// its message), or ends with the page still due.
	const sending = useCallback((active: boolean) => setMoveFocus(active), []);
	const gone = useCallback(() => {
		setGoneAt(Date.now());
		setMoveFocus(true);
	}, []);

	// After the client's own Send, once the page shows its new state (or the
	// dead link), focus goes to that message (TAT-65: "focus moves to its
	// message"). Never on load: nothing takes focus by itself. Until it does,
	// the live region is quiet, so the message isn't announced twice.
	useEffect(() => {
		if (!moveFocus || shown === "due" || shown === "loading") return;
		setMoveFocus(false);
		messageRef.current?.focus();
	}, [moveFocus, shown]);

	return (
		<DepositFrame
			studioName={shell.studioName}
			logo={shell.logo}
			artistName={view?.artistName ?? null}
			wide={view?.state === "due" && view.methods.length > 0}
			view={view}
			problem={screen.kind === "problem" ? screen.problem : null}
		>
			{view ? <DepositIntro view={view} /> : null}
			<StateRegion quiet={moveFocus}>
				{view && view.state !== "due" ? (
					<StateMessage
						ref={messageRef}
						view={view}
						studioName={shell.studioName}
						received={formatReceived(view.proofSubmittedAt, shell.timezone)}
						sessionStart={
							view.session
								? formatSessionStart(view.session.startsAt, shell.timezone)
								: null
						}
					/>
				) : null}
			</StateRegion>
			{screen.kind === "loading" ? (
				<DepositLoading studioName={shell.studioName} />
			) : null}
			{screen.kind === "problem" ? (
				<LoadProblemView
					ref={messageRef}
					problem={screen.problem}
					retrying={retrying}
					failures={query.errorUpdateCount}
					onRetry={() => {
						setRetrying(true);
						const done = () => setRetrying(false);
						void refetch().then(done, done);
					}}
				/>
			) : null}
			{view && view.state === "due" ? (
				<DueView
					view={view}
					studioName={shell.studioName}
					today={todayIn(shell.timezone)}
					selected={selected}
					onSelect={choose}
					form={
						view.takesProof ? (
							<ProofForm
								token={token}
								view={view}
								studioName={shell.studioName}
								pick={picked}
								reread={reread}
								onLeftDue={leftDue}
								onGone={gone}
								onSending={sending}
							/>
						) : null
					}
				/>
			) : null}
			<ContactLine
				studioName={shell.studioName}
				contact={depositContact(shell, view?.referenceCode || null)}
			/>
		</DepositFrame>
	);
}
