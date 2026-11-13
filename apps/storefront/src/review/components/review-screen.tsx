import { useReview } from "@tattoo-drip/react";
import { useEffect, useRef, useState } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { copy } from "../copy.ts";
import type { ReviewShell } from "../loader.ts";
import { type LoadProblem, loadProblemOf } from "../problems.ts";
import { REVIEW_TOKEN, readReviewToken } from "../token.ts";
import { formatDay, hasSaved } from "../view-model.ts";
import { ReviewForm } from "./review-form.tsx";
import {
	headingFor,
	ReviewFrame,
	ReviewLoading,
	ReviewProblem,
} from "./review-page.tsx";

/** Where the tab keeps the token once it left the address bar (this tab only). */
export const TOKEN_STORAGE_KEY = "tattoo-drip:review-token";

function stored(): string | null {
	try {
		const value = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
		return value && REVIEW_TOKEN.test(value) ? value : null;
	} catch {
		return null;
	}
}

function keep(token: string | null) {
	try {
		if (token) window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
		else window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
	} catch {
		// Storage refused (a private window): the token lives in memory only.
	}
}

/**
 * The link's token (finding 11), in the browser only: undefined on the
 * server (which never receives the fragment) and while hydrating, so both
 * render the same shell. On load it reads the fragment, removes it from the
 * address bar (`history.replaceState`, keeping the router's state), and
 * keeps the token in memory and in this tab's sessionStorage, so a reload
 * still works while the address bar, a screenshot or the history no longer
 * show it. A fragment that isn't a token is the dead link. A new link
 * opened in the tab (a hash change) replaces it.
 */
function useReviewToken(): string | null | undefined {
	const [token, setToken] = useState<string | null | undefined>(undefined);
	useEffect(() => {
		const take = () => {
			const hash = window.location.hash;
			if (hash && hash !== "#") {
				const read = readReviewToken(hash);
				window.history.replaceState(
					window.history.state,
					"",
					window.location.pathname,
				);
				keep(read);
				setToken(read);
				return;
			}
			setToken(stored());
		};
		take();
		window.addEventListener("hashchange", take);
		return () => window.removeEventListener("hashchange", take);
	}, []);
	return token;
}

export interface ReviewConnection {
	readonly apiUrl: string;
	readonly mediaUrl: string;
	readonly challengeSiteKey: string | null;
}

/**
 * The review page (Reviews and Fresh ink): the token, then the page from
 * useReview. A missing or malformed token is the dead link, with no request.
 */
export function ReviewScreen({
	shell,
	connection,
}: {
	shell: ReviewShell;
	connection: ReviewConnection;
}) {
	return (
		<ReviewForToken
			token={useReviewToken()}
			shell={shell}
			connection={connection}
		/>
	);
}

/** The screen for a fragment, as the render tests give it. */
export function ReviewForHash({
	hash,
	shell,
	connection,
}: {
	hash: string | undefined;
	shell: ReviewShell;
	connection: ReviewConnection;
}) {
	return (
		<ReviewForToken
			token={hash === undefined ? undefined : readReviewToken(hash)}
			shell={shell}
			connection={connection}
		/>
	);
}

/** The screen for a token (`undefined` on the server and while hydrating; null: dead). */
export function ReviewForToken({
	token,
	shell,
	connection,
}: {
	token: string | null | undefined;
	shell: ReviewShell;
	connection: ReviewConnection;
}) {
	if (typeof token === "string") {
		return (
			<ReviewLoaded
				key={token}
				token={token}
				shell={shell}
				connection={connection}
			/>
		);
	}
	return (
		<ReviewFrame
			studioName={shell.studioName}
			logo={shell.logo}
			heading={headingFor(token === undefined ? "loading" : "dead")}
		>
			{token === undefined ? (
				<ReviewLoading />
			) : (
				<ReviewProblem
					problem="dead"
					studioName={shell.studioName}
					contact={shell.contact}
				/>
			)}
		</ReviewFrame>
	);
}

/**
 * What the screen shows for the query (finding 17), as the deposit page
 * does: the dead link after any 404; a rate limit or a failed read without
 * data; and a first read that can't start (offline: TanStack pauses it and
 * no error ever comes) as a load problem with Try again, never "Loading"
 * for ever. Exported for the tests.
 */
export function screenOf(query: {
	data: unknown;
	error: unknown;
	fetchStatus: "fetching" | "paused" | "idle";
}): "page" | "loading" | LoadProblem | "offline" {
	if (query.error && loadProblemOf(query.error) === "dead") return "dead";
	if (query.data) return "page";
	if (query.error) return loadProblemOf(query.error);
	if (query.fetchStatus === "paused") return "offline";
	return "loading";
}

/** Exported for the render tests. */
export function ReviewLoaded({
	token,
	shell,
	connection,
}: {
	token: string;
	shell: ReviewShell;
	connection: ReviewConnection;
}) {
	const query = useReview(token);
	const [gone, setGone] = useState(false);
	const [retrying, setRetrying] = useState(false);
	const problemRef = useRef<HTMLParagraphElement>(null);
	const screen = gone
		? "dead"
		: screenOf({
				data: query.data,
				error: query.error,
				fetchStatus: query.fetchStatus,
			});

	useEffect(() => {
		if (screen === "dead") keep(null);
	}, [screen]);

	if (screen !== "page" && screen !== "loading") {
		return (
			<ReviewFrame
				studioName={shell.studioName}
				logo={shell.logo}
				heading={headingFor(screen === "offline" ? "failed" : screen)}
			>
				<ReviewProblem
					ref={problemRef}
					problem={screen === "offline" ? "failed" : screen}
					message={screen === "offline" ? copy.offline : undefined}
					studioName={shell.studioName}
					contact={shell.contact}
					retrying={retrying}
					onRetry={() => {
						setRetrying(true);
						const done = () => setRetrying(false);
						void query.refetch().then(done, done);
					}}
				/>
			</ReviewFrame>
		);
	}
	const page = query.data;
	if (screen === "loading" || !page) {
		return (
			<ReviewFrame
				studioName={shell.studioName}
				logo={shell.logo}
				heading={headingFor("loading")}
			>
				<ReviewLoading />
			</ReviewFrame>
		);
	}
	return (
		<ReviewFrame
			studioName={shell.studioName}
			logo={shell.logo}
			heading={headingFor(hasSaved(page) ? "saved" : "open")}
		>
			<div className="deposit-intro">
				<p>
					<Fill
						template={
							page.project.artistName ? copy.tattooedBy : copy.tattooedOn
						}
						values={{
							artist: page.project.artistName ?? "",
							date: formatDay(page.project.tattooedOn),
						}}
					/>
				</p>
				<p className="deposit-muted">
					<Fill template={copy.intro} values={{ studio: shell.studioName }} />
				</p>
			</div>
			<ReviewForm
				token={token}
				page={page}
				studioName={shell.studioName}
				apiUrl={connection.apiUrl}
				mediaUrl={connection.mediaUrl}
				challengeSiteKey={connection.challengeSiteKey}
				onGone={() => {
					setGone(true);
					requestAnimationFrame(() => problemRef.current?.focus());
				}}
			/>
		</ReviewFrame>
	);
}
