import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { geminiCliEnvironment, prepareGeminiProfile, runBundledGemini } from "../src/agent/gemini-cli/runtime.ts";
import { geminiAcp, bounded, stopGemini } from "../src/agent/gemini-cli/acp.ts";

test("M7: native API, ADC and gateway overrides cannot redirect subscription requests", () => {
	const forbidden = ["CODE_ASSIST_ENDPOINT", "CODE_ASSIST_API_VERSION", "AGY_ADC_AUTH", "AGY_LLM_GATEWAY_URL", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "ANTIGRAVITY_AUTH_TOKEN", "CLOUD_CODE_URL"];
	const env = geminiCliEnvironment({ NODE_ENV: "test", ...Object.fromEntries(forbidden.map((key) => [key, "SYNTHETIC_NOT_A_CREDENTIAL"])) }, "/managed-profile");
	for (const key of forbidden) assert.equal(env[key], undefined, key);
	assert.equal(env.DBUS_SESSION_BUS_ADDRESS, "");
	assert.equal(env.XDG_RUNTIME_DIR, "/managed-profile/runtime");
	assert.equal(env.LH_ANTIGRAVITY_PROFILE, "/managed-profile");
});

test("M7: managed Antigravity startup cannot adopt terminal settings or create an implicit login", async () => {
	const root = await mkdtemp(join(tmpdir(), "lh-antigravity-boundary-"));
	const userHome = join(root, "user-home"), cwd = join(root, "workspace"), profileDir = join(root, "managed");
	let child: Awaited<ReturnType<typeof runBundledGemini>> | undefined;
	try {
		await mkdir(join(userHome, ".gemini", "antigravity-cli"), { recursive: true });
		await mkdir(cwd);
		const foreignSettings = JSON.stringify({ modelProvider: "gemini", useG1Credits: true, permissions: { allow: ["command(*)"] } });
		await writeFile(join(userHome, ".gemini", "antigravity-cli", "settings.json"), foreignSettings);
		await prepareGeminiProfile(profileDir);
		child = await runBundledGemini({ cwd, env: geminiCliEnvironment({ ...process.env, HOME: userHome }, profileDir) });
		const acp = geminiAcp(child, () => {});
		const hello = await bounded(acp.initialize(), 15_000, "Native Antigravity environment init timed out");
		assert.equal(hello.agentInfo?.version, "1.5.0");
		assert(hello.authMethods?.some((method) => method.id === "oauth-personal"));
		assert.equal(await readFile(join(userHome, ".gemini", "antigravity-cli", "settings.json"), "utf8"), foreignSettings);
		assert.deepEqual(await readdir(join(userHome, ".gemini", "antigravity-cli")), ["settings.json"]);
		const settings = JSON.parse(await readFile(join(profileDir, ".gemini", "antigravity-cli", "settings.json"), "utf8"));
		assert.equal(settings.modelProvider, undefined);
		assert.equal(settings.useG1Credits, false);
		await assert.rejects(readFile(join(profileDir, "connection.json")), { code: "ENOENT" });
	} finally { if (child) await stopGemini(child); await rm(root, { recursive: true, force: true }); }
});
