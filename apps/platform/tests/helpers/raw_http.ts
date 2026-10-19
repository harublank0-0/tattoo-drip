import net from "node:net";
import env from "#start/env";

export type RawResponse = {
	status: number;
	headers: Record<string, string>;
	body: string;
};

/**
 * A raw connection to the test server (from loopback, so X-Forwarded-For
 * picks the client address): writes the request line and headers, then
 * `body`, and nothing more unless the test writes it.
 */
export function rawRequest(lines: string[], body = ""): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const socket = net.connect(
			{ host: env.get("HOST"), port: env.get("PORT") },
			() => {
				socket.write(
					`${[...lines, `Host: ${env.get("HOST")}`, "", ""].join("\r\n")}${body}`,
				);
				resolve(socket);
			},
		);
		socket.once("error", reject);
	});
}

/** The first response on `socket`, once its headers and Content-Length bytes arrived. */
export function readResponse(
	socket: net.Socket,
	timeoutMs = 3000,
): Promise<RawResponse> {
	return new Promise((resolve, reject) => {
		let data = "";
		const timer = setTimeout(() => {
			socket.off("data", onData);
			reject(new Error(`No response within ${timeoutMs} ms`));
		}, timeoutMs);
		function onData(chunk: Buffer) {
			data += chunk.toString("latin1");
			const end = data.indexOf("\r\n\r\n");
			if (end === -1) return;
			const [statusLine, ...headerLines] = data.slice(0, end).split("\r\n");
			const headers = Object.fromEntries(
				headerLines.map((line) => {
					const colon = line.indexOf(":");
					return [
						line.slice(0, colon).trim().toLowerCase(),
						line.slice(colon + 1).trim(),
					];
				}),
			);
			const length = Number(headers["content-length"] ?? 0);
			const body = data.slice(end + 4);
			if (body.length < length) return;
			clearTimeout(timer);
			socket.off("data", onData);
			resolve({
				status: Number(statusLine.split(" ")[1]),
				headers,
				body: body.slice(0, length),
			});
		}
		socket.on("data", onData);
	});
}

/** Whether the server closed `socket` within `ms`. */
export function closedWithin(socket: net.Socket, ms: number): Promise<boolean> {
	if (socket.destroyed || socket.readableEnded) return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), ms);
		const done = () => {
			clearTimeout(timer);
			resolve(true);
		};
		socket.once("end", done);
		socket.once("close", done);
	});
}

/** Polls until `check` holds (something the server finishes after answering). */
export async function waitFor(
	check: () => Promise<boolean> | boolean,
	what: string,
): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 30));
	}
	throw new Error(`Timed out waiting for ${what}`);
}
