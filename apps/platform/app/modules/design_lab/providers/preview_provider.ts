import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
	type DesignProvider,
	DesignProviderError,
	type PollResult,
	type SubmitRequest,
	type Submitted,
} from "#modules/design_lab/providers/types";
import { PREVIEW_MODEL } from "#modules/design_lab/settings";

/**
 * The local preview provider (DESIGN_LAB_PROVIDER=preview, development's
 * default; production refuses it). It never touches the network: it draws a
 * labelled placeholder so the whole flow (queue, worker, storage, page) can
 * be tried without spending provider credits. Like a real provider it is
 * asynchronous, and its state travels in its own `preview:` URLs, so the web
 * process and the worker need share nothing.
 *
 * To try the other outcomes locally, put `test:moderate` or `test:error` in
 * the concept text.
 */
export const PREVIEW_DELAY_MS = 2_000;

export default class PreviewProvider implements DesignProvider {
	readonly name = "preview";
	readonly model = PREVIEW_MODEL;

	async submit(request: SubmitRequest): Promise<Submitted> {
		const id = `preview-${randomUUID()}`;
		const outcome = request.prompt.includes("test:moderate")
			? "moderate"
			: request.prompt.includes("test:error")
				? "error"
				: "ready";
		const url = new URL(`preview://local/${id}`);
		url.searchParams.set("w", String(request.width));
		url.searchParams.set("h", String(request.height));
		url.searchParams.set("at", String(Date.now()));
		url.searchParams.set("outcome", outcome);
		return { requestId: id, pollingUrl: url.href, cost: 0 };
	}

	async poll(pollingUrl: string): Promise<PollResult> {
		const url = previewUrl(pollingUrl);
		if (Date.now() - Number(url.searchParams.get("at")) < PREVIEW_DELAY_MS) {
			return { state: "pending", providerStatus: "Pending" };
		}
		const outcome = url.searchParams.get("outcome");
		if (outcome === "moderate") {
			return { state: "moderated", code: "request_moderated" };
		}
		if (outcome === "error") return { state: "error", providerStatus: "Error" };
		const sample = new URLSearchParams({
			w: url.searchParams.get("w") ?? "1024",
			h: url.searchParams.get("h") ?? "1024",
		});
		return {
			state: "ready",
			sampleUrl: `preview://local${url.pathname}.png?${sample}`,
			seed: 0,
		};
	}

	async download(sampleUrl: string): Promise<Buffer> {
		const url = previewUrl(sampleUrl);
		const width = clamp(Number(url.searchParams.get("w")));
		const height = clamp(Number(url.searchParams.get("h")));
		return placeholder(width, height);
	}
}

function previewUrl(raw: string): URL {
	const url = new URL(raw);
	if (url.protocol !== "preview:") {
		throw new DesignProviderError("invalid_response", "Not a preview URL.");
	}
	return url;
}

const clamp = (value: number) =>
	Number.isFinite(value)
		? Math.min(1440, Math.max(256, Math.round(value)))
		: 1024;

/** A line-art placeholder labelled as one, so nobody mistakes it for a design. */
export function placeholder(width: number, height: number): Promise<Buffer> {
	const r = Math.min(width, height) * 0.28;
	const cx = width / 2;
	const cy = height / 2 - r * 0.15;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#ffffff"/>
<g fill="none" stroke="#111111" stroke-width="6" stroke-linecap="round">
<circle cx="${cx}" cy="${cy}" r="${r}"/>
<circle cx="${cx}" cy="${cy}" r="${r * 0.62}"/>
<path d="M ${cx - r} ${cy} Q ${cx} ${cy - r * 1.4} ${cx + r} ${cy}"/>
<path d="M ${cx - r} ${cy} Q ${cx} ${cy + r * 1.4} ${cx + r} ${cy}"/>
<path d="M ${cx} ${cy - r} L ${cx} ${cy + r}"/>
</g>
<text x="50%" y="${cy + r + 70}" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#444444">Local preview placeholder</text>
<text x="50%" y="${cy + r + 115}" font-family="sans-serif" font-size="24" text-anchor="middle" fill="#777777">No image service was called</text>
</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}
