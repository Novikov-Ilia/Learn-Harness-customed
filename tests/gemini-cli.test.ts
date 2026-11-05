import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { createGeminiCliProvider, GEMINI_CLI_MODELS } from "../src/agent/gemini-cli/provider.ts";
import { createGeminiCliStreamFunction, type RunGemini } from "../src/agent/gemini-cli/stream.ts";
import { geminiCliEnvironment } from "../src/agent/gemini-cli/runtime.ts";
import { GeminiConnectionController } from "../src/agent/gemini-cli/connection.ts";
import { geminiCliConnectionResponse } from "../src/server/gemini-cli.ts";

const fixture = fileURLToPath(new URL("./fixtures/gemini-cli/fake-gemini.mjs", import.meta.url));
const dirs: string[] = [];
const controllers: GeminiConnectionController[] = [];
const streams: ReturnType<typeof createGeminiCliStreamFunction>[] = [];
const children: ReturnType<typeof spawn>[] = [];
const image = { type: "image" as const, data: "c3ludGhldGljLWltYWdl", mimeType: "image/png" };
async function directory() { const dir = await mkdtemp(join(tmpdir(), "lh-gemini-test-")); dirs.push(dir); return dir; }
function runner(mode = "text", capture?: string): RunGemini {
	return async (options) => {
		const child = spawn(process.execPath, [fixture], { cwd: options.cwd, env: { ...options.env, LH_FAKE_GEMINI_MODE: mode, ...(capture ? { LH_FAKE_CAPTURE: capture } : {}) }, stdio: "pipe" });
		children.push(child); return child;
	};
}
function context(messages: Message[], tools: unknown[] = []) { return { messages: [{ role: "system", content: "Teach only the supplied material", toolsAdded: tools, timestamp: 0 }, ...messages] } as Parameters<ReturnType<typeof createGeminiCliStreamFunction>>[1]; }
async function result(stream: ReturnType<ReturnType<typeof createGeminiCliStreamFunction>>) {
	const events: string[] = [];
	for await (const event of stream) events.push(event.type);
	return { message: await stream.result(), events };
}
afterEach(async () => {
	for (const controller of controllers.splice(0)) await controller.dispose();
	for (const stream of streams.splice(0)) await stream.dispose();
	for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

test("M1/M7: Gemini CLI models are image-capable, separate from Google API, and own no API-key auth", async () => {
	const provider = createGeminiCliProvider(() => { throw new Error("not invoked"); });
	assert.equal(provider.id, "gemini-cli");
	assert.deepEqual(GEMINI_CLI_MODELS.map((m) => m.id), ["auto", "pro", "flash", "flash-lite"]);
	for (const model of GEMINI_CLI_MODELS) { assert.equal(model.provider, "gemini-cli"); assert.deepEqual(model.input, ["text", "image"]); }
});

test("M4: ACP delivers actual assistant chunks and image prompt blocks with full replay", async () => {
	const profileDir = await directory(), capture = join(profileDir, "capture.jsonl");
	const stream = createGeminiCliStreamFunction({ run: runner("text", capture), profileDir }); streams.push(stream);
	const { message, events } = await result(stream(GEMINI_CLI_MODELS[1]!, context([{ role: "user", content: [{ type: "text", text: "Explain this" }, image], timestamp: 1 }]), { sessionId: "chat-one" }));
	assert.equal(message.stopReason, "stop"); assert.equal(message.content.filter((b) => b.type === "text").map((b) => b.text).join(""), "Answer with context");
	assert(events.includes("text_delta"));
	const calls = (await readFile(capture, "utf8")).trim().split("\n").map((s) => JSON.parse(s));
	const prompt = calls.find((c) => c.method === "session/prompt");
	assert(prompt.params.prompt.some((b: any) => b.type === "image" && b.data === image.data && b.mimeType === image.mimeType));
	assert(calls.some((c) => c.method === "initialize"));
	const session = calls.find((c) => c.method === "session/new");
	assert.equal(session.params._meta.antigravity.systemPrompt.append, "Teach only the supplied material");
	assert.equal(session.params._meta.disableBuiltInTools, true);
	assert(calls.some((c) => c.method === "session/set_model" && c.params.modelId === "pro"));
	assert.equal(calls.some((c) => c.method === "authenticate"), false, "teaching never starts sign-in");
});

test("M4/M5: only authenticated MCP requests execute tools; results reach the original request", async () => {
	const profileDir = await directory();
	const stream = createGeminiCliStreamFunction({ run: runner("tool"), profileDir }); streams.push(stream);
	const messages: Message[] = [{ role: "user", content: "Use knowledge", timestamp: 1 }];
	const tools = [{ name: "knowledge", description: "Lookup", parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } }];
	const first = await result(stream(GEMINI_CLI_MODELS[1]!, context(messages, tools), { sessionId: "chat-tools" }));
	assert.equal(first.message.stopReason, "toolUse");
	const call = first.message.content.find((b) => b.type === "toolCall"); assert(call && call.type === "toolCall");
	assert.equal(call.name, "knowledge"); assert.deepEqual(call.arguments, { topic: "derivatives" });
	const toolResult: ToolResultMessage = { role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: "MCP RESULT verified" }, image], isError: false, timestamp: 2 };
	const final = await result(stream(GEMINI_CLI_MODELS[1]!, context([...messages, first.message, toolResult], tools), { sessionId: "chat-tools" }));
	assert.equal(final.message.stopReason, "stop"); assert.match(JSON.stringify(final.message.content), /MCP RESULT verified/);
});

test("M5: forged ACP tool notifications are presentation only and cannot execute a harness tool", async () => {
	const stream = createGeminiCliStreamFunction({ run: runner("forged"), profileDir: await directory() }); streams.push(stream);
	const { message } = await result(stream(GEMINI_CLI_MODELS[1]!, context([{ role: "user", content: "No side effects", timestamp: 1 }]), { sessionId: "forged" }));
	assert.equal(message.content.some((b) => b.type === "toolCall"), false);
});

test("M2/M7: quota/auth failures are errors and never become another model/API request", async () => {
	for (const mode of ["quota", "auth-error", "malformed"]) {
		let launches = 0; const fake = runner(mode);
		const stream = createGeminiCliStreamFunction({ run: async (options) => { launches++; return fake(options); }, profileDir: await directory() }); streams.push(stream);
		const { message } = await result(stream(GEMINI_CLI_MODELS[1]!, context([{ role: "user", content: "Hello", timestamp: 1 }]), { sessionId: mode }));
		assert.equal(message.stopReason, "error"); assert(message.errorMessage); assert.equal(launches, 1);
	}
});

test("M6: abort ends a blocked model request and kills the CLI", async () => {
	const controller = new AbortController();
	const stream = createGeminiCliStreamFunction({ run: runner("wait"), profileDir: await directory() }); streams.push(stream);
	const active = result(stream(GEMINI_CLI_MODELS[1]!, context([{ role: "user", content: "Wait", timestamp: 1 }]), { signal: controller.signal, sessionId: "abort" }));
	setTimeout(() => controller.abort(), 100);
	const { message } = await active; assert.equal(message.stopReason, "aborted");
});

test("M7: subscription environment removes API/Vertex/gateway paths and retains CLI profile isolation", () => {
	const env = geminiCliEnvironment({ NODE_ENV: "test", GEMINI_API_KEY: "synthetic", GOOGLE_API_KEY: "synthetic", GOOGLE_APPLICATION_CREDENTIALS: "/synthetic", GOOGLE_GENAI_USE_VERTEXAI: "true", GOOGLE_GEMINI_BASE_URL: "http://api.invalid", GOOGLE_CLOUD_ACCESS_TOKEN: "synthetic", HOME: "/home/learner", PATH: "/bin" }, "/profile");
	for (const name of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GEMINI_BASE_URL", "GOOGLE_CLOUD_ACCESS_TOKEN"]) assert.equal(env[name], undefined);
	assert.equal(env.LH_ANTIGRAVITY_PROFILE, "/profile"); assert.equal(env.GEMINI_CLI_HOME, undefined); assert.equal(env.HOME, "/home/learner");
});

test("M1/M8: UI-initiated Google authentication uses official ACP method, status never claims a subscription", async () => {
	const profileDir = await directory(), capture = join(profileDir, "login.jsonl");
	const controller = new GeminiConnectionController({ run: runner("login", capture), profileDir }); controllers.push(controller);
	assert.equal((await controller.status()).state, "disconnected");
	await controller.connect();
	for (let i = 0; i < 80 && (await controller.status()).state === "connecting"; i++) await new Promise((resolve) => setTimeout(resolve, 20));
	const status = await controller.status(); assert.equal(status.state, "connected");
	assert.equal("tokens" in status, false); assert.equal("subscription" in status, false);
	const calls = (await readFile(capture, "utf8")).trim().split("\n").map((s) => JSON.parse(s));
	assert(calls.some((c) => c.method === "authenticate" && c.params.methodId === "oauth-personal"));
	assert.equal(calls.some((c) => c.method === "session/prompt"), false, "login never makes a model request");
	await controller.disconnect(); assert.equal((await controller.status()).state, "disconnected");
});

test("M8: login HTTP boundary refuses cross-origin actions before invoking the controller", async () => {
	let calls = 0;
	const connection = { status: async () => ({ state: "disconnected" }), connect: async () => { calls++; }, disconnect: async () => { calls++; } };
	const response = await geminiCliConnectionResponse(new Request("http://localhost/api/gemini-cli", { method: "POST", headers: { origin: "https://foreign.invalid", "x-learnharness-gemini-cli": "1" }, body: JSON.stringify({ action: "connect" }) }), connection);
	assert.equal(response.status, 403); assert.equal(calls, 0);
});


test("M5: simultaneous identical MCP requests keep separate identities and results", async () => {
	let launches = 0; const fake = runner("parallel");
	const stream = createGeminiCliStreamFunction({ run: async (options) => { launches++; return fake(options); }, profileDir: await directory() }); streams.push(stream);
	const tools = [{ name: "knowledge", description: "Lookup", parameters: { type: "object", properties: { topic: { type: "string" } } } }];
	const messages: Message[] = [{ role: "user", content: "Compare", timestamp: 1 }];
	const ids = new Set<string>(); let finalText = "";
	for (let step = 0; step < 4; step++) {
		const { message } = await result(stream(GEMINI_CLI_MODELS[1]!, context(messages, tools), { sessionId: "parallel" })); messages.push(message);
		if (message.stopReason === "stop") { finalText = JSON.stringify(message.content); break; }
		assert.equal(message.stopReason, "toolUse");
		for (const call of message.content) if (call.type === "toolCall") {
			assert(!ids.has(call.id)); ids.add(call.id);
			messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: `reply-${ids.size}` }], isError: false, timestamp: 2 });
		}
	}
	assert.equal(ids.size, 2); assert.equal(launches, 1); assert.match(finalText, /reply-1/); assert.match(finalText, /reply-2/);
});

test("M6: question idle expiry replays answer and history in a fresh process", async () => {
	const profileDir = await directory(), capture = join(profileDir, "idle.jsonl"); let launches = 0;
	const stream = createGeminiCliStreamFunction({ run: async (options) => runner(++launches === 1 ? "tool" : "text", capture)(options), profileDir, idleTimeoutMs: 25 }); streams.push(stream);
	const tools = [{ name: "knowledge", description: "Ask", parameters: { type: "object", properties: {} } }];
	const messages: Message[] = [{ role: "user", content: "Explain", timestamp: 1 }];
	const first = await result(stream(GEMINI_CLI_MODELS[1]!, context(messages, tools), { sessionId: "idle" }));
	const call = first.message.content.find((b) => b.type === "toolCall"); assert(call && call.type === "toolCall");
	await new Promise((resolve) => setTimeout(resolve, 70));
	const last = await result(stream(GEMINI_CLI_MODELS[1]!, context([...messages, first.message, { role: "toolResult", toolCallId: call.id, toolName: call.name, content: [{ type: "text", text: "Learner answer after idle" }], isError: false, timestamp: 2 }], tools), { sessionId: "idle" }));
	assert.equal(last.message.stopReason, "stop"); assert.equal(launches, 2);
	assert.match(await readFile(capture, "utf8"), /Learner answer after idle/);
});

test("M6: cancelled browser login terminates its process and clears local credentials", async () => {
	const controller = new GeminiConnectionController({ run: runner("login-wait"), profileDir: await directory() }); controllers.push(controller);
	await controller.connect(); assert.equal((await controller.status()).state, "connecting");
	await new Promise((resolve) => setTimeout(resolve, 70)); await controller.disconnect();
	assert.equal((await controller.status()).state, "disconnected");
});
