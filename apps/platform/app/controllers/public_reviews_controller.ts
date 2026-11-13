import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import app from "@adonisjs/core/services/app";
import { urlFor } from "@adonisjs/core/services/url_builder";
import { publicTenantContext } from "#middleware/public_tenant_middleware";
import { ImageDeleteError, InvalidImageError } from "#modules/media/errors";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import VideoService from "#modules/media/services/video_service";
import { storefrontTemplate } from "#modules/payments/deposit_links";
import {
	clientVideoUploadToken,
	readClientVideoUploadToken,
} from "#modules/reviews/client_video_uploads";
import {
	ClientVideoUploadError,
	PostFullError,
	PostNeedsPhotoError,
	ReviewInputError,
	ReviewLockedError,
	ReviewPageNotFoundError,
} from "#modules/reviews/errors";
import type { ReviewContext } from "#modules/reviews/review_context";
import { REVIEW_TOKEN_HEADER } from "#modules/reviews/review_links";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientPostService, {
	OrderMismatchError,
	PostMediaNotFoundError,
} from "#modules/reviews/services/client_post_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ReviewPageService from "#modules/reviews/services/review_page_service";
import {
	addPostPhotoValidator,
	addPostVideoValidator,
	REVIEW_MESSAGES,
	signPostVideoValidator,
	submitReviewPageValidator,
} from "#modules/reviews/validators/review_page";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BotChallenge, {
	CHALLENGE_ACTIONS,
	CHALLENGE_TOKEN_HEADER,
} from "#services/bot_challenge";
import { ApiException } from "#services/public_api_errors";
import { studioHostname } from "#services/storefront_url";
import { discardUploads, receiveUploads } from "#services/uploads";
import PublicReviewPageTransformer from "#transformers/public_review_page_transformer";

/**
 * The client's review page (Reviews and Fresh ink, slice 1; the `Reviews`
 * operations of openapi.yaml): a review and a Fresh ink post through a
 * project's review link. The link's token arrives in the X-Review-Token
 * header (the reviewGuard middleware has checked the flag, its shape and the
 * rate limits); every link that doesn't work is the same 404, before
 * anything else is looked at, and an upload's body is read only after
 * that. Every answer is the page as it now is, never cached.
 */
@inject()
export default class PublicReviewsController {
	constructor(
		private pages: ReviewPageService,
		private posts: ClientPostService,
		private videos: VideoService,
		private challenge: BotChallenge,
	) {}

	async show(ctx: HttpContext) {
		return this.run(async () =>
			ctx.serialize(await this.page(await this.open(ctx))),
		);
	}

	/** The submit: the bot challenge (action `review`), then every field checked again. */
	async update(ctx: HttpContext) {
		return this.run(async () => {
			const review = await this.open(ctx);
			const outcome = await this.challenge.verify(
				ctx.request.header(CHALLENGE_TOKEN_HEADER),
				{
					hostname: studioHostname(storefrontTemplate(), review.tenant.slug),
					action: CHALLENGE_ACTIONS.review,
				},
			);
			if (outcome === "failed") throw ApiException.of("challenge_failed");
			if (outcome === "unavailable") {
				throw ApiException.of("challenge_unavailable");
			}
			const input = await ctx.request.validateUsing(submitReviewPageValidator);
			await this.pages.submit(review, input);
			return ctx.serialize(await this.page(review));
		});
	}

	async destroyReview(ctx: HttpContext) {
		return this.run(async () => {
			const review = await this.open(ctx);
			await this.pages.deleteReview(review);
			return ctx.serialize(await this.page(review));
		});
	}

	async destroyPost(ctx: HttpContext) {
		return this.run(async () => {
			const review = await this.open(ctx);
			await this.pages.deletePost(review);
			return ctx.serialize(await this.page(review));
		});
	}

	/** One photo, as multipart: the body is read only once the link works. */
	async storePhoto(ctx: HttpContext) {
		const { request, response } = ctx;
		try {
			return await this.run(async () => {
				const review = await this.open(ctx);
				if (request.bodyType !== "multipart") {
					throw ApiException.of("unsupported_media_type");
				}
				await receiveUploads(request);
				const { photo } = await request.validateUsing(addPostPhotoValidator, {
					// Only the first `photo` part is read; discardUploads drops the rest.
					data: { photo: request.file("photo") ?? undefined },
				});
				await this.posts.addPhoto(
					review,
					photo,
					await this.pages.sharedFor(review),
				);
				response.status(201);
				return ctx.serialize(await this.page(review));
			});
		} finally {
			await discardUploads(request);
		}
	}

	/**
	 * Where to PUT a video: on R2 a presigned URL bound to the type and the
	 * exact length; on the local disk (development and tests) this API's own
	 * staging route, as a path. With the token naming what was signed.
	 */
	async signVideo(ctx: HttpContext) {
		return this.run(async () => {
			const review = await this.open(ctx);
			const { type, size } = await ctx.request.validateUsing(
				signPostVideoValidator,
			);
			const { post, key, upload } = await this.posts.signVideo(review, {
				type,
				size,
			});
			const token = clientVideoUploadToken({
				tenantId: review.tenant.id,
				postId: post.id,
				key,
				type,
				size,
			});
			return {
				data: {
					upload: upload
						? { method: "PUT", url: upload.url, headers: upload.headers }
						: {
								method: "PUT",
								url: urlFor(
									"api.v1.review.videos.stage",
									{ tenant: review.tenant.slug },
									{ qs: { upload: token } },
								),
								headers: { "Content-Type": type },
							},
					token,
				},
			};
		});
	}

	/**
	 * The local disk's stand-in for R2's presigned PUT, in development and
	 * tests only (the route is not registered in production, and this
	 * refuses to run there anyway). Like a presigned URL it is authorised by
	 * the upload token alone (this studio's, a live post's, an hour), never
	 * by the review token; the type and exact length must be what was signed,
	 * the body is cut off past it, and a key takes one upload. 204 when stored.
	 */
	async stageVideo(ctx: HttpContext) {
		if (app.inProduction || !this.videos.stagesLocally()) {
			throw ApiException.notFound();
		}
		const { tenant } = publicTenantContext(ctx);
		const upload = readClientVideoUploadToken(ctx.request.qs().upload, {
			tenantId: tenant.id,
		});
		if (!upload || !(await this.posts.findById(tenant, upload.postId))) {
			throw ApiException.notFound();
		}
		const length = Number(ctx.request.header("content-length"));
		const type = ctx.request.header("content-type")?.split(";")[0].trim();
		if (type !== upload.type || length !== upload.size) {
			throw ApiException.of("validation_failed", {
				upload: ["The upload is not the file that was signed."],
			});
		}
		let stored: boolean;
		try {
			stored = await this.videos.writeStaged(
				tenant,
				upload.key,
				ctx.request.request,
				upload.size,
			);
		} catch {
			throw ApiException.of("bad_request");
		}
		if (!stored) {
			throw ApiException.of("validation_failed", {
				upload: ["This video was uploaded already."],
			});
		}
		return ctx.response.noContent();
	}

	/** The uploaded video joins the post, processing. */
	async storeVideo(ctx: HttpContext) {
		return this.run(async () => {
			const review = await this.open(ctx);
			const data = await ctx.request.validateUsing(addPostVideoValidator);
			const post = await this.posts.find(review.tenant, review.project.id);
			const upload = post
				? readClientVideoUploadToken(data.upload, {
						tenantId: review.tenant.id,
						postId: post.id,
					})
				: null;
			if (!upload) throw new ClientVideoUploadError();
			await this.posts.addVideo(review, upload);
			ctx.response.status(201);
			return ctx.serialize(await this.page(review));
		});
	}

	async destroyMedia(ctx: HttpContext) {
		return this.run(async () => {
			const review = await this.open(ctx);
			await this.posts.removeMedia(review, ctx.params.media);
			return ctx.serialize(await this.page(review));
		});
	}

	/** The link of the request's X-Review-Token (the guard checked its shape). */
	private open(ctx: HttpContext): Promise<ReviewContext> {
		const { tenant } = publicTenantContext(ctx);
		return this.pages.open(
			tenant,
			ctx.request.header(REVIEW_TOKEN_HEADER) ?? "",
		);
	}

	private async page(review: ReviewContext) {
		return PublicReviewPageTransformer.transform(await this.pages.show(review));
	}

	/** Runs a handler and answers its refusals as the API does. */
	private async run<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			throw toApiError(error);
		}
	}
}

/** The review page's refusals as the API answers them; any other error as it is. */
function toApiError(error: unknown) {
	if (
		error instanceof ReviewPageNotFoundError ||
		error instanceof PostMediaNotFoundError
	) {
		return ApiException.notFound();
	}
	if (error instanceof ReviewLockedError)
		return ApiException.of("review_locked");
	if (error instanceof PostFullError) return ApiException.of("post_full");
	if (error instanceof PostNeedsPhotoError) {
		return ApiException.of("post_needs_photo");
	}
	if (error instanceof ImageDeleteError)
		return ApiException.of("remove_failed");
	if (error instanceof ReviewInputError) {
		return ApiException.of("validation_failed", {
			[error.field]: [error.message],
		});
	}
	if (error instanceof OrderMismatchError) {
		return ApiException.of("validation_failed", {
			"post.order": [REVIEW_MESSAGES.order],
		});
	}
	if (error instanceof ClientVideoUploadError) {
		return ApiException.of("validation_failed", { upload: [error.message] });
	}
	if (error instanceof InvalidImageError) {
		return ApiException.of("validation_failed", { photo: [error.message] });
	}
	return error;
}
