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
		// Reviews and Fresh ink: a post's style slugs, and its videos' keys.
		client_posts: { columns: { styles: { tsType: "string[]" } } },
		client_post_media: { columns: { video_keys: { tsType: "string[]" } } },
	},
} satisfies SchemaRules;
