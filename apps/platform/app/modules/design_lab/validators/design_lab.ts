import vine from "@vinejs/vine";
import {
	BODY_AREA_KEYS,
	DETAIL_KEYS,
	LIMITS,
	ORIENTATION_KEYS,
	PALETTE_KEYS,
	STYLE_KEYS,
} from "#modules/design_lab/prompt";
import { VARIATIONS_CAP } from "#services/design_lab_settings";

/**
 * AI Design Lab's forms (docs/design-lab.md). Shapes and lengths only: the
 * service trims, refuses contact details in free text and checks the
 * studio's limits. No tenant, cost, model or quota is ever read from a form.
 */

export const createDesignProjectValidator = vine.create({
	title: vine.string().trim().maxLength(120).optional(),
	tattooProjectId: vine.string().uuid().optional(),
});

export const updateDesignProjectValidator = vine.create({
	title: vine.string().trim().minLength(1).maxLength(120),
	notes: vine.string().trim().maxLength(2000).optional(),
	tattooProjectId: vine.string().uuid().optional(),
	archived: vine.boolean().optional(),
});

export const generationValidator = vine.create({
	requestId: vine.string().uuid(),
	variations: vine.number().withoutDecimals().range([1, VARIATIONS_CAP]),
	acknowledged: vine.boolean().optional(),
	concept: vine
		.string()
		.trim()
		.minLength(LIMITS.concept.min)
		.maxLength(LIMITS.concept.max),
	style: vine.enum(STYLE_KEYS),
	customStyle: vine
		.string()
		.trim()
		.maxLength(LIMITS.customStyle.max)
		.optional(),
	subject: vine.string().trim().maxLength(LIMITS.subject.max).optional(),
	lettering: vine.string().trim().maxLength(LIMITS.lettering.max).optional(),
	palette: vine.enum(PALETTE_KEYS),
	orientation: vine.enum(ORIENTATION_KEYS),
	detail: vine.enum(DETAIL_KEYS),
	bodyArea: vine.enum(BODY_AREA_KEYS),
});

export const retryGenerationValidator = vine.create({
	attempt: vine.number().withoutDecimals().range([1, 100]),
});

export const updateDesignAssetValidator = vine.create({
	title: vine.string().trim().maxLength(120).optional(),
	notes: vine.string().trim().maxLength(2000).optional(),
});

export const selectDesignAssetValidator = vine.create({
	selected: vine.boolean(),
});
