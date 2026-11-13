import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import app from "@adonisjs/core/services/app";
import { urlFor } from "@adonisjs/core/services/url_builder";
import { errors as lucidErrors } from "@adonisjs/lucid";
import { errors } from "@vinejs/vine";
import { tenantContext } from "#middleware/tenant_middleware";
import {
	TattooChangedError,
	TattooPhotoLimitError,
	VideoUploadError,
	WorkPhotoLimitError,
} from "#modules/artists/errors";
import type Artist from "#modules/artists/models/artist";
import ArtistWorkPhoto from "#modules/artists/models/artist_work_photo";
import { portfolioBack } from "#modules/artists/portfolio";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WorkPhotoService, {
	MAX_TATTOO_PHOTOS,
	MAX_WORK_PHOTOS,
} from "#modules/artists/services/work_photo_service";
import {
	addWorkVideoValidator,
	signWorkVideoValidator,
} from "#modules/artists/validators/work_photo";
import {
	readVideoUploadToken,
	videoUploadToken,
} from "#modules/artists/video_uploads";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import VideoService from "#modules/media/services/video_service";

/**
 * Video angles: a short video added to a tattoo from the portfolio's "Add
 * photos or videos to this tattoo". The file never passes through the app's
 * request body (its limit is 20 MB, and Cloudflare's tunnel cuts a request
 * at 100 MB): three steps, every one authorised like adding a photo (the
 * tenant from the URL, `:id` the tattoo's lead loaded through findEditable,
 * so another studio's or another artist's is a 404, then the artist's lock
 * and the room).
 *
 * 1. `sign`: the browser says the file's type and exact length; the answer
 *    is where to PUT it (on R2 a presigned URL to a private staging key,
 *    whose signature binds the type and the length) and a token naming what
 *    was signed (#modules/artists/video_uploads).
 * 2. The browser PUTs the file there, with upload progress. On the local
 *    disk (development and tests) that is `stage`, this app's own PUT, which
 *    exists only outside production.
 * 3. `store`: the browser sends the token back; the row is created
 *    `processing` and the worker's job queued (WorkPhotoService.addVideo),
 *    and the answer goes back to the portfolio as it was (`back`).
 */
@inject()
export default class WorkVideosController {
	constructor(
		private photos: WorkPhotoService,
		private videos: VideoService,
	) {}

	/** `:id` is the tattoo's lead. Answers `{ upload: { method, url, headers }, token }`, or 422 with the reason. */
	async sign(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { photo: lead, artist } = await this.leadOf(ctx);
		const { type, size } = await ctx.request.validateUsing(
			signWorkVideoValidator,
		);
		await asFieldErrors(() =>
			this.photos.checkVideoRoom(tenant, membership, artist, lead),
		);
		const key = this.videos.stagingKey(tenant);
		const token = videoUploadToken({
			tenantId: tenant.id,
			leadId: lead.id,
			key,
			type,
			size,
		});
		const signed = await this.videos.signUpload(tenant, key, { type, size });
		return ctx.response.header("Cache-Control", "no-store").json({
			upload: signed
				? { method: "PUT", ...signed }
				: {
						method: "PUT",
						url: urlFor(
							"tenant.artists.photos.videos.stage",
							{ tenant: tenant.slug, id: lead.id },
							{ qs: { upload: token } },
						),
						headers: { "Content-Type": type },
					},
			token,
		});
	}

	/**
	 * `:id` is the tattoo's lead. The local disk's stand-in for R2's presigned
	 * PUT, in development and tests only: the route is not registered in
	 * production, and this refuses to run there anyway. The same checks as the
	 * signature on R2 and more: the member and the tattoo (the route's
	 * middleware and the token), the declared type and exact length (the
	 * Content-Type and Content-Length headers must be what was signed, and
	 * the body is cut off past it), and once only (the file is created
	 * exclusively). 204 when stored.
	 */
	async stage(ctx: HttpContext) {
		if (app.inProduction || !this.videos.stagesLocally()) {
			return ctx.response.notFound();
		}
		const { tenant } = tenantContext(ctx);
		const { photo: lead } = await this.leadOf(ctx);
		const upload = readVideoUploadToken(ctx.request.qs().upload, {
			tenantId: tenant.id,
			leadId: lead.id,
		});
		const length = Number(ctx.request.header("content-length"));
		const type = ctx.request.header("content-type")?.split(";")[0].trim();
		if (!upload) return ctx.response.forbidden({ message: "Upload expired" });
		if (type !== upload.type || length !== upload.size) {
			return ctx.response.forbidden({
				message: "The upload is not the file that was signed",
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
			return ctx.response.badRequest({ message: "The upload was cut short" });
		}
		if (!stored) {
			return ctx.response.conflict({ message: "Already uploaded" });
		}
		return ctx.response.noContent();
	}

	/**
	 * `:id` is the tattoo's lead. Adds the uploaded video to the tattoo as its
	 * last angle, `processing`, and goes back to the portfolio as it was
	 * (`back`). A token that is not this studio's, tattoo's and member's, an
	 * upload that never arrived or was used already, and no room left are
	 * the `video` field's error.
	 */
	async store(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const { photo: lead, artist } = await this.leadOf(ctx);
		const data = await ctx.request.validateUsing(addWorkVideoValidator);
		const upload = readVideoUploadToken(data.upload, {
			tenantId: tenant.id,
			leadId: lead.id,
		});
		if (!upload) throw fieldError(new VideoUploadError().message);
		await asFieldErrors(() =>
			this.photos.addVideo(
				tenant,
				membership,
				artist,
				lead,
				upload,
				data.alt ?? null,
			),
		);
		const back = portfolioBack(ctx.request.input("back"), tenant.slug);
		return ctx.response
			.redirect()
			.withQs(false)
			.toPath(back ?? `/t/${tenant.slug}/portfolio`);
	}

	/** The tattoo's lead from `:id`, the editor's to change; an angle (a lead no more) is the same 404 as an unknown id. */
	private async leadOf(
		ctx: HttpContext,
	): Promise<{ photo: ArtistWorkPhoto; artist: Artist }> {
		const { tenant, membership } = tenantContext(ctx);
		const found = await this.photos.findEditable(
			tenant,
			membership,
			ctx.params.id,
		);
		if (found.photo.leadPhotoId !== null) {
			throw new lucidErrors.E_ROW_NOT_FOUND(ArtistWorkPhoto);
		}
		return found;
	}
}

function fieldError(message: string) {
	return new errors.E_VALIDATION_ERROR([
		{ field: "video", message, rule: "video" },
	]);
}

/** The limits, a tattoo that changed and an unusable upload as the `video` field's error. */
async function asFieldErrors<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (error) {
		if (error instanceof WorkPhotoLimitError) {
			throw fieldError(
				`This artist already has ${MAX_WORK_PHOTOS} photos and videos. Remove one to add another.`,
			);
		}
		if (error instanceof TattooPhotoLimitError) {
			throw fieldError(
				`This tattoo already has ${MAX_TATTOO_PHOTOS} photos and videos. Remove one to add another.`,
			);
		}
		if (error instanceof TattooChangedError) {
			throw fieldError(
				"This tattoo changed meanwhile. Here it is as it is now: try again.",
			);
		}
		if (error instanceof VideoUploadError) throw fieldError(error.message);
		throw error;
	}
}
