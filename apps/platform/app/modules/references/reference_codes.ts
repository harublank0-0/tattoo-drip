import { randomInt } from "node:crypto";

/**
 * A studio's reference codes: one short code a client quotes from the
 * request they send to the payment remark of its deposit (the inquiry's
 * reference, reused by its project's deposit link). Unique per studio
 * across inquiries and deposit links, which `reference_codes` guarantees
 * (ReferenceCodeService.claim).
 */

/**
 * The reference code's symbols: digits and capitals that can't be misread
 * when typed into a payment remark (no 0, 1, I, L, O or U).
 */
export const REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REFERENCE_LENGTH = 6;

/** A code's shape, as every table that holds one checks it. */
export const REFERENCE_CODE_PATTERN = /^[2-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

/** How many codes a claim draws before a collision surfaces. */
export const REFERENCE_TRIES = 5;

/** A random reference code: REFERENCE_LENGTH symbols of REFERENCE_ALPHABET. */
export function newReferenceCode(): string {
	let code = "";
	for (let i = 0; i < REFERENCE_LENGTH; i++) {
		code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
	}
	return code;
}
