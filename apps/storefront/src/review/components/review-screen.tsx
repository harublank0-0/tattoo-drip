import { useReview } from "@tattoo-drip/react";
import { useRef, useState, useSyncExternalStore } from "react";
import { Fill } from "../../intake/components/fill.tsx";
import { copy } from "../copy.ts";
import type { ReviewShell } from "../loader.ts";
import { loadProblemOf } from "../problems.ts";
import { readReviewToken } from "../token.ts";
import { formatDay, hasSaved } from "../view-model.ts";
import { ReviewForm } from "./review-form.tsx";
import {
	headingFor,
	ReviewFrame,
	ReviewLoading,
	ReviewProblem,
} from "./review-page.tsx";

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

export interface ReviewConnection {
	readonly apiUrl: string;
	readonly mediaUrl: string;
	readonly challengeSiteKey: string | null;
}

/**
 * The review page (Reviews and Fresh ink): the token from the fragment,
 * then the page from useReview. A missing or malformed token is the dead
 * link, with no request.
 */
export function ReviewScreen({
	shell,
	connection,
}: {
	shell: ReviewShell;
	connection: ReviewConnection;
}) {
	return (
		<ReviewForHash
			hash={useLocationHash()}
			shell={shell}
			connection={connection}
		/>
	);
}

/** The screen for a fragment (`undefined` on the server and while hydrating). Exported for the render tests. */
export function ReviewForHash({
	hash,
	shell,
	connection,
}: {
	hash: string | undefined;
	shell: ReviewShell;
	connection: ReviewConnection;
}) {
	const token = hash === undefined ? undefined : readReviewToken(hash);
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
	const problemRef = useRef<HTMLParagraphElement>(null);
	const page = gone ? undefined : query.data;
	const problem = gone
		? "dead"
		: query.error && !page
			? loadProblemOf(query.error)
			: query.error && loadProblemOf(query.error) === "dead"
				? "dead"
				: null;

	if (problem) {
		return (
			<ReviewFrame
				studioName={shell.studioName}
				logo={shell.logo}
				heading={headingFor(problem)}
			>
				<ReviewProblem
					ref={problemRef}
					problem={problem}
					studioName={shell.studioName}
					contact={shell.contact}
					onRetry={() => void query.refetch()}
				/>
			</ReviewFrame>
		);
	}
	if (!page) {
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
				onSaved={() => undefined}
			/>
		</ReviewFrame>
	);
}
