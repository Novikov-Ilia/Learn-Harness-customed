import assert from "node:assert/strict";
import { test } from "node:test";
import { selectAntigravityModel } from "../src/agent/gemini-cli/session.ts";

function client() {
	const calls: unknown[] = [];
	const acp = { request: (operation: Promise<unknown>) => operation, connection: {
		setSessionConfigOption: async (params: unknown) => { calls.push(params); },
		unstable_setSessionModel: async (params: unknown) => { calls.push(params); },
	} } as unknown as Parameters<typeof selectAntigravityModel>[0];
	return { acp, calls };
}

test("Antigravity model aliases select only advertised Gemini families through native config options", async () => {
	const { acp, calls } = client();
	const session = { sessionId: "native-session", configOptions: [{ id: "model", type: "select" as const, name: "Model", category: "model" as const, currentValue: "gemini-3.8-flash", options: [
		{ value: "claude-opus", name: "Claude Opus" }, { value: "gemini-4-pro", name: "Gemini 4 Pro" }, { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
	] }] };
	await selectAntigravityModel(acp, session, "pro");
	await selectAntigravityModel(acp, session, "flash");
	assert.deepEqual(calls, [{ sessionId: "native-session", configId: "model", value: "gemini-4-pro" }, { sessionId: "native-session", configId: "model", value: "gemini-3.8-flash" }]);
});

test("Antigravity auto keeps native choice and unavailable aliases fail without selecting a substitute", async () => {
	const { acp, calls } = client();
	const session = { sessionId: "native-session", models: { currentModelId: "gemini-flash", availableModels: [{ modelId: "gemini-flash", name: "Gemini Flash" }] } };
	await selectAntigravityModel(acp, session, "auto");
	await assert.rejects(selectAntigravityModel(acp, session, "flash-lite"), /does not offer.*flash-lite/);
	assert.deepEqual(calls, []);
});
