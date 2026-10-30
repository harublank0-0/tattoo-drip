/**
 * The artist already shows the most flash designs there are room for
 * (TAT-129). The message is for developers; the dashboard words its own.
 */
export class FlashLimitError extends Error {
	constructor() {
		super("The artist already has the most flash designs allowed");
		this.name = "FlashLimitError";
	}
}

/**
 * An inquiry or a project names this design, so it can't be deleted: the
 * studio hides it instead. The message is for developers; the dashboard
 * words its own.
 */
export class FlashInUseError extends Error {
	constructor() {
		super("A request or a project names this flash design");
		this.name = "FlashInUseError";
	}
}
