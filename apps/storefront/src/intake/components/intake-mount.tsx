import {
	Component,
	lazy,
	type ReactNode,
	Suspense,
	useSyncExternalStore,
} from "react";
import type { IntakeFormProps } from "./intake-form.tsx";

/*
 * Where the intake form goes (TAT-57, spec ruling 2): only in the browser,
 * after hydration, from its own chunk. On the server, before hydration,
 * without JavaScript, or if the chunk fails to load, `fallback` (TAT-48's
 * chat links) shows instead, so nobody types into a form React doesn't
 * own yet, and the page's first load stays light.
 */

const LazyIntakeForm = lazy(() =>
	import("./intake-form.tsx").then((module) => ({
		default: module.IntakeForm,
	})),
);

const subscribe = () => () => {};

/** False on the server and while hydrating, true after. */
function useHydrated(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	);
}

/**
 * Which form this is: the artist it is for (none: the general form). The form
 * seeds its fields from `preferredArtist` when it mounts and TanStack Form
 * re-seeds only while nothing was touched, so moving between `/request?artist=
 * sita` and `/request` (back and forward, a header link) would otherwise keep
 * a touched form on the old artist under a heading that names the new one. A
 * different key mounts a fresh form (TAT-127). A flash request (TAT-129) is its
 * design's own form, so moving between a design and the same artist's custom
 * request mounts a fresh one too.
 */
export function intakeFormKey(state: IntakeFormProps["state"]): string {
	return state.flashDesignId !== undefined
		? `flash:${state.flashDesignId}`
		: (state.preferredArtist?.id ?? "");
}

export function IntakeMount({
	fallback,
	...props
}: IntakeFormProps & { fallback: ReactNode }) {
	const hydrated = useHydrated();
	if (!hydrated) return fallback;
	return (
		<FallbackOnError fallback={fallback}>
			<Suspense fallback={fallback}>
				<LazyIntakeForm key={intakeFormKey(props.state)} {...props} />
			</Suspense>
		</FallbackOnError>
	);
}

/** A chunk that can't load (a dropped connection) leaves the chat links, not a broken page. */
class FallbackOnError extends Component<
	{ fallback: ReactNode; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
