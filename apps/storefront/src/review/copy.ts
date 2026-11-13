import { headCopy } from "./head-copy.ts";

/*
 * Every word of the review page (Reviews and Fresh ink), as templates:
 * `{studio}`, `{artist}` and the like are filled by `fill` / `<Fill>`
 * (src/intake/template.ts), which put names in <bdi>. Plain words for a
 * client who just got tattooed; the consents say exactly where something
 * shows (ruling 8).
 */
export const copy = {
	...headCopy,
	heading: "How did it heal?",
	headingSaved: "Thanks for telling {studio}",
	headingDead: "This link no longer works",
	headingLimited: "Too many tries",
	headingFailed: "We couldn't load your page",
	intro:
		"Tell {studio} how your tattoo went and show it off. You choose where it shows.",
	tattooedBy: "Tattooed by {artist} on {date}",
	tattooedOn: "Tattooed on {date}",
	loading: "Loading your page…",
	dead: "Ask {studio} to send you a new link.",
	deadContact: "Reach {studio}:",
	limited: "Wait a few minutes, then try again.",
	failed: "Check your connection, then try again.",
	offline: "We couldn't load your page. Check your connection.",
	retrying: "Trying again…",
	tryAgain: "Try again",
	linkUntil: "You can change or delete what you post here until {date}.",

	reviewTitle: "Your review",
	ratingLegend: "Your rating",
	ratingStar: "{count} star",
	ratingStars: "{count} stars",
	ratingWords: ["", "Poor", "Fair", "Good", "Very good", "Excellent"],
	bodyLabel: "Your review",
	bodyHint: "At least 20 characters. Plain text.",
	count: "{count} of {max} characters",
	countNearLimit: "20 characters left.",
	countAtLimit: "You've reached the limit of {max} characters.",
	deleteReview: "Delete my review",
	reviewTakenDown: "Taken down",

	postTitle: "Fresh ink",
	postHint:
		"Add up to 8 photos or short videos of the healed tattoo. The first photo is the main one; a video can't be. {studio} checks a post before it shows anywhere.",
	addPhotos: "Add photos",
	addVideo: "Add a video",
	videoHint: "Videos: up to 60 seconds and 100 MB. They play without sound.",
	makeMain: "Make {item} the main photo",
	main: "Main photo",
	remove: "Remove",
	removeLabel: "Remove {item}",
	photoItem: "photo {n}",
	videoItem: "video {n}",
	preparing: "Preparing…",
	uploading: "Uploading…",
	uploadingPercent: "Uploading… {percent}%",
	processing: "Processing the video…",
	photoAdded: "Photo {n} added.",
	videoAdded: "Video {n} added. It's being processed.",
	videoReady: "Video {n} ready.",
	videoCouldNot: "Video {n} couldn't be processed.",
	stillProcessing: "Still processing. Come back to this page later.",
	madeMain: "{item} is now the main photo.",
	removed: "{item} removed.",
	videoFailed:
		"This video couldn't be used: {reason} Remove it and try another.",
	postFull: "Your post has 8 photos and videos. Remove one to add another.",
	stylesLegend: "Styles (up to 3)",
	stylesFull: "Choose up to 3 styles.",
	placementLabel: "Where is it on your body? (optional)",
	captionLabel: "Caption (optional)",
	deletePost: "Delete my post",
	postWaiting: "Waiting for {studio} to check it.",
	postApproved: "Shown by {studio} where you allowed.",
	postNotShown: "Not shown by the studio.",
	postDraft: "Not sent yet: press Save to send it to {studio}.",
	postApprovedHint: "If you change it, {studio} checks it again.",
	reviewBlocked: "This was taken down by TattooDrip. Contact the studio.",
	postLimit:
		"This tattoo already had two posts. Contact the studio to change it.",

	whereTitle: "Where it shows",
	whereHint:
		"Nothing shows anywhere unless you tick it. You can change this later.",
	consentStudio: "Show on {studio}'s page",
	consentDiscover: "Show on TattooDrip Discover",
	consentDiscoverHint: "TattooDrip's directory of studios and their work.",
	nameLabel: "Your name as shown",
	nameHint:
		"Your first name and the first letter of your last name, unless you change it. Up to 40 characters.",

	save: "Save",
	saving: "Saving…",
	saved: "Saved. {studio} can see it now.",
	savedPostWaiting: "Saved. {studio} checks your photos before they show.",
	savedPrivate: "Nobody else sees it.",
	deletedReview: "Your review is deleted: its rating, words and name are gone.",
	deletedPost: "Your post is deleted: its photos, videos and words are gone.",
	confirmDelete: "Delete it for good?",
	confirmYes: "Yes, delete",
	confirmNo: "Keep it",
	privacy:
		"Only {studio} and TattooDrip see your phone number and full name. Cloudflare checks this page is used by a person.",
	uploadsPending:
		"Wait for your photos and videos to finish uploading, then save.",
	waitMinutes: "Too many tries. Try again in {minutes} minutes.",
	waitMinute: "Too many tries. Try again in a minute.",
	footer: "This page is run by TattooDrip for {studio}.",

	problemsTitle: "Check these and save again:",
	errors: {
		rating: "Choose a rating from 1 to 5 stars.",
		bodyShort: "Write at least 20 characters.",
		bodyLong: "Keep your review to 2,000 characters.",
		ratingWithoutBody: "Write a few words with your rating.",
		shownName:
			"Write the name to show: up to 40 characters, letters you can see.",
		caption: "Keep the caption to 280 characters.",
		placement: "Keep it to 120 characters.",
		nothing: "Write a review or add a photo.",
		postNeedsPhoto:
			"A video can't be the main picture: keep a photo first in your post.",
		locked: "This can't be changed now. Reload the page to see why.",
		challenge: "We couldn't confirm you're a person. Try again.",
		challengeDown: "We couldn't run the security check. Try again in a minute.",
		limited: "Too many tries. Wait a few minutes, then try again.",
		takenDown: "This was taken down by TattooDrip. Contact the studio.",
		postLimit:
			"This tattoo already had two posts. Contact the studio to change it.",
		network: "It wasn't saved. Check your connection and try again.",
		failed: "Something went wrong. Try again.",
		removeFailed: "We couldn't remove it just now. Try again.",
		photo: {
			unsupported: "Use a JPEG, PNG or WebP photo.",
			heic: "This phone photo couldn't be opened here. Take a screenshot of it, or save it as a JPEG.",
			"too-big": "This photo is too large.",
			"too-heavy": "This photo is too large.",
			unreadable: "This photo couldn't be opened.",
		},
		videoType: "Use an MP4, MOV or WebM video.",
		videoSize: "Use a video of 100 MB or less.",
		videoLong: "Use a video of 60 seconds or less.",
		upload: "The upload didn't finish. Try again.",
	},
} as const;
