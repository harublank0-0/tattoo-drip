import { createClient } from "@supabase/supabase-js";
import { env } from "#/env";

export const supabase = createClient(
	env.VITTE_SUPABASE_URL,
	env.VITTE_SUPABASE_KEY,
);
