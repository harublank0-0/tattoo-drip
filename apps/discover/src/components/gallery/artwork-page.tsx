import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import type { DiscoverTattooDetail } from "@tattoo-drip/sdk";
import {
	ArrowLeftIcon,
	CheckIcon,
	ExpandIcon,
	LinkIcon,
	Share2Icon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useMounted } from "#/components/directory/pagination";
import { ResponsiveImage } from "#/components/discovery/responsive-image";
import { Button } from "#/components/ui/button";
import { cameFromGallery } from "#/lib/artwork";
import { tattooAlt } from "#/lib/home";
import { paths } from "#/lib/routes";

/*
 * The artwork page's pieces (D09): the large image, "View full size",
 * Share / Copy link and "Back to the gallery".
 */

/**
 * The artwork, large and first: loaded at once with high priority, in a
 * frame of its own proportions that never grows taller than most of the
 * screen (a tall piece narrows instead), so nothing moves as it loads.
 */
export function ArtworkImage({ tattoo }: { tattoo: DiscoverTattooDetail }) {
	const { width, height } = tattoo.image;
	const ratio = width > 0 && height > 0 ? width / height : 4 / 5;
	return (
		<div
			className="mx-auto"
			style={{ width: `min(100%, calc(80svh * ${ratio.toFixed(4)}))` }}
		>
			<ResponsiveImage
				image={tattoo.image}
				alt={tattooAlt(tattoo)}
				ratio={`${width || 4} / ${height || 5}`}
				sizes="(min-width: 64rem) 58vw, 100vw"
				priority
				large
				fit="contain"
			/>
		</div>
	);
}

/** "View full size": the API's largest copy (its `url`), only an http(s) one. */
export function FullSizeLink({ tattoo }: { tattoo: DiscoverTattooDetail }) {
	const url = safeImageUrl(tattoo.image.url);
	if (!url) return null;
	return (
		<a
			href={url}
			className="inline-flex min-h-11 items-center gap-2 text-sm font-medium underline-offset-4 hover:underline"
		>
			<ExpandIcon className="size-4" aria-hidden="true" />
			View full size
			<span className="sr-only">(opens the image file)</span>
		</a>
	);
}

function safeImageUrl(value: string): string | null {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.toString()
			: null;
	} catch {
		return null;
	}
}

/**
 * Share: the device's share sheet when the browser has one, else Copy link
 * (the Clipboard API), with a visible confirmation that screen readers
 * announce (a polite live region). The address shared is the canonical
 * one. A real button (keyboard, Enter or Space); without JavaScript it is
 * hidden and the address bar is the way to share.
 */
export function ShareActions({ url, title }: { url: string; title: string }) {
	const mounted = useMounted();
	const native =
		mounted &&
		typeof navigator !== "undefined" &&
		typeof navigator.share === "function";
	const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(
		null,
	);
	const clear = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const say = (next: { ok: boolean; text: string }) => {
		clearTimeout(clear.current);
		// Emptied first, so the same words are announced again on a second copy.
		setStatus(null);
		setTimeout(() => setStatus(next), 50);
		clear.current = setTimeout(() => setStatus(null), 6000);
	};
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(url);
			say({ ok: true, text: "Link copied" });
		} catch {
			say({
				ok: false,
				text: "Couldn't copy the link. Copy it from the address bar.",
			});
		}
	};
	return (
		<div className="flex flex-wrap items-center gap-3">
			{native && (
				<Button
					type="button"
					variant="outline"
					onClick={() => {
						navigator.share({ title, url }).catch(() => {
							// Cancelled or refused: nothing to say.
						});
					}}
				>
					<Share2Icon aria-hidden="true" />
					Share
				</Button>
			)}
			<Button
				type="button"
				variant={native ? "ghost" : "outline"}
				onClick={copy}
				className="noscript:hidden"
			>
				<LinkIcon aria-hidden="true" />
				Copy link
			</Button>
			<output aria-live="polite" className="text-sm font-medium">
				{status && (
					<span className="inline-flex items-center gap-1.5">
						{status.ok && <CheckIcon className="size-4" aria-hidden="true" />}
						{status.text}
					</span>
				)}
			</output>
		</div>
	);
}

/**
 * Back to the gallery: when this page was opened from the gallery (its
 * card left a mark in this history entry, never in the address), going
 * back returns to that gallery as it was (its search, filters, page and
 * scroll); otherwise a plain link to the gallery.
 */
export function BackToGallery() {
	const mounted = useMounted();
	const router = useRouter();
	const state = useRouterState({ select: (each) => each.location.state });
	const back = mounted && cameFromGallery(state);
	return (
		<Link
			to={paths.tattoos()}
			onClick={(event) => {
				if (!back) return;
				event.preventDefault();
				router.history.back();
			}}
			className="inline-flex min-h-11 items-center gap-2 font-medium underline-offset-4 hover:underline"
		>
			<ArrowLeftIcon className="size-4" aria-hidden="true" />
			Back to the gallery
		</Link>
	);
}
