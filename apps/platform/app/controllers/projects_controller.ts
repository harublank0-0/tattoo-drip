import { inject } from "@adonisjs/core";
import type { HttpContext } from "@adonisjs/core/http";
import { DateTime } from "luxon";
import { tenantContext } from "#middleware/tenant_middleware";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ArtistService from "#modules/artists/services/artist_service";
import type Client from "#modules/clients/models/client";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ClientService from "#modules/clients/services/client_service";
import { flashCard } from "#modules/flash/flash_card";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import FlashService from "#modules/flash/services/flash_service";
import { referenceView } from "#modules/inquiries/reference_view";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import InquiryService from "#modules/inquiries/services/inquiry_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ImageService from "#modules/media/services/image_service";
import { ALERT_EXCERPT_LENGTH, excerpt } from "#modules/notifications/alerts";
import { chatMessage, contactLinks } from "#modules/notifications/chat";
import { MESSAGE_LABELS, renderMessage } from "#modules/notifications/messages";
import {
	cardKinds,
	cardValues,
	defaultCardKind,
} from "#modules/notifications/project_messages";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import MessageTemplateService from "#modules/notifications/services/message_template_service";
import {
	DEPOSIT_LINK_PROBLEMS,
	depositMessage,
	storefrontTemplate,
} from "#modules/payments/deposit_links";
import { paymentsCard } from "#modules/payments/payments_card";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositLinkService from "#modules/payments/services/deposit_link_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import DepositService from "#modules/payments/services/deposit_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import PaymentService, {
	type ListFlags,
} from "#modules/payments/services/payment_service";
import { lastContactText } from "#modules/projects/contact";
import {
	FINISHED_STATUSES,
	finishStepFor,
	healingCheckDueOn,
	owed,
} from "#modules/projects/finish";
import type Quote from "#modules/projects/models/quote";
import type TattooProject from "#modules/projects/models/tattoo_project";
import {
	ACTIVE_STATUSES,
	allowedMoves,
	CLOSED_STATUSES,
} from "#modules/projects/moves";
import {
	type NextStepAction,
	nextStepOf,
	type SessionLine,
	sweepWillCancel,
} from "#modules/projects/next_step";
import {
	contactLine,
	inOrder,
	isClosedFilter,
	listLine,
	ordered,
	pageOf,
	toListView,
	waitingIds,
} from "#modules/projects/project_list";
import {
	artistDepositFloor,
	BOOKED_STATUSES,
	formatDay,
	formatMoney,
	isExpired,
	lastBookableDay,
	priceText,
	QUOTABLE_STATUSES,
	quoteMessage,
	quoteTotal,
	todayIn,
	validUntil,
} from "#modules/projects/quotes";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import BookingService from "#modules/projects/services/booking_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import ProjectService, {
	PROJECTS_PER_PAGE,
} from "#modules/projects/services/project_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import QuoteService from "#modules/projects/services/quote_service";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import WaitingService from "#modules/projects/services/waiting_service";
import type ProjectSession from "#modules/scheduling/models/project_session";
import {
	mayChangeSession,
	outcomeRefusal,
	outcomesFor,
} from "#modules/scheduling/outcomes";
import {
	schedulableKinds,
	schedulingHint,
} from "#modules/scheduling/schedule_rules";
// biome-ignore lint/style/useImportType: @inject() reads the class at runtime (decorator metadata); a type-only import breaks injection.
import SessionService from "#modules/scheduling/services/session_service";
import {
	sessionFormValues,
	sessionStartText,
	sessionTimeText,
} from "#modules/scheduling/times";
import type Tenant from "#modules/tenancy/models/tenant";
import { pointsAtThisMachine } from "#services/storefront_url";

/** How long a new quote is valid by default, in days. */
const DEFAULT_VALID_DAYS = 14;

/**
 * A project's page: its quote, the quote's history and the quote form.
 * Owners open any project, artists the ones assigned to them; anyone else
 * gets a 404 (ProjectService.findFor).
 */
@inject()
export default class ProjectsController {
	constructor(
		private projects: ProjectService,
		private quotes: QuoteService,
		private clients: ClientService,
		private artists: ArtistService,
		private sessions: SessionService,
		private inquiries: InquiryService,
		private images: ImageService,
		private depositLinks: DepositLinkService,
		private deposits: DepositService,
		private payments: PaymentService,
		private bookings: BookingService,
		private templates: MessageTemplateService,
		private waiting: WaitingService,
		private flash: FlashService,
	) {}

	/**
	 * The Projects list (TAT-109). Which projects need the member, their order
	 * and their words are WaitingService.work's answer (the same as Today's and
	 * its badge's); this only picks the view's rows, cuts the page and adds the
	 * piece, the next session, the last contact and (owners only) a money fact.
	 * Every row comes from a member-scoped read.
	 */
	async index(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const view = toListView(ctx.request.qs());
		const isOwner = membership.role === "owner";
		const now = DateTime.now();
		const work = await this.waiting.work(tenant, membership, now);

		let projects: TattooProject[];
		let total: number;
		let lastPage: number;
		if (isClosedFilter(view.filter)) {
			// Closed projects are a plain SQL page, the latest change first.
			({ projects, total, lastPage } = await this.projects.list(
				tenant,
				membership,
				view.filter,
				view.page,
			));
		} else {
			const ids =
				view.waiting !== null || view.filter === "needs_you"
					? waitingIds(view, work)
					: ordered(
							await this.projects.listKeys(tenant, membership, view.filter),
							view.sort,
							work,
						).map(({ id }) => id);
			const slice = pageOf(ids, view.page, PROJECTS_PER_PAGE);
			total = slice.total;
			lastPage = slice.lastPage;
			// The member-scoped read is the access check before any per-row read.
			projects = inOrder(
				slice.rows,
				await this.projects.findManyFor(tenant, membership, slice.rows),
			);
		}

		const counts = await this.projects.countByStatus(tenant, membership);
		const clients = await this.clients.findMany(
			tenant,
			projects.map(({ clientId }) => clientId),
		);
		const artists = isOwner ? await this.artists.list(tenant) : [];
		// Owners' money facts (TAT-66, TAT-111): a plain line where nothing waits.
		const flags = isOwner
			? await this.payments.listFlags(tenant, projects)
			: new Map<string, ListFlags>();
		const nextSessions = await this.sessions.nextScheduledFor(
			tenant,
			projects.map(({ id }) => id),
			now,
		);
		const clientName = new Map(clients.map(({ id, name }) => [id, name]));
		const artistName = new Map(artists.map(({ id, name }) => [id, name]));
		const waitingOn = new Map(
			[...work.needsYou, ...work.onClient].map((item) => [
				item.project.id,
				item,
			]),
		);
		const sum = (statuses: readonly (keyof typeof counts)[]) =>
			statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);
		// Closed and waiting views keep their own order; Needs you is work()'s.
		const sortable =
			!isClosedFilter(view.filter) &&
			view.filter !== "needs_you" &&
			view.waiting === null;

		return ctx.inertia.render("projects/index", {
			filter: view.filter,
			waiting: view.waiting,
			sort: sortable ? view.sort : null,
			chosenSort: view.sort,
			counts: {
				active: sum(ACTIVE_STATUSES),
				needsYou: work.needsYou.length,
				closed: sum(CLOSED_STATUSES),
				byStatus: Object.fromEntries(
					ACTIVE_STATUSES.map((status) => [status, counts[status] ?? 0]),
				),
			},
			projects: projects.map((project) => {
				const flag = flags.get(project.id);
				const next = nextSessions.get(project.id);
				return {
					id: project.id,
					clientName: clientName.get(project.clientId) ?? null,
					// The start of the brief until TAT-115 adds a short title.
					piece: excerpt(project.brief, ALERT_EXCERPT_LENGTH),
					artistName:
						isOwner && project.artistId
							? (artistName.get(project.artistId) ?? null)
							: null,
					status: project.status,
					line: listLine(
						waitingOn.get(project.id) ?? null,
						flag
							? {
									depositToSettle: flag.depositToSettle,
									balanceDue: flag.balanceDue,
								}
							: null,
					),
					nextSessionText: next
						? sessionStartText(next.startsAt, tenant.timezone, now)
						: null,
					contactedText: contactLine(
						project.lastContactedAt,
						tenant.timezone,
						{
							channel: project.lastContactChannel,
							kind: project.lastContactKind,
						},
						now,
					),
				};
			}),
			page: { current: view.page, last: lastPage, total },
		});
	}

	async show(ctx: HttpContext) {
		const { tenant, membership } = tenantContext(ctx);
		const project = await this.projects.findFor(
			tenant,
			membership,
			ctx.params.id,
		);
		const client = await this.clients.find(tenant, project.clientId);
		const artists = await this.artists.list(tenant);
		const artist = project.artistId
			? artists.find(({ id }) => id === project.artistId)
			: undefined;
		const sessions = await this.sessions.listForProject(tenant, project);
		const scheduled = sessions.filter(({ status }) => status === "scheduled");
		const versions = await this.quotes.history(tenant, project);
		const current = versions.at(0) ?? null;
		const held = current
			? await this.deposits.verifiedPaid(tenant, project, current.currency)
			: 0;
		const live = current && !isExpired(current) ? current : null;
		const { timezone } = tenant;
		// The studio's own chat texts, else the defaults (TAT-52).
		const texts = await this.templates.textsFor(tenant);
		const today = DateTime.fromISO(todayIn(timezone), { zone: "utc" });

		// What this member may record on each session and the move form's
		// days (TAT-85). SessionService checks again under its locks.
		const now = DateTime.now();
		const todayText = todayIn(timezone);
		const lastBookable = lastBookableDay(todayText);
		const ownArtistId =
			membership.role === "owner"
				? null
				: (artists.find(({ userId }) => userId === membership.userId)?.id ??
					null);

		const inquiry = project.inquiryId
			? await this.inquiries.find(tenant, project.inquiryId)
			: null;
		const request = inquiry
			? {
					placement: inquiry.placement,
					approximateSize: inquiry.approximateSize,
					preferredDates: inquiry.preferredDates,
					budget: inquiry.budget,
					source: inquiry.sourceChannel,
					references: await Promise.all(
						(
							await this.inquiries.images(tenant, { projectId: project.id })
						).map((image) => referenceView(this.images, tenant, image)),
					),
				}
			: null;

		// The flash design the project came from (TAT-129), hidden or not: the
		// project is read member-scoped above, so its design is theirs to see.
		const design = project.flashDesignId
			? (await this.flash.forIds(tenant, [project.flashDesignId])).get(
					project.flashDesignId,
				)
			: undefined;
		const flash = design
			? await flashCard(
					this.images,
					tenant,
					design,
					artists.find(({ id }) => id === design.artistId)?.name ?? null,
				)
			: null;

		// The Payments card (TAT-66). Screenshot URLs are signed for owners
		// only, after the tenant-scoped project and payment reads.
		const money = await this.payments.forProject(tenant, project);
		const isOwner = membership.role === "owner";
		const proofUrls = new Map<string, string>();
		if (isOwner) {
			for (const payment of money.payments) {
				if (payment.proofImageKey) {
					proofUrls.set(
						payment.id,
						await this.images.url(
							"payment_proof",
							payment.proofImageKey,
							tenant,
						),
					);
				}
			}
		}
		const names = await this.payments.memberNames(
			[
				...money.payments.map(({ verifiedByUserId }) => verifiedByUserId),
				money.outcome?.recordedByUserId ?? null,
			],
			{ emails: isOwner },
		);
		const depositLink = isOwner
			? await this.depositLinks.forProject(tenant, project)
			: null;

		// Scheduling a session here (TAT-85 part 2): whom this member may
		// schedule, the default, and what a tattoo session would do.
		const bookable = this.bookings.bookableFrom(artists, membership);
		const depositDue =
			project.status === "deposit_pending" && current
				? await this.deposits.remaining(tenant, project, current)
				: 0;
		const defaultArtistId = bookable.some(({ id }) => id === project.artistId)
			? project.artistId
			: bookable.length === 1
				? (bookable[0]?.id ?? null)
				: null;

		// "Message the client" (TAT-52): one-tap links for a client with a
		// phone, and the messages this project offers now. The confirmation
		// and the reminder name the next session still to come.
		const phone = client?.phone ?? null;
		const upcoming =
			scheduled.find(({ startsAt }) => startsAt.toMillis() > now.toMillis()) ??
			null;
		const cardMessages = cardKinds({
			status: project.status,
			upcomingSession: upcoming !== null,
			finishedWork: sessions.some(
				({ status, kind }) => status === "completed" && kind !== "consultation",
			),
		});
		const facts = {
			clientName: client?.name ?? "",
			studioName: tenant.name,
			studioAddress: tenant.address,
			projectArtistName: artist?.name ?? null,
			session: upcoming
				? {
						whenText: sessionTimeText(
							upcoming.startsAt,
							upcoming.endsAt,
							timezone,
						),
						artistName:
							artists.find(({ id }) => id === upcoming.artistId)?.name ?? null,
					}
				: null,
		};

		// Finishing (TAT-111): the step this project offers, the healing check's
		// day and, for owners, what the confirmation names. A closed project
		// offers no artist change and no "Mark contacted".
		const step = finishStepFor(project.status);
		const dueOn = healingCheckDueOn(sessions, timezone);
		const owing = owed(money.balance.due);
		const closed = CLOSED_STATUSES.includes(project.status);

		// Everything the cards draw, gathered once: the render below sends it and
		// the Next step card (TAT-108) reads the same flags, so the page never
		// offers in one place what it hides in another.
		const moves = allowedMoves(project.status);
		const canQuote = QUOTABLE_STATUSES.includes(project.status);
		// An artist may confirm the client's yes only for a quote that meets their deposit
		// floor; otherwise an owner does (TAT-16, ProjectService.acceptQuote enforces it).
		const ownerAccepts =
			!isOwner &&
			project.status === "quoted" &&
			live !== null &&
			BigInt(live.depositAmount) <
				artistDepositFloor(quoteTotal(live), tenant.defaultDepositPercent);
		const canAccept =
			project.status === "quoted" && live !== null && !ownerAccepts;
		// A booking made without a price can get one once (TAT-66).
		const canSetPrice =
			BOOKED_STATUSES.includes(project.status) && current === null;
		// Only while the client's answer is awaited: not after acceptance, and
		// not for a project that was declined or withdrawn.
		const quoteChat =
			live &&
			client?.phone &&
			(project.status === "quoted" || project.status === "on_hold")
				? messageProps(
						live,
						client.name,
						client.phone,
						tenant.name,
						timezone,
						texts.quote,
					)
				: null;
		// The assigned artist sees the healing check, never the action.
		const finishProps =
			step && (isOwner || step === "complete")
				? {
						step,
						dueText: dueOn ? formatDay(dueOn) : null,
						overdue: step === "complete" && dueOn !== null && todayText > dueOn,
						action: isOwner
							? {
									confirmedDue: String(owing),
									balanceDueText: owing > 0n ? formatMoney(owing) : null,
									estimated: money.quote?.kind === "hourly",
									sessionScheduled: scheduled.length > 0,
								}
							: null,
					}
				: null;
		const sessionRows = sessions.map((session) => {
			const changeable =
				session.status === "scheduled" &&
				mayChangeSession(membership, ownArtistId, session, project);
			return {
				id: session.id,
				whenText: sessionTimeText(session.startsAt, session.endsAt, timezone),
				kind: session.kind,
				status: session.status,
				artistName:
					artists.find(({ id }) => id === session.artistId)?.name ?? null,
				outcomes: changeable ? outcomesFor(session, project.status, now) : [],
				// A started tattoo session whose project isn't booked yet: the
				// card explains why Done isn't offered.
				awaitingBooking:
					changeable &&
					outcomeRefusal(session, project.status, "completed", now) ===
						"not_booked",
				move: changeable
					? sessionFormValues(
							session.startsAt,
							session.endsAt,
							timezone,
							todayText,
							lastBookable,
						)
					: null,
			};
		});
		const schedulingProps =
			schedulableKinds(project.status).length > 0 && bookable.length > 0
				? {
						artists: bookable.map(({ id, name }) => ({ id, name })),
						artistId: defaultArtistId,
						artistFixed: membership.role !== "owner",
						kinds: [...schedulableKinds(project.status)],
						hint: schedulingHint(project.status, depositDue, current !== null),
					}
				: null;
		// Owners only, while the project waits for its deposit (TAT-65).
		const depositProps =
			membership.role === "owner" && project.status === "deposit_pending"
				? await this.depositPanel(tenant, project, client, texts.deposit_link)
				: null;
		const paymentsProps = paymentsCard({
			money,
			status: project.status,
			isOwner,
			timezone,
			names,
			proofUrls,
			referenceCode: depositLink?.referenceCode ?? null,
		});

		// The Next step card (TAT-108): what waits on this project is
		// WaitingService's answer, the one Today and the Projects list use, so the
		// three say the same; nextStepOf turns it into the card.
		const state = (
			await this.waiting.forProjects(tenant, membership, [project], now)
		).get(project.id);
		const sessionLine = (session: ProjectSession): SessionLine => ({
			startText: sessionStartText(session.startsAt, timezone, now),
			artistName:
				artists.find(({ id }) => id === session.artistId)?.name ?? null,
		});
		// A scheduled session that has started and this member may record: the
		// one the No-show button is offered on.
		const startedId = sessionRows.find(
			({ status, outcomes }) =>
				status === "scheduled" && outcomes.includes("no_show"),
		)?.id;
		const started = sessions.find(({ id }) => id === startedId);
		// What the Projects list's money line says (PaymentService.listFlags): a
		// finished project's fixed price still owed, owners only.
		const balanceOwedText =
			isOwner &&
			FINISHED_STATUSES.includes(project.status) &&
			money.quote?.kind === "fixed" &&
			owing > 0n
				? formatMoney(owing)
				: null;
		const can: Record<NextStepAction, boolean> = {
			verify_proof: paymentsProps.pending.length > 0,
			issue_quote: canQuote && current === null,
			send_quote: quoteChat !== null,
			client_accepted: canAccept,
			revise_quote: canQuote && current !== null,
			resume: moves.includes("resume"),
			deposit_link: depositProps !== null,
			record_payment: (paymentsProps.actions?.recordKinds.length ?? 0) > 0,
			schedule: schedulingProps !== null,
			open_sessions: started !== undefined,
			finish: finishProps !== null,
			record_outcome: paymentsProps.outcome.needed !== null,
		};
		const nextStep = nextStepOf({
			status: project.status,
			waiting: state?.waiting ?? null,
			waitingText: state?.text ?? null,
			waitingHash: state?.hash ?? null,
			clientName: client?.name ?? null,
			sweepWillCancel: state ? sweepWillCancel(state.facts, now) : false,
			nextSession: upcoming ? sessionLine(upcoming) : null,
			startedSession: started ? sessionLine(started) : null,
			balanceOwedText,
			can,
		});

		return ctx.inertia.render("projects/show", {
			project: {
				id: project.id,
				status: project.status,
				brief: project.brief,
				// The start of the brief, as the Projects list names the piece, until
				// TAT-115 adds a short title.
				piece: excerpt(project.brief, ALERT_EXCERPT_LENGTH),
				clientName: client?.name ?? null,
				artistName: artist?.name ?? null,
			},
			nextStep,
			flash,
			quote: current ? quoteProps(current, timezone) : null,
			history: versions.slice(1).map((quote) => quoteProps(quote, timezone)),
			// From booked on, the quote's expiry no longer means anything.
			quoteExpiryShown: !BOOKED_STATUSES.includes(project.status),
			canQuote,
			canAccept,
			ownerAccepts,
			canSetPrice,
			message: quoteChat,
			contact: phone ? contactLinks(phone) : null,
			messages: phone
				? cardMessages.map((kind) => ({
						kind,
						label: MESSAGE_LABELS[kind],
						...chatMessage(
							renderMessage(kind, texts[kind], cardValues(kind, facts)),
							phone,
						),
					}))
				: [],
			messageKind: phone ? defaultCardKind(project.status, cardMessages) : null,
			form: {
				depositPercent: tenant.defaultDepositPercent,
				// An artist in a studio with a 0% default has no minimum to explain.
				depositFloor: !isOwner && tenant.defaultDepositPercent !== 0,
				defaultValidUntil: today
					.plus({ days: DEFAULT_VALID_DAYS })
					.toFormat("yyyy-MM-dd"),
				minDate: today.toFormat("yyyy-MM-dd"),
				maxDate: today.plus({ years: 1 }).toFormat("yyyy-MM-dd"),
			},
			moves,
			// The withdraw confirm names the deposit the project holds (TAT-66).
			depositHeldText: held > 0 ? formatMoney(held) : null,
			scheduledSessionCount: scheduled.length,
			finish: finishProps,
			closed,
			sessions: sessionRows,
			sessionDates: { today: todayText, max: lastBookable },
			scheduling: schedulingProps,
			notes: project.notes,
			contactedText: lastContactText(project.lastContactedAt, timezone, {
				channel: project.lastContactChannel,
				kind: project.lastContactKind,
			}),
			// The cards lead with the channel used last (TAT-104).
			lastChannel: project.lastContactChannel,
			assignment:
				membership.role === "owner" && !closed
					? {
							artistId: project.artistId,
							choices: artists.map(({ id, name }) => ({ id, name })),
						}
					: null,
			request,
			// Owners only: the clients pages are theirs.
			clientId: membership.role === "owner" ? project.clientId : null,
			deposit: depositProps,
			payments: paymentsProps,
		});
	}

	/**
	 * The deposit panel (TAT-65): the project's link, rebuilt from its nonce
	 * (`url` null once it no longer works), why a link can't be made now,
	 * the chat message that sends it (with a working link and a phone), and
	 * whether links point at this machine (the dev host). A waiting screenshot
	 * is the Next step itself (TAT-108), so the panel doesn't note it.
	 */
	private async depositPanel(
		tenant: Tenant,
		project: TattooProject,
		client: Pick<Client, "name" | "phone"> | null,
		depositTemplate: string,
	) {
		const link = await this.depositLinks.forProject(tenant, project);
		const problem = await this.depositLinks.issueProblem(tenant, project);
		const quote = await this.quotes.current(tenant, project);
		const due = quote
			? await this.deposits.remaining(tenant, project, quote)
			: 0;
		const url = link?.url ?? null;
		return {
			link: link
				? {
						url,
						referenceCode: link.referenceCode,
						// The last day it works: the day before the instant it expires.
						expiresText: formatDay(validUntil(link.expiresAt, tenant.timezone)),
					}
				: null,
			problem: problem ? DEPOSIT_LINK_PROBLEMS[problem] : null,
			message:
				link && url && client?.phone
					? chatMessage(
							depositMessage(
								{
									clientName: client.name,
									studioName: tenant.name,
									dueText: formatMoney(due),
									referenceCode: link.referenceCode,
									url,
								},
								depositTemplate,
							),
							client.phone,
						)
					: null,
			// Links that open on this machine reach no client: the card warns.
			devHost: pointsAtThisMachine(storefrontTemplate()),
		};
	}
}

/**
 * What the page gets for one quote version: display text in the studio's
 * timezone, and the amounts in the form's units for a revision.
 */
function quoteProps(quote: Quote, timezone: string) {
	const lastDay = validUntil(quote.expiresAt, timezone);
	return {
		id: quote.id,
		version: quote.version,
		kind: quote.kind,
		priceText: priceText(quote),
		totalText: formatMoney(quoteTotal(quote)),
		depositText:
			quote.depositAmount === 0
				? "No deposit"
				: formatMoney(quote.depositAmount),
		validUntil: lastDay,
		validUntilText: formatDay(lastDay),
		issuedText: formatDay(
			quote.createdAt.setZone(timezone).toFormat("yyyy-MM-dd"),
		),
		expired: isExpired(quote),
		fixedPrice: quote.fixedPrice === null ? null : quote.fixedPrice / 100,
		hourlyRate: quote.hourlyRate === null ? null : quote.hourlyRate / 100,
		estimatedHours:
			quote.estimatedMinutes === null ? null : quote.estimatedMinutes / 60,
		depositAmount: quote.depositAmount / 100,
	};
}

/** The chat message for a live quote, in the studio's text, and the links that send it. */
function messageProps(
	quote: Quote,
	clientName: string,
	phone: string,
	studioName: string,
	timezone: string,
	template: string,
) {
	return chatMessage(
		quoteMessage({ clientName, studioName, quote, timezone }, template),
		phone,
	);
}
