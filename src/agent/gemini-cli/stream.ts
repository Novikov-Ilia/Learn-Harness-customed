import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type AssistantMessageEventStream, type Message, type Model, type StreamFunction, type ToolResultMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import type { ClientSideConnection, PromptResponse, SessionNotification } from "@agentclientprotocol/sdk";
import { geminiAcp, bounded, stopGemini } from "./acp.ts";
import { geminiCliEnvironment, geminiProfileDir, prepareGeminiProfile, geminiCachedLogin, runBundledGemini, type RunGemini } from "./runtime.ts";
import { antigravitySession, selectAntigravityModel } from "./session.ts";
import { geminiReplay } from "./transcript.ts";
import { createGeminiToolBridge, type GeminiToolCall } from "./tool-bridge.ts";
import { conversationForReuse } from "../claude-code/reuse-context.ts";
export type { RunGemini } from "./runtime.ts";

function outputFor(model: Model<Api>): AssistantMessage { return { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: "pending", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }; }
class GeminiTurn {
	output: AssistantMessage;
	finished = false;
	constructor(readonly stream: AssistantMessageEventStream, model: Model<Api>) { this.output = outputFor(model); stream.push({ type: "start", partial: this.output }); }
	text(text: string, thinking = false) {
		if (this.finished || !text) return;
		const type = thinking ? "thinking" : "text";
		let index = this.output.content.findIndex((part) => part.type === type);
		if (index < 0) { index = this.output.content.length; this.output.content.push(thinking ? { type: "thinking", thinking: "" } : { type: "text", text: "" }); this.stream.push({ type: thinking ? "thinking_start" : "text_start", contentIndex: index, partial: this.output }); }
		const block = this.output.content[index]!;
		if (block.type === "text") block.text += text; else if (block.type === "thinking") block.thinking += text;
		this.stream.push({ type: thinking ? "thinking_delta" : "text_delta", contentIndex: index, delta: text, partial: this.output });
	}
	tools(calls: GeminiToolCall[]) { for (const call of calls) { const index = this.output.content.length; this.output.content.push({ type: "toolCall", ...call }); this.stream.push({ type: "toolcall_start", contentIndex: index, partial: this.output }); this.stream.push({ type: "toolcall_end", contentIndex: index, toolCall: { type: "toolCall", ...call }, partial: this.output }); } this.finish("toolUse"); }
	finish(reason: "stop" | "toolUse" | "length" = "stop", response?: PromptResponse) {
		if (this.finished) return; this.finished = true;
		const usage = response?.usage;
		if (usage) { const cached = usage.cachedReadTokens ?? 0; this.output.usage.input = Math.max(0, usage.inputTokens - cached); this.output.usage.cacheRead = cached; this.output.usage.output = usage.outputTokens + (usage.thoughtTokens ?? 0); this.output.usage.totalTokens = this.output.usage.input + cached + this.output.usage.output; }
		this.output.content.forEach((block, index) => { if (block.type === "text") this.stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: this.output }); if (block.type === "thinking") this.stream.push({ type: "thinking_end", contentIndex: index, content: block.thinking, partial: this.output }); });
		this.output.stopReason = reason; this.stream.push({ type: "done", reason, message: this.output }); this.stream.end();
	}
	fail(error: unknown, aborted = false) { if (this.finished) return; this.finished = true; this.output.stopReason = aborted ? "aborted" : "error"; this.output.errorMessage = aborted ? "Antigravity CLI request was aborted." : safeGeminiError(error); this.stream.push({ type: "error", reason: this.output.stopReason, error: this.output }); this.stream.end(); }
}
/** Never send diagnostic URLs, bearer credentials or raw process output to the UI. */
export function safeGeminiError(error: unknown): string {
	let text: string;
	if (error instanceof Error) text = error.message;
	else if (typeof error === "string") text = error;
	else if (error && typeof error === "object") {
		// ACP rejects requests with JSON-RPC objects, not Error instances. Only
		// extract diagnostic text; serializing data could expose OAuth credentials.
		const { message, data } = error as { message?: unknown; data?: unknown };
		const details = data && typeof data === "object" ? data as { details?: unknown; message?: unknown } : undefined;
		const detail = typeof data === "string" ? data : typeof details?.details === "string" ? details.details : typeof details?.message === "string" ? details.message : undefined;
		text = [...new Set([message, detail].filter((value): value is string => typeof value === "string" && value.length > 0))].join(": ") || "Unknown error.";
	} else text = "Unknown error.";
	return `Antigravity CLI: ${text
		.replace(/https?:\/\/\S+/g, "[URL omitted]")
		.replace(/\bBearer\s+[^\s,\"'}]+/gi, "[credential omitted]")
		.replace(/(["']?(?:access_?token|refresh_?token|id_?token|api_?key|client_?secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi, "$1[credential omitted]")
		.slice(0, 700)}`;
}

interface ActiveProcess {
	child: ChildProcessWithoutNullStreams; connection: ClientSideConnection; sessionId: string;
	bridge: Awaited<ReturnType<typeof createGeminiToolBridge>>; cwd: string;
	turn: GeminiTurn; admitted: GeminiToolCall[]; history: unknown[]; config: unknown; identity?: string;
	idle?: NodeJS.Timeout; timeout?: NodeJS.Timeout; signal?: AbortSignal; abort?: () => void; closed: boolean;
}
export function createGeminiCliStreamFunction({ run = runBundledGemini, profileDir = geminiProfileDir, idleTimeoutMs = 10 * 60_000, requestTimeoutMs = 30 * 60_000 }: { run?: RunGemini; profileDir?: string; idleTimeoutMs?: number; requestTimeoutMs?: number } = {}) {
	let epoch = 0;
	const active = new Set<ActiveProcess>();
	const pendingCleanup = new Set<Promise<void>>();
	const stop = async (process: ActiveProcess) => {
		if (process.closed) return; process.turn.fail(new Error("Antigravity CLI run was stopped."), true); process.closed = true; active.delete(process); clearTimeout(process.idle); clearTimeout(process.timeout);
		if (process.abort) process.signal?.removeEventListener("abort", process.abort);
		await Promise.allSettled([stopGemini(process.child), process.bridge.close()]);
		await rm(process.cwd, { recursive: true, force: true });
	};
	const retire = (process: ActiveProcess) => { const cleanup = stop(process); pendingCleanup.add(cleanup); void cleanup.catch(() => console.error("Antigravity CLI cleanup or cached credential refresh could not be completed.")).finally(() => pendingCleanup.delete(cleanup)); };
	const configureSignal = (process: ActiveProcess, signal?: AbortSignal) => {
		if (process.abort) process.signal?.removeEventListener("abort", process.abort);
		process.signal = signal;
		process.abort = () => { process.turn.fail(new Error("aborted"), true); void process.connection.cancel({ sessionId: process.sessionId }).catch(() => {}); retire(process); };
		signal?.addEventListener("abort", process.abort, { once: true }); if (signal?.aborted) process.abort();
	};
	const admit = (process: ActiveProcess) => {
		if (process.closed || process.turn.finished) return;
		const calls = process.bridge.take(); if (!calls.length) return;
		process.admitted = calls;
		process.turn.tools(calls);
		process.history = [...process.history, { role: "assistant", content: structuredClone(process.turn.output.content) }];
		clearTimeout(process.timeout); process.idle = setTimeout(() => retire(process), idleTimeoutMs); process.idle.unref();
		if (!process.identity) retire(process);
	};
	const stream: StreamFunction = (model, context, options) => {
		const admittedEpoch = epoch;
		const events = createAssistantMessageEventStream(); const turn = new GeminiTurn(events, model);
		void (async () => {
			if (options?.signal?.aborted) { turn.fail(new Error("aborted"), true); return; }
			const history = conversationForReuse(context.messages);
			const config = JSON.parse(JSON.stringify({ model: model.id, system: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages) }));
			const results = context.messages.filter((message): message is ToolResultMessage => message.role === "toolResult");
			let held = [...active].find((candidate) => !candidate.closed && !!options?.sessionId && candidate.identity === options.sessionId && candidate.admitted.length > 0
				&& isDeepStrictEqual(candidate.config, config) && history.length === candidate.history.length + candidate.admitted.length
				&& isDeepStrictEqual(history.slice(0, candidate.history.length), candidate.history)
				&& candidate.admitted.every((call) => results.some((result) => result.toolCallId === call.id && result.toolName === call.name)));
			if (held) {
				clearTimeout(held.idle); held.timeout = setTimeout(() => { held!.turn.fail(new Error("Antigravity CLI request timed out.")); retire(held!); }, requestTimeoutMs); held.timeout.unref(); held.turn = turn; held.history = structuredClone(history); configureSignal(held, options?.signal);
				const admitted = held.admitted; held.admitted = [];
				for (const call of admitted) held.bridge.resolve(call, results.find((result) => result.toolCallId === call.id)!);
				admit(held); return;
			}
			// A changed history/model owns a fresh process. Retire incompatible held work
			// from this adapter/session instead of letting it execute after a replacement.
			for (const candidate of active) if (candidate.identity && candidate.identity === options?.sessionId) retire(candidate);
			const cwd = await mkdtemp(join(tmpdir(), "learnharness-gemini-"));
			let bridge: Awaited<ReturnType<typeof createGeminiToolBridge>> | undefined; let child: ChildProcessWithoutNullStreams | undefined;
			try {
				await prepareGeminiProfile(profileDir);
				if (admittedEpoch !== epoch || options?.signal?.aborted) throw new Error("Gemini request was cancelled before launch.");
				const tools = getCurrentTools(context.messages);
				bridge = await createGeminiToolBridge(tools, () => { if (held) queueMicrotask(() => admit(held!)); });
				const env = geminiCliEnvironment(process.env, profileDir);
				child = await run({ cwd, env, model: model.id, signal: options?.signal });
				if (admittedEpoch !== epoch || options?.signal?.aborted) throw new Error("Antigravity request was cancelled during launch.");
				if (admittedEpoch !== epoch || options?.signal?.aborted) throw new Error("Gemini request was cancelled during launch.");
				const acp = geminiAcp(child, (notification: SessionNotification) => {
					if (!held || held.closed || notification.sessionId !== held.sessionId) return;
					const update = notification.update;
					if ((update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") && update.content.type === "text") held.turn.text(update.content.text, update.sessionUpdate === "agent_thought_chunk");
				});
				held = { child, connection: acp.connection, sessionId: "", bridge, cwd, turn, admitted: [], history: structuredClone(history), config, identity: options?.sessionId, closed: false };
				const processState = held; active.add(processState); configureSignal(processState, options?.signal);
				child.once("error", () => { processState.turn.fail(new Error("Gemini process could not start.")); retire(processState); });
				void acp.connection.closed.then(() => { if (!processState.closed) { processState.turn.fail(new Error("Antigravity CLI connection closed before its response.")); retire(processState); } });
				const initialization = await bounded(acp.initialize(), 20_000, "Antigravity CLI initialization timed out.");
				if (!initialization.authMethods?.some((method) => method.id === "oauth-personal") || !initialization.agentCapabilities?.promptCapabilities?.image) throw new Error("The installed Antigravity CLI lacks the required Google OAuth/image ACP capabilities.");
				// session/new reuses the CLI's cached login. Never authenticate during a
				// teaching turn: expired credentials must not open a browser implicitly.
				const session = await bounded(acp.request(acp.connection.newSession(antigravitySession(cwd, bridge.config, getCurrentSystemPrompt(context.messages)))), 30_000, "Antigravity session could not start. Reconnect your Google account in Settings → Providers.");
				processState.sessionId = session.sessionId;
				await selectAntigravityModel(acp, session, model.id);
				processState.timeout = setTimeout(() => { processState.turn.fail(new Error("Antigravity CLI request timed out.")); retire(processState); }, requestTimeoutMs); processState.timeout.unref();
				void acp.request(acp.connection.prompt({ sessionId: session.sessionId, prompt: geminiReplay(context.messages) })).then((response) => {
					if (processState.closed) return;
					if (processState.admitted.length || processState.turn.finished) { processState.turn.fail(new Error("Antigravity CLI completed while tool calls were unresolved.")); retire(processState); return; }
					if (response.stopReason === "cancelled") processState.turn.fail(new Error("aborted"), true);
					else if (["max_tokens", "max_turn_requests"].includes(response.stopReason)) processState.turn.finish("length", response);
					else if (response.stopReason === "end_turn") processState.turn.finish("stop", response);
					else processState.turn.fail(new Error(`Antigravity CLI stopped: ${response.stopReason}`));
					retire(processState);
				}).catch((error) => { processState.turn.fail(error, options?.signal?.aborted); retire(processState); });
			} catch (error) {
				turn.fail(error, options?.signal?.aborted);
				if (held) retire(held); else { if (child) await stopGemini(child); await bridge?.close(); await rm(cwd, { recursive: true, force: true }); }
			}
		})().catch((error) => turn.fail(error, options?.signal?.aborted));
		return events;
	};
	return Object.assign(stream, { async dispose() { epoch++; await Promise.all([...active].map(stop)); await Promise.allSettled([...pendingCleanup]); } });
}
// Next route bundles can instantiate this module more than once. Keep the
// production owner shared across bundles so Disconnect sees chat-route work.
const STREAM_REGISTRY = Symbol.for("learnharness.gemini-cli.stream-registry.v1");
const processGlobals = globalThis as unknown as Record<symbol, unknown>;
const streamRegistry = (processGlobals[STREAM_REGISTRY] ??= new Map<string, ReturnType<typeof createGeminiCliStreamFunction>>()) as Map<string, ReturnType<typeof createGeminiCliStreamFunction>>;
if (!streamRegistry.has(geminiProfileDir)) streamRegistry.set(geminiProfileDir, createGeminiCliStreamFunction({ run: async (options) => {
	if (!geminiCachedLogin(geminiProfileDir)) throw new Error("Connect your Google account in Settings → Providers before using Antigravity CLI.");
	return runBundledGemini(options);
} }));
export const streamGeminiCli = streamRegistry.get(geminiProfileDir)!;
