import { cn } from "cn";
import CopyLinkButton from "~/components/copy_link_button";
import DevHostWarning from "~/components/dev_host_warning";
import type { StudioPageProps } from "~/components/studio_link";
import { buttonVariants } from "~/components/ui/button";

const ACTION = "h-11";

/**
 * The studio page link with Open, Copy and Share on WhatsApp (TAT-101): the
 * one address clients use, to put in an Instagram bio. Open, Copy and Share
 * all use `studioPage.url`, so they can never differ; the URL is shown as
 * selectable text in case copying isn't available.
 */
export default function StudioLinkCard({
	studioPage,
}: {
	studioPage: StudioPageProps;
}) {
	const { url, shareUrl, devHost } = studioPage;

	return (
		<div className="flex flex-col gap-4">
			{devHost && (
				<DevHostWarning>
					your studio page link points at this computer, so a client can't open
					it.
				</DevHostWarning>
			)}
			<p className="rounded-md border bg-muted p-3 text-sm font-medium break-all select-all">
				{url}
			</p>
			<div className="flex flex-wrap gap-2">
				<CopyLinkButton text={url} className={ACTION} />
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					className={cn(buttonVariants({ variant: "outline" }), ACTION)}
				>
					Open
				</a>
				<a
					href={shareUrl}
					target="_blank"
					rel="noreferrer"
					className={cn(buttonVariants({ variant: "outline" }), ACTION)}
				>
					Share on WhatsApp
				</a>
			</div>
		</div>
	);
}
