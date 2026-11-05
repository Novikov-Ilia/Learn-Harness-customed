import { createProvider, type Api, type Model, type StreamFunction } from "@earendil-works/pi-ai";
import { GEMINI_CLI_PROVIDER } from "../../core/contracts/gemini-cli.ts";
const shared = {
	api: "gemini-cli-acp", provider: GEMINI_CLI_PROVIDER, baseUrl: "", input: ["text", "image"],
	// Required engine placeholders. Catalog/pricing hide them: CLI billing is unknown.
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000, maxTokens: 65_536,
	// CLI aliases own reasoning. Do not advertise an unsupported effort setting.
	reasoning: false,
} satisfies Omit<Model<Api>, "id" | "name">;
export const GEMINI_CLI_MODELS: Model<Api>[] = [
	{ ...shared, id: "auto", name: "Gemini Auto (Antigravity CLI)" },
	{ ...shared, id: "pro", name: "Gemini Pro (Antigravity CLI)" },
	{ ...shared, id: "flash", name: "Gemini Flash (Antigravity CLI)" },
	{ ...shared, id: "flash-lite", name: "Gemini Flash Lite (Antigravity CLI)" },
];
export function createGeminiCliProvider(stream: StreamFunction) {
	return createProvider({ id: GEMINI_CLI_PROVIDER, name: "Gemini (Antigravity CLI)", models: GEMINI_CLI_MODELS,
		auth: { apiKey: { name: "Google login (Antigravity CLI)", resolve: async () => ({ auth: {}, source: "Antigravity CLI Google login" }) } },
		api: { stream, streamSimple: stream },
	});
}
