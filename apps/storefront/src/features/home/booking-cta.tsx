import { artist } from "#/data/mock/artist";
import { BookingDialog } from "./booking-dialog";

export function BookingCta() {
	return (
		<section
			id="booking"
			className="booking-section"
			aria-labelledby="booking-title"
		>
			<div className="page-container relative py-24 text-center md:py-36">
				<p className="eyebrow mb-8 text-accent">
					A thought. A conversation. A tattoo.
				</p>
				<h2 id="booking-title" className="booking-title">
					Have an idea
					<br />
					<em className="font-normal">in mind?</em>
				</h2>
				<p className="mx-auto mt-8 max-w-sm text-sm leading-[1.9] text-muted-foreground">
					Tell me what you’re thinking,
					<br />
					and let’s turn it into something permanent.
				</p>
				<div className="mt-9">
					<BookingDialog />
				</div>
				<p className="mt-7 inline-flex items-center gap-2.5 text-[10px] tracking-wide text-muted-foreground">
					<span className="size-1.5 rounded-full bg-accent" />
					{artist.acceptingBookings
						? "Currently accepting bookings"
						: "Bookings reopening soon"}
				</p>
			</div>
		</section>
	);
}
