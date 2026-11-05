import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, mkdir, mkdtemp, writeFile, copyFile, chmod, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../vendor/antigravity-runtime");
const platform = `${process.platform}-${process.arch}`;
const manifestPath = join(root, `${platform}.json`);
if (!existsSync(manifestPath)) throw new Error(`Antigravity runtime for ${platform} has not been verified for this application build.`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const target = join(root, "bin", platform, process.platform === "win32" ? "antigravity.exe" : "antigravity");
const sha512 = (bytes) => createHash("sha512").update(bytes).digest("hex");
if (existsSync(target) && sha512(await readFile(target)) === manifest.binarySha512) {
	console.log(`Antigravity CLI ${manifest.version} (${platform}) verified.`);
} else {
	const temporary = await mkdtemp(join(tmpdir(), "lh-antigravity-download-"));
	try {
		const response = await fetch(manifest.url);
		if (!response.ok) throw new Error(`Official Antigravity download failed: ${response.status}`);
		const archive = Buffer.from(await response.arrayBuffer());
		if (sha512(archive) !== manifest.sha512) throw new Error("Antigravity archive checksum mismatch.");
		const archivePath = join(temporary, "runtime.tar.gz"); await writeFile(archivePath, archive);
		execFileSync("tar", ["-xzf", archivePath, "-C", temporary, "antigravity"]);
		const binary = join(temporary, "antigravity");
		if (sha512(await readFile(binary)) !== manifest.binarySha512) throw new Error("Antigravity binary checksum mismatch.");
		await mkdir(join(root, "bin", platform), { recursive: true });
		await copyFile(binary, `${target}.tmp`); await chmod(`${target}.tmp`, 0o755); await rename(`${target}.tmp`, target);
		console.log(`Prepared verified Antigravity CLI ${manifest.version} (${platform}).`);
	} finally { await rm(temporary, { recursive: true, force: true }); }
}
