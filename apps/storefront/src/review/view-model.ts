import type {
	ClientPost,
	ReviewMedia,
	ReviewPage,
	SubmitReviewInput,
} from "@tattoo-drip/sdk";
import { copy } from "./copy.ts";

/*
 * The review page's rules as plain functions (Reviews and Fresh ink): what
 * the form starts with, what it checks before sending (the API checks it all
 * again), what it sends, and how the page names each state. No DOM, no
 * React: test/review/ runs them in Node.
 */

export const MIN_REVIEW = 20;
export const MAX_REVIEW = 2000;
export const MAX_NAME = 40;
export const MAX_CAPTION = 280;
export const MAX_PLACEMENT = 120;
export const MAX_STYLES = 3;
export const MAX_MEDIA = 8;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** The API takes up to 60.5 s (and cuts at 60): the page refuses only what it would refuse. */
export const MAX_VIDEO_SECONDS = 60.5;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

/** The form's fields, by the id of their control (errors link to them with aria-describedby). */
export const FIELD_IDS = {
	rating: "review-rating-1",
	body: "review-body",
	caption: "review-caption",
	placement: "review-placement",
	styles: "review-styles",
	shownName: "review-name",
	media: "review-add-photos",
	form: "review-form",
} as const;
export type Field = keyof typeof FIELD_IDS;

export interface FormValues {
	/** 0 until the client picks a star. */
	readonly rating: number;
	readonly body: string;
	readonly caption: string;
	readonly styles: readonly string[];
	readonly placement: string;
	readonly shownName: string;
	readonly consentStudioPage: boolean;
	readonly consentDiscover: boolean;
}

/** Bidi controls and zero-width characters: a shown name may hold none (the API's rule). */
const INVISIBLE = /[\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/u;

/**
 * Whether the Discover box shows: while the studio is on Discover, and,
 * while it isn't, only if the client ticked it before, so they can untick
 * it (a consent is always withdrawable; it can't be ticked anew then).
 */
export function discoverShown(page: ReviewPage): boolean {
	return (
		page.studio.onDiscover ||
		(page.review ?? page.post)?.consentDiscover === true
	);
}

/** Characters as the API counts them (code points), so any script counts as people see it. */
export function charCount(text: string): number {
	let count = 0;
	for (const _ of text) count++;
	return count;
}

/**
 * What the form starts with: what was saved, else the page's defaults. The
 * shown name is the saved one or the API's default (the first name and the
 * initial of the last, ruling 9). Both consents start unticked (ruling 8)
 * unless the client ticked them before.
 */
export function initialValues(page: ReviewPage): FormValues {
	const review = page.review;
	const post = page.post;
	const saved = review ?? post;
	return {
		rating: review?.rating ?? 0,
		body: review?.body ?? "",
		caption: post?.caption ?? "",
		styles:
			post && post.status !== "draft" ? post.styles : [...page.defaults.styles],
		placement: post?.placement ?? page.defaults.placement ?? "",
		shownName: saved?.shownName ?? page.defaults.shownName,
		consentStudioPage: saved?.consentStudioPage ?? false,
		consentDiscover: saved?.consentDiscover ?? false,
	};
}

/** Whether the client has sent something: the page then thanks them and offers edit and delete. */
export function hasSaved(page: ReviewPage): boolean {
	return (
		page.review !== null || (page.post !== null && page.post.status !== "draft")
	);
}

/** Whether the review's rating and text may change: until TattooDrip takes it down. */
export function reviewEditable(page: ReviewPage): boolean {
	return page.review === null || page.review.takenDown === null;
}

/** Whether the post's photos, caption, styles and placement may change. */
export function postEditable(page: ReviewPage): boolean {
	return page.post === null || page.post.editable;
}

export type Problem = { readonly field: Field; readonly message: string };

/**
 * The form's own checks, in the page's order, so the summary lists them as
 * the client meets them. A review is sent when it has a rating or words;
 * then both must be right.
 */
export function validate(values: FormValues, page: ReviewPage): Problem[] {
	const problems: Problem[] = [];
	const body = values.body.trim();
	const writing = reviewEditable(page) && (values.rating > 0 || body !== "");
	if (writing) {
		if (!(values.rating >= 1 && values.rating <= 5)) {
			problems.push({ field: "rating", message: copy.errors.rating });
		}
		const length = charCount(body);
		if (length < MIN_REVIEW) {
			problems.push({
				field: "body",
				message:
					length === 0 ? copy.errors.ratingWithoutBody : copy.errors.bodyShort,
			});
		} else if (length > MAX_REVIEW) {
			problems.push({ field: "body", message: copy.errors.bodyLong });
		}
	}
	const media = page.post?.media.length ?? 0;
	if (postEditable(page) && media > 0) {
		if (charCount(values.caption.trim()) > MAX_CAPTION) {
			problems.push({ field: "caption", message: copy.errors.caption });
		}
		if (charCount(values.placement.trim()) > MAX_PLACEMENT) {
			problems.push({ field: "placement", message: copy.errors.placement });
		}
		if (values.styles.length > MAX_STYLES) {
			problems.push({ field: "styles", message: copy.stylesFull });
		}
	}
	const name = charCount(values.shownName.trim());
	if (
		name < 1 ||
		name > MAX_NAME ||
		/[\p{Cc}\u2028\u2029]/u.test(values.shownName) ||
		INVISIBLE.test(values.shownName)
	) {
		problems.push({ field: "shownName", message: copy.errors.shownName });
	}
	if (
		!writing &&
		page.review === null &&
		media === 0 &&
		page.post?.status !== "waiting"
	) {
		problems.push({ field: "body", message: copy.errors.nothing });
	}
	return problems;
}

/**
 * What the submit sends: the shared name and consents, the review when the
 * client wrote one (and may still change it), the post when it has photos
 * (and may still change). The challenge token is added by the form.
 */
export function submissionOf(
	values: FormValues,
	page: ReviewPage,
): Omit<SubmitReviewInput, "challengeToken"> {
	const body = values.body.trim();
	const input: Omit<SubmitReviewInput, "challengeToken"> = {
		shownName: values.shownName.trim(),
		consentStudioPage: values.consentStudioPage,
		// Never ticked where the box isn't shown; while the studio is off
		// Discover the API keeps it only if it stays ticked.
		consentDiscover: discoverShown(page) ? values.consentDiscover : false,
	};
	if (reviewEditable(page) && (values.rating > 0 || body !== "")) {
		input.review = { rating: values.rating, body };
	}
	if (page.post?.editable && page.post.media.length > 0) {
		const caption = values.caption.trim();
		const placement = values.placement.trim();
		input.post = {
			caption: caption === "" ? null : caption,
			styles: [...values.styles],
			placement: placement === "" ? null : placement,
		};
	}
	return input;
}

/** The post's state in words for the client (ruling 7: a declined post is only "not shown by the studio"). */
export function postStatusTemplate(post: ClientPost): string {
	switch (post.status) {
		case "draft":
			return copy.postDraft;
		case "waiting":
			return copy.postWaiting;
		case "approved":
			return copy.postApproved;
		default:
			return copy.postNotShown;
	}
}

/** "1 Oct 2026" for an ISO day, read as a calendar day (no timezone shift). */
export function formatDay(isoDay: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay);
	if (!match) return isoDay;
	const date = new Date(
		Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
	);
	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}

/** One item of the post as the tray shows it. */
export interface MediaView {
	readonly id: string;
	readonly kind: "photo" | "video";
	readonly state: ReviewMedia["state"];
	readonly failure: string | null;
	/** The photo or the poster, only from the page's media origin. */
	readonly image: {
		src: string;
		srcSet: string | undefined;
		width: number;
		height: number;
	} | null;
	/** A ready video's sources, smallest first, from the media origin. */
	readonly sources: readonly { src: string; type: string }[];
	/** "photo 2", "video 1": the item's name in a Remove button's label. */
	readonly label: string;
}

/**
 * The tray's items. A client's media are private until published, so the
 * API signs their URLs for 5 minutes: on its own origin in development (the
 * signed `/files` route), on R2's storage host in production. A URL is kept
 * only on those origins (and MEDIA_URL's), so the page never loads a
 * picture from anywhere else.
 */
export function mediaViews(
	media: readonly ReviewMedia[],
	origins: readonly string[],
): MediaView[] {
	const allowed = new Set(
		origins.flatMap((origin) => {
			try {
				return [new URL(origin).origin];
			} catch {
				return [];
			}
		}),
	);
	const onOrigin = (url: string) => {
		try {
			const parsed = new URL(url);
			const ok =
				allowed.has(parsed.origin) ||
				(parsed.protocol === "https:" &&
					parsed.hostname.endsWith(".r2.cloudflarestorage.com"));
			return ok && /^https?:$/.test(parsed.protocol) ? parsed.href : null;
		} catch {
			return null;
		}
	};
	let photos = 0;
	let videos = 0;
	return media.map((item) => {
		const label =
			item.kind === "photo"
				? copy.photoItem.replace("{n}", String(++photos))
				: copy.videoItem.replace("{n}", String(++videos));
		const src = item.image ? onOrigin(item.image.url) : null;
		const srcSet = item.image
			? item.image.variants
					.map((variant) => {
						const url = onOrigin(variant.url);
						return url ? `${url} ${variant.width}w` : null;
					})
					.filter((part): part is string => part !== null)
			: [];
		return {
			id: item.id,
			kind: item.kind,
			state: item.state,
			failure: item.failure,
			image:
				item.image && src
					? {
							src,
							srcSet:
								srcSet.length > 0
									? [...srcSet, `${src} ${item.image.width}w`].join(", ")
									: undefined,
							width: item.image.width,
							height: item.image.height,
						}
					: null,
			sources: item.sources.flatMap((source) => {
				const url = onOrigin(source.url);
				return url ? [{ src: url, type: source.type }] : [];
			}),
			label,
		};
	});
}

/**
 * The order that makes `id` the main photo: it first, the rest as they are.
 * Only a photo can be (the API refuses a video, ruling 5).
 */
export function orderWithLead(
	media: readonly ReviewMedia[],
	id: string,
): string[] | null {
	const lead = media.find((item) => item.id === id);
	if (!lead || lead.kind !== "photo") return null;
	return [id, ...media.filter((item) => item.id !== id).map((item) => item.id)];
}

/** Why a picked video can't go, before anything is uploaded; null when it can. */
export function videoProblem(file: {
	readonly type: string;
	readonly size: number;
}): string | null {
	if (!VIDEO_TYPES.includes(file.type)) return copy.errors.videoType;
	if (file.size < 1 || file.size > MAX_VIDEO_BYTES)
		return copy.errors.videoSize;
	return null;
}

/** An upload URL from the sign answer, resolved against the API's origin (it is a path in development). */
export function uploadUrl(url: string, apiUrl: string): string {
	return new URL(url, apiUrl).href;
}

/**
 * What the screen reader hears about a count, only when it crosses a
 * threshold (finding 21): 20 characters left, and the limit. Null otherwise,
 * so typing isn't read out on every key.
 */
export function countAnnouncement(
	before: number,
	after: number,
	max: number,
): string | null {
	if (after >= max && before < max) {
		return copy.countAtLimit.replace("{max}", max.toLocaleString("en"));
	}
	if (max - after <= 20 && max - before > 20) return copy.countNearLimit;
	return null;
}

/** "Too many tries. Try again in 12 minutes." for a 429's Retry-After (an hour's limit included). */
export function waitText(seconds: number): string {
	const minutes = Math.ceil(seconds / 60);
	return minutes <= 1
		? copy.waitMinute
		: copy.waitMinutes.replace("{minutes}", String(minutes));
}

/** The problems that still hold once `values` changed: the changed field loses its error once it is right. */
export function problemsStillHolding(
	problems: readonly Problem[],
	values: FormValues,
	page: ReviewPage,
	changed: Field,
): Problem[] {
	const now = validate(values, page);
	return problems.filter(
		(problem) =>
			problem.field !== changed ||
			now.some((current) => current.field === changed),
	);
}

/** "photo 3" for the item `id` in the post's order, else null. */
export function itemLabel(
	media: readonly ReviewMedia[],
	id: string,
): string | null {
	let photos = 0;
	let videos = 0;
	for (const item of media) {
		const label =
			item.kind === "photo"
				? copy.photoItem.replace("{n}", String(++photos))
				: copy.videoItem.replace("{n}", String(++videos));
		if (item.id === id) return label;
	}
	return null;
}
