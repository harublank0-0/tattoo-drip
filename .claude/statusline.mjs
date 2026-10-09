function modelName(value) {
	if (typeof value !== "string") return "Claude";
	return (
		value
			.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 48) || "Claude"
	);
}

function contextSize(value) {
	if (!Number.isSafeInteger(value) || value <= 0) return "";
	return new Intl.NumberFormat("en", {
		notation: "compact",
		maximumFractionDigits: 1,
	})
		.format(value)
		.toLowerCase();
}

let line = "Claude | ctx ?";

try {
	process.stdin.setEncoding("utf8");
	let input = "";
	for await (const chunk of process.stdin) input += chunk;
	const payload = JSON.parse(input);
	const context = payload?.context_window;
	const used = context?.used_percentage;
	const percentage =
		typeof used === "number" && Number.isFinite(used)
			? `${Math.round(Math.min(100, Math.max(0, used)))}%`
			: "?";
	const size = contextSize(context?.context_window_size);
	const cost = payload?.cost?.total_cost_usd;
	const estimate =
		typeof cost === "number" && Number.isFinite(cost) && cost >= 0
			? ` | est $${cost.toFixed(2)}`
			: "";
	line = `${modelName(payload?.model?.display_name)} | ctx ${percentage}${size ? ` / ${size}` : ""}${estimate}`;
} catch {
	// Missing or malformed input keeps the harmless fallback.
}

process.stdout.write(`${line}\n`);
