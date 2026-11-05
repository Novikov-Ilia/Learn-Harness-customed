import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, chmod, rename } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { AUTH_FILE } from "../../../config.ts";
import { externalCliEnv } from "../../core/auth-env.ts";
import { GEMINI_CLI_VERSION } from "../../core/contracts/gemini-cli.ts";

export const geminiProfileDir = join(dirname(AUTH_FILE), "antigravity-cli-credentials");
const require = createRequire(import.meta.url);
// Preserve Node's physical path resolver. Turbopack rewrites a direct
// require.resolve("literal") into a virtual module ID unsuitable for fs/spawn.
const resolveRuntimePackage = require.resolve.bind(require);
export function geminiInstallation(): { installed: boolean; version: string | null; entry: string | null } {
	try {
		const pkgPath = resolveRuntimePackage("@learnharness/antigravity-runtime/package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		const entry = join(dirname(pkgPath), "bin", `${process.platform}-${process.arch}`, process.platform === "win32" ? "antigravity.exe" : "antigravity");
		return { installed: pkg.version === GEMINI_CLI_VERSION && existsSync(entry), version: String(pkg.version), entry };
	} catch { return { installed: false, version: null, entry: null }; }
}

/** Only Google account OAuth. Native API, ADC, gateway and env file routing cannot leak in. */
export function geminiCliEnvironment(base: NodeJS.ProcessEnv, profileDir: string): NodeJS.ProcessEnv {
	const env = externalCliEnv(base);
	for (const name of Object.keys(env)) {
		if (/^(?:AGY_|ANTIGRAVITY_|CODE_ASSIST_|GEMINI_|GOOGLE_|GCLOUD_|VERTEX_|CLOUDSDK_|GCA_|GEMMA_|OPENAI_|ANTHROPIC_|CLAUDE_|OPENROUTER_)/.test(name)
			|| ["CLOUD_CODE_URL", "CLOUD_SHELL", "NO_BROWSER", "BROWSER", "NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE"].includes(name)) delete env[name];
	}
	// Explicit Gemini/app directories own all CLI configuration. An empty D-Bus
	// environment disables native keyring discovery, keeping OAuth in that profile.
	// Preserve HOME for the system browser, which must use the user's normal login.
	return { ...env, LH_ANTIGRAVITY_PROFILE: profileDir, DBUS_SESSION_BUS_ADDRESS: "",
		XDG_RUNTIME_DIR: join(profileDir, "runtime"), XDG_CONFIG_HOME: join(profileDir, "config"),
		XDG_CACHE_HOME: join(profileDir, "cache"), XDG_DATA_HOME: join(profileDir, "data"), NO_UPDATE_NOTIFIER: "1" };
}

/** This managed profile never merges the user's terminal CLI configuration. */
export async function prepareGeminiProfile(profileDir: string): Promise<void> {
	await mkdir(join(profileDir, ".gemini", "antigravity-cli"), { recursive: true, mode: 0o700 });
	await mkdir(join(profileDir, ".gemini", "config"), { recursive: true, mode: 0o700 });
	await mkdir(join(profileDir, "runtime"), { recursive: true, mode: 0o700 });
	await chmod(join(profileDir, "runtime"), 0o700);
	await chmod(profileDir, 0o700);
	const settings = {
		useG1Credits: false, toolPermission: "request-review", allowNonWorkspaceAccess: false,
		permissions: { allow: ["mcp(learnharness/*)"], deny: ["command", "read_file", "write_file", "read_url", "execute_url", "unsandboxed"].map((action) => `${action}(*)`) },
	};
	for (const target of [join(profileDir, ".gemini", "antigravity-cli", "settings.json")]) {
		const temporary = `${target}.${randomUUID()}.tmp`;
		await writeFile(temporary, JSON.stringify(settings), { mode: 0o600 }); await rename(temporary, target);
	}
}
export interface GeminiLaunchOptions { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; model?: string }
export type RunGemini = (options: GeminiLaunchOptions) => Promise<ChildProcessWithoutNullStreams>;
export const runBundledGemini: RunGemini = async (options) => {
	if (options.signal?.aborted) throw new Error("Antigravity CLI request was aborted.");
	const installation = geminiInstallation();
	if (!installation.installed || !installation.entry) throw new Error(`Antigravity CLI ${GEMINI_CLI_VERSION} runtime was not found or is incompatible. Reinstall application dependencies.`);
	const profile = options.env.LH_ANTIGRAVITY_PROFILE;
	if (!profile) throw new Error("Antigravity CLI requires an application-owned profile.");
	const child = spawn(installation.entry, ["acp", "--process-per-session", "--disable-telemetry", "--include-default-customizations=false", "--gemini-dir", join(profile, ".gemini"), "--app-data-dir", "antigravity-cli", "--log-file", join(options.cwd, "acp.log")], { cwd: options.cwd, env: options.env, stdio: "pipe", detached: process.platform !== "win32" });
	Object.assign(child, { learnharnessOwnedProcessGroup: process.platform !== "win32" });
	return child;
};

/** Antigravity owns its opaque OAuth storage and refreshes in the managed profile.
 * Never import Antigravity CLI's incompatible credentials or copy tokens between homes. */
export function geminiConnectionIdentity(profileDir: string): string | null {
	try {
		const raw = readFileSync(join(profileDir, "connection.json"), "utf8"), marker = JSON.parse(raw);
		return marker.backend === "antigravity" && typeof marker.authenticatedAt === "number" && Number.isFinite(marker.authenticatedAt) ? raw : null;
	} catch { return null; }
}

export function geminiCachedLogin(profileDir: string): boolean { return geminiConnectionIdentity(profileDir) !== null; }
