// Stand-in for the platform web server and the storefront in the nginx test.
// Reads the whole request body, then answers with what it received as JSON:
// which upstream this is, the request headers, the peer's address (nginx's),
// the request line and the number of body bytes that arrived. A URL with
// abort=1 gets no answer: the connection is cut, so nginx logs an upstream error.
import http from "node:http";

const upstream = process.env.UPSTREAM ?? "unknown";
const port = Number(process.env.PORT ?? 3000);

http
	.createServer((req, res) => {
		let bytes = 0;
		req.on("data", (chunk) => {
			bytes += chunk.length;
		});
		req.on("end", () => {
			if (req.url?.includes("abort=1")) {
				req.socket.destroy();
				return;
			}
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					upstream,
					headers: req.headers,
					remote: req.socket.remoteAddress,
					method: req.method,
					url: req.url,
					bytes,
				}),
			);
		});
	})
	.listen(port, "0.0.0.0", () => {
		console.log(`echo ${upstream} listening on ${port}`);
	});
