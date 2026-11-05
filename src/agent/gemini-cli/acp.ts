import { Readable, Writable, Transform } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type SessionNotification } from "@agentclientprotocol/sdk";

/** Official ACP SDK owns framing, schema validation and request correlation. */
export function geminiAcp(child: ChildProcessWithoutNullStreams, onUpdate: (notification: SessionNotification) => void) {
	// Do not log stderr: CLI auth diagnostics can contain OAuth URLs. Surface bounded errors instead.
	child.stderr.resume();
	const terminated = new Promise<never>((_, reject) => {
		child.once("error", () => reject(new Error("Antigravity CLI process could not start.")));
		child.once("close", () => reject(new Error("Antigravity CLI process closed before its response.")));
	});
	void terminated.catch(() => {});
	const request = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, terminated]);
	child.stdin.on("error", () => {});
	// SDK's default parser logs and skips invalid lines. Validate first so a broken
	// child fails promptly without logging auth-bearing diagnostics or buffering forever.
	let pending = "";
	const decoder = new TextDecoder();
	const guard = new Transform({ transform(chunk, _encoding, callback) {
		try {
			pending += decoder.decode(chunk, { stream: true });
			if (pending.length > 16 * 1024 * 1024) throw new Error("Gemini ACP message exceeds the supported limit.");
			let newline: number;
			while ((newline = pending.indexOf("\n")) >= 0) {
				const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
				if (line.trim()) { JSON.parse(line); this.push(line + "\n"); }
			}
			callback();
		} catch { child.kill("SIGTERM"); callback(new Error("Antigravity CLI emitted malformed ACP output.")); }
	}, flush(callback) { if (pending.trim()) callback(new Error("Antigravity CLI emitted incomplete ACP output.")); else callback(); } });
	child.stdout.pipe(guard);
	const connection = new ClientSideConnection(() => ({
		sessionUpdate: async (notification) => onUpdate(notification),
		// Built-ins are absent. Unexpected permission requests fail closed; LearnHarness
		// MCP tools are trusted explicitly in the isolated workspace config.
		requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
	}), ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(guard) as ReadableStream<Uint8Array>));
	return { connection, request, initialize: () => request(connection.initialize({ protocolVersion: PROTOCOL_VERSION,
		clientInfo: { name: "learnharness", version: "0.4.1" }, clientCapabilities: {} })) };
}

export function bounded<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timer: NodeJS.Timeout;
	return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); timer.unref(); })]).finally(() => clearTimeout(timer));
}

export async function stopGemini(child: ChildProcessWithoutNullStreams): Promise<void> {
	// Antigravity's process-per-session mode owns worker children. Stop the
	// explicitly isolated native process group; injected test runners stay local.
	const group = (child as ChildProcessWithoutNullStreams & { learnharnessOwnedProcessGroup?: boolean }).learnharnessOwnedProcessGroup;
	const signal = (value: NodeJS.Signals) => {
		if (group && child.pid) { try { process.kill(-child.pid, value); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
		else child.kill(value);
	};
	if (child.exitCode !== null || child.signalCode !== null) { if (group) signal("SIGKILL"); return; }
	signal("SIGTERM");
	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => { signal("SIGKILL"); resolve(); }, 1000);
		child.once("close", () => { clearTimeout(timer); resolve(); });
	});
	if (group) signal("SIGKILL");
}
