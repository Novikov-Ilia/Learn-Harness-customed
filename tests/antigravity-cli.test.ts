import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { geminiCliEnvironment, prepareGeminiProfile, runBundledGemini, geminiInstallation, geminiProfileDir } from "../src/agent/gemini-cli/runtime.ts";
import { geminiAcp, bounded, stopGemini } from "../src/agent/gemini-cli/acp.ts";
import { antigravitySession } from "../src/agent/gemini-cli/session.ts";

test("Antigravity runtime replaces retired Gemini CLI and isolates account routing", () => {
	const installation = geminiInstallation();
	assert.equal(installation.version, "1.5.0");
	assert.equal(installation.installed, true);
	assert(installation.entry?.endsWith("antigravity"));
	assert(geminiProfileDir.endsWith("antigravity-cli-credentials"));
	const env = geminiCliEnvironment({ NODE_ENV: "test", HOME: "/learner", PATH: "/bin", GEMINI_API_KEY: "synthetic", AGY_ADC_AUTH: "1", AGY_LLM_GATEWAY_URL: "https://synthetic.invalid", CLOUD_CODE_URL: "https://synthetic.invalid", DBUS_SESSION_BUS_ADDRESS: "synthetic", GOOGLE_APPLICATION_CREDENTIALS: "/adc" }, "/managed");
	for (const key of ["GEMINI_API_KEY", "AGY_ADC_AUTH", "AGY_LLM_GATEWAY_URL", "CLOUD_CODE_URL", "GOOGLE_APPLICATION_CREDENTIALS"]) assert.equal(env[key], undefined);
	assert.equal(env.DBUS_SESSION_BUS_ADDRESS, "");
	assert.equal(env.XDG_RUNTIME_DIR, "/managed/runtime");
});

test("Antigravity managed settings allow only LearnHarness MCP and disable extra credit spending", async () => {
	const directory = await mkdtemp(join(tmpdir(), "lh-agy-settings-"));
	try {
		await prepareGeminiProfile(directory);
		const settings = JSON.parse(await readFile(join(directory, ".gemini", "antigravity-cli", "settings.json"), "utf8"));
		assert.equal(settings.useG1Credits, false);
		assert.deepEqual(settings.permissions.allow, ["mcp(learnharness/*)"]);
		for (const action of ["command", "read_file", "write_file", "read_url", "execute_url", "unsandboxed"]) assert(settings.permissions.deny.includes(`${action}(*)`));
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test("Actual bundled Antigravity negotiates OAuth, images and custom instructions without auth or model traffic", async () => {
	const directory = await mkdtemp(join(tmpdir(), "lh-agy-initialize-"));
	let child: Awaited<ReturnType<typeof runBundledGemini>> | undefined;
	try {
		await prepareGeminiProfile(directory);
		child = await runBundledGemini({ cwd: directory, env: geminiCliEnvironment(process.env, directory) });
		const hello = await bounded(geminiAcp(child, () => {}).initialize(), 15_000, "Antigravity initialize timed out");
		assert.equal(hello.agentInfo?.name, "Antigravity ACP Server");
		assert.equal(hello.agentInfo?.version, "1.5.0");
		assert(hello.authMethods?.some((method) => method.id === "oauth-personal"));
		assert.equal(hello.agentCapabilities?.promptCapabilities?.image, true);
		assert.equal((hello.agentCapabilities?._meta?.antigravity as any)?.systemPrompt?.append, true);
	} finally { if (child) await stopGemini(child); await rm(directory, { recursive: true, force: true }); }
});

test("Native Antigravity session accepts disabled built-ins and cancellation stops its worker group", async () => {
	const directory = await mkdtemp(join(tmpdir(), "lh-agy-session-"));
	let child: Awaited<ReturnType<typeof runBundledGemini>> | undefined;
	try {
		await prepareGeminiProfile(directory);
		child = await runBundledGemini({ cwd: directory, env: geminiCliEnvironment(process.env, directory) });
		if (process.platform === "linux") {
			const stat = await readFile(`/proc/${child.pid}/stat`, "utf8");
			assert.equal(Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]), child.pid, "Antigravity must own a process group including session workers");
		}
		const acp = geminiAcp(child, () => {}); await acp.initialize();
		const params = antigravitySession(directory, { httpUrl: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer OFFLINE-FIXTURE" } }, "Teach only supplied material");
		await assert.rejects(bounded(acp.request(acp.connection.newSession(params)), 15_000, "Native session timed out"), (error: any) => error.code === -32000 && /Authentication required/.test(error.message));
		await stopGemini(child);
		if (process.platform !== "win32") assert.throws(() => process.kill(-child!.pid!, 0), { code: "ESRCH" });
	} finally { if (child) await stopGemini(child); await rm(directory, { recursive: true, force: true }); }
});
