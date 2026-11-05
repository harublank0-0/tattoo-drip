import { useBlocker, useRouter } from "@tanstack/react-router";

/**
 * Asks before an in-app navigation while an inquiry is on its way (spec
 * ruling 7). The form's own `beforeunload` listener covers a reload, a closed
 * tab and a plain link; a link the router takes over (RouterAnchor: Ink
 * Noir's header, menu and footer) or Back to a page the router showed never
 * unloads the document, so that listener never hears of it, and the form
 * would unmount mid-send. While `active`, the router's own blocker asks the
 * same question with the browser's confirm.
 *
 * It renders nothing. Outside a router (react-dom/server tests) it does
 * nothing: `useBlocker` needs one, so it lives in a child that mounts only
 * when there is a router and the guard is active, and unmounting it lifts the
 * block.
 */
export function LeaveGuard({
	active,
	message,
}: {
	active: boolean;
	/** The question the confirm asks. */
	message: string;
}) {
	// The hook's type says a router is always there; outside one it is undefined.
	const router: ReturnType<typeof useRouter> | undefined = useRouter({
		warn: false,
	});
	return router && active ? <RouterBlocker message={message} /> : null;
}

function RouterBlocker({ message }: { message: string }) {
	useBlocker({
		// Block unless the visitor says to leave anyway.
		shouldBlockFn: () => !window.confirm(message),
		// The form's own listener already asks on unload.
		enableBeforeUnload: false,
	});
	return null;
}
