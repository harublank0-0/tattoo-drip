import type { SchemaRules } from "@adonisjs/lucid/types/schema_generator";

export default {
	tables: {
		// varchar[] columns: the generator can't type them on its own.
		artists: { columns: { styles: { tsType: "string[]" } } },
		artist_work_photos: { columns: { styles: { tsType: "string[]" } } },
	},
} satisfies SchemaRules;
