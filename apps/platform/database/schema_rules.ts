import type { SchemaRules } from "@adonisjs/lucid/types/schema_generator";

export default {
	tables: {
		// varchar[] columns: the generator can't type them on its own.
		artists: { columns: { styles: { tsType: "string[]" } } },
		artist_work_photos: {
			columns: {
				styles: { tsType: "string[]" },
				// Video angles: the renditions' keys, smallest first.
				video_keys: { tsType: "string[]" },
			},
		},
	},
} satisfies SchemaRules;
