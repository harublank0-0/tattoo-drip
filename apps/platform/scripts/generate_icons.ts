/**
 * Writes the app icons in public/icons from resources/brand/mark.svg
 * (TAT-67). Run it after changing the mark, from apps/platform:
 * `node scripts/generate_icons.ts`. The outputs are committed.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = join(import.meta.dirname, "..");
const source = join(root, "resources/brand/mark.svg");
const out = join(root, "public/icons");
const mark = await readFile(source, "utf8");

/**
 * The square without rounded corners and the letters shrunk into the
 * central safe zone: Android masks it to any shape, and iOS rounds the
 * corners itself (transparent corners would show black there).
 */
function fullBleed(svg: string): string {
	const square = ' rx="112"';
	const letters = '<g id="letters"';
	if (!svg.includes(square) || !svg.includes(letters)) {
		throw new Error("mark.svg must keep the #square rx and the #letters group");
	}
	return svg
		.replace(square, "")
		.replace(
			letters,
			`${letters} transform="translate(256 256) scale(0.8) translate(-256 -256)"`,
		);
}

async function png(svg: string, size: number, name: string) {
	const data = await sharp(Buffer.from(svg))
		.resize(size, size)
		.png()
		.toBuffer();
	await writeFile(join(out, name), data);
}

await mkdir(out, { recursive: true });
await png(mark, 192, "icon-192.png");
await png(mark, 512, "icon-512.png");
await png(mark, 32, "favicon-32.png");
await png(fullBleed(mark), 512, "icon-maskable-512.png");
await png(fullBleed(mark), 180, "apple-touch-icon.png");
await copyFile(source, join(out, "favicon.svg"));
console.log(`Icons written to ${out}`);
