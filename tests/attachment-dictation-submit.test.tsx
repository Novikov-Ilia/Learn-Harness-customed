import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const fixture = fileURLToPath(new URL("./fixtures/attachment-dictation-submit.tsx", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

// Keep the deferred speech boundary controllable without opening a microphone
// or using a speech service. Module mocks live in isolated child processes;
// the normal test command does not require an experimental Node flag.
for (const [surface, modes] of [
	["draft", ["teach", "practice", "planning"]],
	["home", ["teach", "practice"]],
] as const) {
	for (const mode of modes) {
		test(`F7: ${surface} ${mode} rechecks uploads after dictation finishes and preserves the complete draft`, async () => {
			const { stdout } = await run(process.execPath, [
				"--experimental-test-module-mocks", "--import", "tsx", fixture, surface, mode,
			], { cwd: root, env: { ...process.env, NODE_ENV: "test" }, timeout: 25_000 });
			assert.match(stdout, /deferred dictation\/upload regression passed/);
		});
	}
}
