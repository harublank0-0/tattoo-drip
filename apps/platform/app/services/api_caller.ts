import crypto from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { HttpContext } from "@adonisjs/core/http";
import logger from "@adonisjs/core/services/logger";
import env from "#start/env";

/**
 * Who is calling the public API (TAT-38). A request with a valid server key
 * (Authorization: Bearer) is a hosted app's server: the storefront's
 * (STOREFRONT_SERVER_KEYS) or Discover's (DISCOVER_SERVER_KEYS, D11). It is
 * counted by its visitor (X-Visitor-IP), each kind in its own buckets.
 * Anything else is an anonymous client, counted by request.ip(). A key
 * grants nothing else: no data, route, field, cache variant or
 * authorization. The dashboard never calls this.
 */
export const VISITOR_IP_HEADER = "x-visitor-ip";

/** Longer Authorization headers are never parsed or hashed. */
const MAX_AUTHORIZATION_LENGTH = 300;

/** RFC 7235: the scheme, at least one space, a token68. */
const BEARER = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i;

const sha256 = (value: string) =>
	crypto.createHash("sha256").update(value, "utf8").digest();

/**
 * The configured keys, kept as SHA-256 digests. `check` compares the
 * presented token's digest with every one in constant time, without
 * stopping at a match, so the time doesn't say which key matched or how
 * close a guess was.
 */
export class ServerKeys {
	readonly #digests: Buffer[];

	constructor(keys: readonly string[]) {
		this.#digests = keys.map(sha256);
	}

	check(authorization: string | undefined): "match" | "unknown" | "none" {
		if (!authorization || authorization.length > MAX_AUTHORIZATION_LENGTH) {
			return "none";
		}
		const token = BEARER.exec(authorization)?.[1];
		if (!token) return "none";
		const presented = sha256(token);
		let matched = false;
		for (const digest of this.#digests) {
			matched = crypto.timingSafeEqual(presented, digest) || matched;
		}
		return matched ? "match" : "unknown";
	}
}

/** The servers that may present a key: each has its own list and buckets. */
export type KeyedService = "storefront" | "discover";

const configured = new Map<KeyedService, ServerKeys>();

/** STOREFRONT_SERVER_KEYS or DISCOVER_SERVER_KEYS, read once per process. */
function serverKeys(service: KeyedService): ServerKeys {
	let keys = configured.get(service);
	if (!keys) {
		const name =
			service === "storefront"
				? "STOREFRONT_SERVER_KEYS"
				: "DISCOVER_SERVER_KEYS";
		keys = new ServerKeys(env.get(name)?.release() ?? []);
		configured.set(service, keys);
	}
	return keys;
}

/**
 * Ranges a visitor's public address is never in: private, loopback,
 * link-local, carrier-grade NAT, "this network", IETF and benchmarking
 * blocks, multicast and reserved. IPv4-mapped IPv6 addresses are checked
 * against the IPv4 rules (BlockList does this).
 */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 128],
	["::1", 128],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
	const family = isIP(ip);
	if (family === 0) return false;
	return !NOT_PUBLIC.check(ip, family === 4 ? "ipv4" : "ipv6");
}

/**
 * The X-Visitor-IP value as a visitor's address: one IP literal (no list,
 * port, brackets or zone) in a public range, else null.
 */
export function visitorIp(value: string | undefined): string | null {
	const ip = value?.trim() ?? "";
	if (ip.length === 0 || ip.length > 45 || ip.includes("%")) return null;
	return isPublicAddress(ip) ? ip : null;
}

/** A caller: an anonymous client by its address, or a keyed server by its visitor (null: none usable). */
export type ApiCaller =
	| { kind: "anonymous"; ip: string }
	| { kind: KeyedService; ip: string | null };

declare module "@adonisjs/core/http" {
	interface HttpContext {
		/** The public API caller, set by callerOf (the gate runs it first). */
		apiCaller?: ApiCaller;
	}
}

const WARN_EVERY_MS = 10 * 60 * 1000;

/** Fixed texts: never a key, a part of one, or an address. */
export const CALLER_WARNINGS = {
	unknownKey:
		"A request presented a server key this API does not accept; it was counted as an anonymous client. Check STOREFRONT_SERVER_KEYS against the storefront's STOREFRONT_SERVER_KEY, and DISCOVER_SERVER_KEYS against Discover's DISCOVER_SERVER_KEY.",
	noVisitor:
		"A request with the storefront's server key had no usable X-Visitor-IP; it was counted in the storefront's shared budget. Check that the storefront forwards its visitors' addresses.",
	noDiscoverVisitor:
		"A request with Discover's server key had no usable X-Visitor-IP; it was counted in Discover's shared budget. Check that Discover forwards its visitors' addresses.",
} as const;

const lastWarned = new Map<keyof typeof CALLER_WARNINGS, number>();

function warnAtMostEvery(kind: keyof typeof CALLER_WARNINGS) {
	const now = Date.now();
	const last = lastWarned.get(kind);
	if (last !== undefined && now - last < WARN_EVERY_MS) return;
	lastWarned.set(kind, now);
	logger.warn(CALLER_WARNINGS[kind]);
}

/** For tests: the next warning of each kind is logged again. */
export function resetCallerWarnings() {
	lastWarned.clear();
}

/** The request's caller, worked out once (the gate, PublicGateMiddleware, asks first). */
export function callerOf(ctx: HttpContext): ApiCaller {
	if (ctx.apiCaller) return ctx.apiCaller;
	const authorization = ctx.request.header("authorization");
	const storefront = serverKeys("storefront").check(authorization);
	// Both lists are always checked, so the time doesn't say which matched.
	const discover = serverKeys("discover").check(authorization);
	const service: KeyedService | null =
		storefront === "match"
			? "storefront"
			: discover === "match"
				? "discover"
				: null;
	let caller: ApiCaller;
	if (service) {
		const ip = visitorIp(ctx.request.header(VISITOR_IP_HEADER));
		if (ip === null)
			warnAtMostEvery(
				service === "storefront" ? "noVisitor" : "noDiscoverVisitor",
			);
		caller = { kind: service, ip };
	} else {
		if (storefront === "unknown") warnAtMostEvery("unknownKey");
		caller = { kind: "anonymous", ip: ctx.request.ip() };
	}
	ctx.apiCaller = caller;
	return caller;
}

/**
 * The address a public throttle counts: a keyed server's visitor, else
 * request.ip(). Later throttles use this, never request.ip().
 */
export function callerIp(ctx: HttpContext): string {
	return callerOf(ctx).ip ?? ctx.request.ip();
}
