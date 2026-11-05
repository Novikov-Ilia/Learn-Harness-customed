import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { JsonObject, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
export interface GeminiToolCall { id: string; name: string; arguments: JsonObject }
/** IDs belong to authenticated MCP requests. ACP tool notifications grant no authority. */
export async function createGeminiToolBridge(tools: Tool[], onCall: () => void, onDiscovery?: () => void) {
	const pending = new Map<GeminiToolCall, (result: CallToolResult) => void>();
	const queue: GeminiToolCall[] = [];
	const bearer = `Bearer ${randomBytes(32).toString("hex")}`;
	const expected = Buffer.from(bearer);
	const server = new Server({ name: "learnharness", version: "1.0.0" }, { capabilities: { tools: {} } });
	server.setRequestHandler(ListToolsRequestSchema, () => { onDiscovery?.(); return { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })) }; });
	server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
		if (!tools.some((tool) => tool.name === request.params.name)) throw new McpError(ErrorCode.InvalidParams, "Undeclared LearnHarness tool");
		const call: GeminiToolCall = { id: randomUUID(), name: request.params.name, arguments: (request.params.arguments ?? {}) as JsonObject };
		return new Promise<CallToolResult>((resolve) => {
			const cancel = () => { queue.splice(queue.indexOf(call), queue.includes(call) ? 1 : 0); settle({ content: [{ type: "text", text: "Gemini MCP request cancelled" }], isError: true }); };
			const settle = (value: CallToolResult) => { pending.delete(call); extra.signal.removeEventListener("abort", cancel); resolve(value); };
			pending.set(call, settle); queue.push(call);
			extra.signal.addEventListener("abort", cancel, { once: true });
			if (extra.signal.aborted) cancel(); else onCall();
		});
	});
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
	await server.connect(transport);
	const http = createServer((request, response) => {
		const actual = Buffer.from(request.headers.authorization ?? "");
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { response.writeHead(401).end(); return; }
		void transport.handleRequest(request, response).catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
	});
	try { await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(0, "127.0.0.1", resolve); }); }
	catch (error) { await server.close(); throw error; }
	const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
	let closed = false;
	return {
		config: { httpUrl: url, headers: { Authorization: bearer }, trust: true, timeout: 30 * 60_000 },
		take(): GeminiToolCall[] { return queue.splice(0); },
		resolve(call: GeminiToolCall, result: ToolResultMessage) { pending.get(call)?.({ content: result.content.map((part) => ({ ...part })), isError: result.isError }); },
		async close() {
			if (closed) return; closed = true;
			for (const settle of pending.values()) settle({ content: [{ type: "text", text: "LearnHarness Gemini bridge closed" }], isError: true });
			queue.length = 0; await server.close(); http.closeAllConnections();
			await new Promise<void>((resolve) => http.close(() => resolve()));
		},
	};
}
