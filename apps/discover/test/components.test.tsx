import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	EditorialSection,
	PageContainer,
	SectionHeading,
} from "../src/components/discovery/layout.tsx";
import {
	BadgeImage,
	imageCandidates,
	ResponsiveImage,
} from "../src/components/discovery/responsive-image.tsx";
import {
	EmptyState,
	ErrorState,
	FoundationNotice,
	LoadingSkeleton,
} from "../src/components/discovery/states.tsx";

describe("Discover design-system primitives", () => {
	test("an empty result is plain content; a failed read is an alert with a retry", () => {
		const empty = renderToStaticMarkup(
			<EmptyState title="No studios listed yet">Soon.</EmptyState>,
		);
		assert.doesNotMatch(empty, /role=/);
		assert.match(empty, /<h2[^>]*>No studios listed yet<\/h2>/);
		const error = renderToStaticMarkup(<ErrorState onRetry={() => {}} />);
		assert.match(error, /role="alert"/);
		assert.match(error, /Try again/);
		assert.doesNotMatch(renderToStaticMarkup(<ErrorState />), /<button/);
	});

	test("a skeleton announces itself once and hides its blocks from screen readers", () => {
		const html = renderToStaticMarkup(
			<LoadingSkeleton rows={2} label="Loading studios" />,
		);
		assert.match(html, /<output aria-live="polite"/);
		assert.match(html, /<span class="sr-only">Loading studios…<\/span>/);
		assert.equal(html.match(/aria-hidden="true"/g)?.length, 2);
		assert.match(html, /motion-reduce:animate-none/);
	});

	test("an image keeps its frame and size, loads lazily and says when it is missing", () => {
		const html = renderToStaticMarkup(
			<ResponsiveImage
				image={{
					url: "https://media.test/a.jpg",
					width: 1200,
					height: 1500,
					variants: [{ url: "https://media.test/a.640.jpg", width: 640 }],
				}}
				alt="Koi on a forearm"
			/>,
		);
		assert.match(html, /aspect-ratio:4 \/ 5/);
		assert.match(html, /width="1200" height="1500"/);
		assert.match(html, /loading="lazy"/);
		assert.match(
			html,
			/srcSet="https:\/\/media\.test\/a\.640\.jpg 640w, https:\/\/media\.test\/a\.jpg 1200w"/,
		);
		assert.match(html, /alt="Koi on a forearm"/);
		const missing = renderToStaticMarkup(
			<ResponsiveImage image={null} alt="Studio cover" />,
		);
		assert.match(
			missing,
			/role="img" aria-label="Studio cover \(image unavailable\)"/,
		);
		assert.match(
			renderToStaticMarkup(<ResponsiveImage image={null} alt="" priority />),
			/Image unavailable/,
		);
	});

	test("headings keep their level; sections are named regions; containers set the width", () => {
		assert.match(
			renderToStaticMarkup(<SectionHeading level={1} title="Explore" />),
			/<h1[^>]*text-display-xl/,
		);
		assert.match(
			renderToStaticMarkup(
				<SectionHeading title="Explore" eyebrow="Discover" />,
			),
			/<h2[^>]*>Explore<\/h2>/,
		);
		const section = renderToStaticMarkup(
			<EditorialSection tone="night" labelledBy="x">
				<h2 id="x">Studios</h2>
			</EditorialSection>,
		);
		assert.match(section, /<section aria-labelledby="x" class="[^"]*night/);
		assert.match(
			renderToStaticMarkup(<PageContainer width="reading">x</PageContainer>),
			/max-w-3xl/,
		);
	});

	test("an unbuilt page says so as a note, never as a working feature", () => {
		const html = renderToStaticMarkup(
			<FoundationNotice>Being written.</FoundationNotice>,
		);
		assert.match(html, /role="note"/);
		assert.match(html, /Coming soon/);
	});
	test("thumbnails offer copies up to 1280 px, never a 2048 px original; large images and old images keep it", () => {
		const image = {
			url: "https://media.test/a.jpg",
			width: 2048,
			height: 2560,
			variants: [320, 640, 1280].map((width) => ({
				url: `https://media.test/a.${width}w.jpg`,
				width,
			})),
		};
		assert.deepEqual(
			imageCandidates(image, 1280).map((each) => each.width),
			[320, 640, 1280],
		);
		assert.deepEqual(
			imageCandidates(image).map((each) => each.width),
			[320, 640, 1280, 2048],
		);
		// Stored before the copies: the original is all there is.
		assert.deepEqual(
			imageCandidates({ ...image, variants: [] }, 1280).map((each) => each.url),
			["https://media.test/a.jpg"],
		);
		const thumb = renderToStaticMarkup(
			<ResponsiveImage image={image} alt="Koi" />,
		);
		assert.doesNotMatch(thumb, /a\.jpg/);
		assert.match(thumb, /src="https:\/\/media\.test\/a\.1280w\.jpg"/);
		const large = renderToStaticMarkup(
			<ResponsiveImage image={image} alt="Koi" large priority />,
		);
		assert.match(large, /a\.jpg 2048w/);
		assert.match(large, /fetchPriority="high"/);
		assert.match(large, /loading="eager"/);
		const badge = renderToStaticMarkup(<BadgeImage image={image} size={80} />);
		assert.match(badge, /sizes="80px"/);
		assert.match(badge, /alt=""/);
		assert.doesNotMatch(badge, /a\.jpg/);
	});

	test("the route's error page names itself in its one h1", () => {
		assert.match(
			renderToStaticMarkup(<ErrorState headingLevel={1} title="Down" />),
			/<h1[^>]*>Down<\/h1>/,
		);
	});
});
