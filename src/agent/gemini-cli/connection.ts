import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { emit } from "../../core/events.ts";
import type { GeminiCliStatus } from "../../core/contracts/gemini-cli.ts";
import { geminiAcp, bounded, stopGemini } from "./acp.ts";
import { geminiCliEnvironment, geminiProfileDir, geminiInstallation, geminiCachedLogin, prepareGeminiProfile, runBundledGemini, type RunGemini } from "./runtime.ts";
import { safeGeminiError } from "./stream.ts";

/** Starts the official CLI's browser OAuth flow. No OAuth implementation/token parsing here. */
export class GeminiConnectionController {
	private state: "disconnected" | "connecting" | "error" = "disconnected";
	private error?: string;
	private child?: ChildProcessWithoutNullStreams;
	private pending?: Promise<void>;
	private generation = 0;
	readonly profileDir: string;
	private run: RunGemini;
	constructor(options: { run?: RunGemini; profileDir?: string } = {}) { this.run = options.run ?? runBundledGemini; this.profileDir = options.profileDir ?? geminiProfileDir; }
	private marker() { return join(this.profileDir, "connection.json"); }
	/** A successful cached OAuth login is not a live subscription/quota probe. */
	connected(): boolean { return geminiCachedLogin(this.profileDir); }
	async status(): Promise<GeminiCliStatus> {
		const installation = geminiInstallation();
		const base = { installed: installation.installed, version: installation.version };
		if (!installation.installed) return { ...base, state: "unavailable", error: "Antigravity CLI runtime was not found or does not match the supported version." };
		if (this.state === "connecting") return { ...base, state: "connecting" };
		if (this.state === "error") return { ...base, state: "error", error: this.error };
		if (this.connected()) return { ...base, state: "connected", authenticatedAt: JSON.parse(readFileSync(this.marker(), "utf8")).authenticatedAt };
		return { ...base, state: "disconnected" };
	}
	async connect(): Promise<void> {
		if (this.pending) return;
		if (!geminiInstallation().installed) throw new Error("Antigravity CLI runtime was not found.");
		const generation = ++this.generation; this.state = "connecting"; this.error = undefined; emit("subscriptions-changed", {});
		this.pending = (async () => {
			let cwd: string | undefined; let child: ChildProcessWithoutNullStreams | undefined;
			try {
				await prepareGeminiProfile(this.profileDir);
				cwd = await mkdtemp(join(tmpdir(), "learnharness-gemini-login-"));
				if (generation !== this.generation) return;
				child = await this.run({ cwd, env: geminiCliEnvironment(process.env, this.profileDir) }); this.child = child;
				if (generation !== this.generation) return;
				const acp = geminiAcp(child, () => {});
				child.on("error", () => { if (generation === this.generation) { this.state = "error"; this.error = "Antigravity CLI login process could not start."; } });
				const initialization = await bounded(acp.initialize(), 20_000, "Antigravity CLI initialization timed out.");
				if (!initialization.authMethods?.some((method) => method.id === "oauth-personal")) throw new Error("Antigravity CLI does not expose Google account authentication.");
				// ACP opens the browser and owns localhost callback, state, token exchange and storage.
				await bounded(acp.request(acp.connection.authenticate({ methodId: "oauth-personal" })), 6 * 60_000, "Google login timed out. Try connecting again.");
				if (generation !== this.generation) return;
				// Successful ACP authentication is authoritative. Antigravity owns its
				// opaque cache; legacy Gemini OAuth files cannot establish a connection.
				const temp = `${this.marker()}.tmp`; await writeFile(temp, JSON.stringify({ backend: "antigravity", authenticatedAt: Date.now(), connectionId: randomUUID() }), { mode: 0o600 }); await rename(temp, this.marker());
				this.state = "disconnected";
			} catch (error) { if (generation === this.generation) { this.state = "error"; this.error = safeGeminiError(error); } }
			finally { if (child) await stopGemini(child); if (cwd) await rm(cwd, { recursive: true, force: true }); if (generation === this.generation) { this.child = undefined; this.pending = undefined; emit("subscriptions-changed", {}); } }
		})();
	}
	async disconnect() { this.generation++; const child = this.child; this.child = undefined; if (child) await stopGemini(child); await this.pending; this.pending = undefined; await rm(this.profileDir, { recursive: true, force: true }); this.state = "disconnected"; this.error = undefined; emit("subscriptions-changed", {}); }
	async dispose() { this.generation++; if (this.child) await stopGemini(this.child); await this.pending; this.pending = undefined; this.child = undefined; }
}
const CONNECTION_REGISTRY = Symbol.for("learnharness.gemini-cli.connection-registry.v1");
const processGlobals = globalThis as unknown as Record<symbol, unknown>;
const connectionRegistry = (processGlobals[CONNECTION_REGISTRY] ??= new Map<string, GeminiConnectionController>()) as Map<string, GeminiConnectionController>;
if (!connectionRegistry.has(geminiProfileDir)) connectionRegistry.set(geminiProfileDir, new GeminiConnectionController());
export const geminiConnection = connectionRegistry.get(geminiProfileDir)!;
