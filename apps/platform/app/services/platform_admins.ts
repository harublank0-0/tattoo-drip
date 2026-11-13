import { canonicalEmail } from "#modules/identity/email_address";
import env from "#start/env";

/** Whether `user` is TattooDrip platform staff: a confirmed address listed in PLATFORM_ADMIN_EMAILS. */
export function isPlatformAdmin(user: {
	email: string;
	emailVerified: boolean;
}): boolean {
	if (!user.emailVerified) return false;
	return env.get("PLATFORM_ADMIN_EMAILS").includes(canonicalEmail(user.email));
}
