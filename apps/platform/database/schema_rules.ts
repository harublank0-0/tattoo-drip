import type { SchemaRules } from "@adonisjs/lucid/types/schema_generator";

export default {
	tables: {
		// A varchar[] column: the generator can't type it on its own.
		artists: { columns: { styles: { tsType: "string[]" } } },
	},
} satisfies SchemaRules;
