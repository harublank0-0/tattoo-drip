import { ReviewLinkSchema } from "#database/schema";

/**
 * A project's review link (Reviews and Fresh ink, rulings 2 to 4): the
 * bearer link to the client's review page. The token is never stored:
 * `tokenNonce` derives it (reviewTokenFor in #modules/reviews/review_links)
 * and `tokenHash` is what a request is looked up by. One live (unrevoked)
 * link per project; expires twelve months after it is made. Not
 * soft-deleted: a credential. Read and change links through
 * ReviewLinkService.
 */
export default class ReviewLink extends ReviewLinkSchema {}
