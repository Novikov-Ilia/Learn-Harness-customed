import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const dir = mkdtempSync(join(tmpdir(), "lh-gemini-catalog-"));
process.env.LH_DATA_DIR = join(dir, "data"); process.env.LH_AUTH_FILE = join(dir, "auth.json");
const { providerKeyPresent } = await import("../src/server/keys.ts");
const { modelCatalog, toModelDto, validateChatSettings, catalogContextLimits } = await import("../src/server/model-catalog.ts");
const { callCost } = await import("../src/server/pricing.ts");
const { piEngineForSpec, piModels } = await import("../src/agent/models.ts");
const { GEMINI_CLI_MODELS } = await import("../src/agent/gemini-cli/provider.ts");
const { geminiProfileDir } = await import("../src/agent/gemini-cli/runtime.ts");
after(() => { rmSync(dir, { recursive: true, force: true }); });

test("M1/M3/M7: catalog admission needs explicit cached Google login; all model roles share the provider engine", () => {
	assert.equal(providerKeyPresent("gemini-cli"), false);
	assert.equal(modelCatalog().models.some((model) => model.provider === "gemini-cli"), false);
	assert.equal(validateChatSettings({ model: { provider: "gemini-cli", id: "pro" } }).ok, false);
	mkdirSync(join(geminiProfileDir, ".gemini"), { recursive: true });
	// Retired Gemini credentials alone cannot admit the new provider.
	writeFileSync(join(geminiProfileDir, ".gemini", "oauth_creds.json"), '{"refresh_token":"OFFLINE-FIXTURE-NOT-A-CREDENTIAL"}', { mode: 0o600 });
	assert.equal(providerKeyPresent("gemini-cli"), false);
	writeFileSync(join(geminiProfileDir, "connection.json"), JSON.stringify({ backend: "antigravity", authenticatedAt: Date.now() }), { mode: 0o600 });
	assert.equal(providerKeyPresent("gemini-cli"), true);
	assert.equal(modelCatalog().models.filter((model) => model.provider === "gemini-cli").length, 4);
	assert.equal(validateChatSettings({ model: { provider: "gemini-cli", id: "pro" } }).ok, true);
	assert(piModels().getProvider("gemini-cli"));
	// Conversation agents, planner and independently resolved background roles all
	// receive this same provider-aware engine factory, without a network call here.
	for (const id of ["auto", "pro", "flash", "flash-lite"]) assert.equal(piEngineForSpec({ provider: "gemini-cli", id }).model.provider, "gemini-cli");
	rmSync(join(geminiProfileDir, "connection.json"));
	assert.equal(providerKeyPresent("gemini-cli"), false);
	assert.equal(modelCatalog().models.some((model) => model.provider === "gemini-cli"), false);
});

test("M7: placeholder token limits and costs never become a displayed price/limit", () => {
	for (const model of GEMINI_CLI_MODELS) {
		const dto = toModelDto(model); assert.equal(dto.cost, null); assert.equal(dto.contextWindow, null); assert.equal(dto.maxTokens, null);
		assert.equal(callCost({ inputTokens: 10, outputTokens: 5 }, `gemini-cli:${model.id}`), null);
		assert.equal(catalogContextLimits().has(`gemini-cli:${model.id}`), false);
	}
});
