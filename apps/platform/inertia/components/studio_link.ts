/** The studio page link and how to share it (TAT-101); from `studioLinks` on the server. */
export type StudioPageProps = {
	/** The studio page. Open, Copy and Share all use exactly this. */
	url: string;
	/** WhatsApp's share link with the URL encoded. */
	shareUrl: string;
	/** The link opens on this machine only: no client can open it. */
	devHost: boolean;
};

/** What comes before and after the slug in a studio address (`.example.com`). */
export type AddressHost = { prefix: string; suffix: string };

export type SetupStepKey = "artists" | "payments" | "policy" | "inquiry";

/** The new-studio checklist, from `SetupService` on the server. */
export type SetupProps = {
	steps: { key: SetupStepKey; done: boolean; next: boolean }[];
	doneCount: number;
	total: number;
	complete: boolean;
};
