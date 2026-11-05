import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GeminiConnectionController } from "../src/agent/gemini-cli/connection.ts";
import { safeGeminiError } from "../src/agent/gemini-cli/stream.ts";

test("Gemini ACP account rejection shows Google's message instead of object coercion", () => {
	const message = "This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google.";
	assert.equal(safeGeminiError({ code: -32000, message }), `Antigravity CLI: ${message.replace(/https?:\/\/\S+/g, "[URL omitted]")}`);
});

test("Gemini ACP internal errors retain textual details without serializing arbitrary data", () => {
	assert.equal(safeGeminiError({ code: -32603, message: "Internal error", data: { details: "Google authentication failed", privateValue: "SYNTHETIC_PRIVATE" } }), "Antigravity CLI: Internal error: Google authentication failed");
	assert.equal(safeGeminiError({ code: -32603, message: "Internal error", data: { message: "Account verification required" } }), "Antigravity CLI: Internal error: Account verification required");
	assert.equal(safeGeminiError({ privateValue: "SYNTHETIC_PRIVATE" }), "Antigravity CLI: Unknown error.");
});

test("Gemini structured error messages and details redact credentials and remain bounded", () => {
	const error = safeGeminiError({ message: 'OAuth failed: refresh_token="SYNTHETIC_REFRESH"', data: { details: "Bearer SYNTHETIC_BEARER https://example.invalid/oauth?code=SYNTHETIC_CODE " + "x".repeat(1000) } });
	for (const secret of ["SYNTHETIC_REFRESH", "SYNTHETIC_BEARER", "SYNTHETIC_CODE"]) assert(!error.includes(secret));
	assert(error.length <= "Antigravity CLI: ".length + 700);
});

test("Gemini connection surfaces a subprocess authentication rejection and stays disconnected", async () => {
	const profileDir = await mkdtemp(join(tmpdir(), "lh-gemini-login-error-"));
	const fixture = fileURLToPath(new URL("./fixtures/gemini-cli/fake-gemini.mjs", import.meta.url));
	const controller = new GeminiConnectionController({ profileDir, run: async (options) => spawn(process.execPath, [fixture], { cwd: options.cwd, env: { ...options.env, LH_FAKE_GEMINI_MODE: "auth-error" }, stdio: "pipe" }) });
	try {
		await controller.connect();
		for (let i = 0; i < 100 && (await controller.status()).state === "connecting"; i++) await new Promise((resolve) => setTimeout(resolve, 20));
		const status = await controller.status();
		assert.equal(status.state, "error");
		assert.equal(status.error, "Antigravity CLI: Google authentication required");
		assert.equal(controller.connected(), false);
		await assert.rejects(readFile(join(profileDir, "connection.json")), { code: "ENOENT" });
	} finally { await controller.dispose(); await rm(profileDir, { recursive: true, force: true }); }
});
