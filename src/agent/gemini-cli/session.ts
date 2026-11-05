import type { NewSessionRequest, NewSessionResponse } from "@agentclientprotocol/sdk";
import { bounded, type geminiAcp } from "./acp.ts";

/** Official Antigravity ACP extensions, pinned to the bundled runtime. */
export function antigravitySession(cwd: string, bridge: { httpUrl: string; headers: Record<string, string> }, instructions: string): NewSessionRequest {
	return { cwd, mcpServers: [{ type: "http", name: "learnharness", url: bridge.httpUrl,
		headers: Object.entries(bridge.headers).map(([name, value]) => ({ name, value })),
		_meta: { antigravity: { forceAllToolsEager: true } } }],
		_meta: { disableBuiltInTools: true, antigravity: { eagerMcpServers: true, systemPrompt: { append: instructions } } } };
}

/** Preserve saved LearnHarness aliases, using only models advertised by the account.
 * Unsupported aliases fail explicitly; there is no API or model fallback. */
export async function selectAntigravityModel(acp: ReturnType<typeof geminiAcp>, session: NewSessionResponse, requested: string): Promise<void> {
	if (requested === "auto") return;
	const picker = session.configOptions?.find((option) => option.category === "model" || option.id === "model");
	const options = picker?.type === "select" ? picker.options.flatMap((option) => "options" in option ? option.options : [option]) : [];
	const models = session.models?.availableModels ?? options.map((option) => ({ modelId: option.value, name: option.name }));
	const exact = models.find((model) => model.modelId === requested);
	const family = models.find((model) => {
		const label = `${model.modelId} ${model.name}`.toLowerCase();
		if (!label.includes("gemini") && !["pro", "flash", "flash-lite"].includes(model.modelId)) return false;
		return requested === "pro" ? /\bpro\b/.test(label) : requested === "flash" ? /\bflash\b/.test(label) && !/lite/.test(label) : requested === "flash-lite" ? /flash.*lite/.test(label) : false;
	});
	const selected = exact ?? family;
	if (!selected) throw new Error(`Your Antigravity account does not offer the requested Gemini model (${requested}). Select another model in Settings.`);
	if (picker) await bounded(acp.request(acp.connection.setSessionConfigOption({ sessionId: session.sessionId, configId: picker.id, value: selected.modelId })), 15_000, "Antigravity model selection timed out.");
	else await bounded(acp.request(acp.connection.unstable_setSessionModel({ sessionId: session.sessionId, modelId: selected.modelId })), 15_000, "Antigravity model selection timed out.");
}
