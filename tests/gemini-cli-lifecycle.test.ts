import assert from "node:assert/strict";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { afterEach, test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createGeminiCliStreamFunction, safeGeminiError, streamGeminiCli } from "../src/agent/gemini-cli/stream.ts";
import { geminiConnection } from "../src/agent/gemini-cli/connection.ts";
import { type RunGemini } from "../src/agent/gemini-cli/runtime.ts";
import { GEMINI_CLI_MODELS } from "../src/agent/gemini-cli/provider.ts";
const fixture = fileURLToPath(new URL("./fixtures/gemini-cli/fake-gemini.mjs", import.meta.url));
const directories: string[] = [];
const streams: ReturnType<typeof createGeminiCliStreamFunction>[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(), "lh-gemini-lifecycle-")); directories.push(dir); return dir; }
function runner(mode: string, capture?: string): RunGemini { return async (options) => spawn(process.execPath, [fixture], { cwd: options.cwd, env: { ...options.env, LH_FAKE_GEMINI_MODE: mode, ...(capture ? { LH_FAKE_CAPTURE: capture } : {}) }, stdio: "pipe" }); }
async function waitForPrompt(capture: string) { for (let i = 0; i < 100; i++) { try { if ((await readFile(capture, "utf8")).includes('"session/prompt"')) return; } catch {} await new Promise((resolve) => setTimeout(resolve, 20)); } assert.fail("fake prompt did not start"); }
const context = normalizeContext({ messages: [{ role: "user" as const, content: "Explain", timestamp: 1 }] });
afterEach(async () => { for (const stream of streams.splice(0)) await stream.dispose(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

test("M6: dispose terminates the Pi result even when CLI gracefully returns cancelled on SIGTERM", async () => {
	const profileDir = await directory(), capture = join(profileDir, "calls.jsonl");
	const stream = createGeminiCliStreamFunction({ profileDir, run: runner("graceful-wait", capture) }); streams.push(stream);
	const active = stream(GEMINI_CLI_MODELS[1]!, context, { sessionId: "graceful-dispose" });
	await waitForPrompt(capture); await stream.dispose();
	const terminal = await Promise.race([active.result().then((message) => message.stopReason), new Promise<null>((resolve) => setTimeout(() => resolve(null), 150))]);
	assert.equal(terminal, "aborted");
});

test("M7: OAuth errors redact quoted JSON keys as well as bearer and unquoted tokens", () => {
	for (const key of ["refresh_token", "access_token", "id_token", "api_key", "client_secret"]) {
		const secret = `SYNTHETIC_${key}_NOT_REAL`;
		for (const payload of [`OAuth response {"${key}":"${secret}"}`, `${key}=${secret}`, `Bearer ${secret}`]) assert(!safeGeminiError(new Error(payload)).includes(secret), key);
	}
});

test("M6: duplicated Next route modules share the same profile-owned production connection and stream", async () => {
	const otherStream = await import(new URL("../src/agent/gemini-cli/stream.ts?route-instance=other", import.meta.url).href);
	const otherConnection = await import(new URL("../src/agent/gemini-cli/connection.ts?route-instance=other", import.meta.url).href);
	assert.equal(otherStream.streamGeminiCli, streamGeminiCli); assert.equal(otherConnection.geminiConnection, geminiConnection);
});

test("M7: native opaque cache refresh survives disposable worker cleanup in the shared profile", async () => {
	const profileDir = await directory(), capture = join(profileDir, "refresh.jsonl");
	await writeFile(join(profileDir, "connection.json"), JSON.stringify({ backend: "antigravity", authenticatedAt: 1, connectionId: "original" }));
	await writeFile(join(profileDir, "native-opaque-cache.fixture"), "OFFLINE-OLD");
	let launchedProfile: string | undefined, workspace: string | undefined;
	const fake = runner("rotate-token", capture);
	const stream = createGeminiCliStreamFunction({ profileDir, run: async (options) => { launchedProfile = options.env.LH_ANTIGRAVITY_PROFILE; workspace = options.cwd; return fake(options); } }); streams.push(stream);
	const message = await stream(GEMINI_CLI_MODELS[1]!, context, { sessionId: "refresh" }).result(); assert.equal(message.stopReason, "stop");
	await stream.dispose();
	assert.equal(launchedProfile, profileDir);
	assert.notEqual(workspace, profileDir);
	assert.equal(await readFile(join(profileDir, "native-opaque-cache.fixture"), "utf8"), "OFFLINE-ROTATED-DURING-PROMPT");
	const calls = (await readFile(capture, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
	assert.equal(calls.some((call) => call.method === "authenticate"), false);
});

test("M6/M7: a delayed launch cannot resume or recreate credentials after stream disposal", async () => {
	const profileDir = await directory(), capture = join(profileDir, "late.jsonl");
	let release!: () => void, launched!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const entered = new Promise<void>((resolve) => { launched = resolve; });
	const fake = runner("text", capture);
	const stream = createGeminiCliStreamFunction({ profileDir, run: async (options) => { launched(); await gate; return fake(options); } }); streams.push(stream);
	const active = stream(GEMINI_CLI_MODELS[1]!, context, { sessionId: "late-launch" });
	await entered; await stream.dispose(); await rm(profileDir, { recursive: true, force: true }); release();
	const message = await active.result(); assert.equal(message.stopReason, "error"); assert.match(message.errorMessage ?? "", /cancelled/i);
	await assert.rejects(readFile(join(profileDir, "connection.json")), { code: "ENOENT" });
	await assert.rejects(readFile(join(profileDir, "native-opaque-cache.fixture")), { code: "ENOENT" });
});
