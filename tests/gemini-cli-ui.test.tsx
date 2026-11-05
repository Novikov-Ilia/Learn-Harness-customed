import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { GeminiCliConnection } from "../components/settings/gemini-cli-status.tsx";
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const originalFetch = globalThis.fetch;
let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined; globalThis.fetch = originalFetch; });
async function mount() { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root!.render(<GeminiCliConnection />)); }

test("M1/M8: Google login starts in application; credentials are not requested in UI", async () => {
	const writes: unknown[] = []; let state = "disconnected";
	globalThis.fetch = (async (url, init) => {
		assert.equal(url, "/api/gemini-cli"); assert.equal(new Headers(init?.headers).get("x-learnharness-gemini-cli"), "1");
		if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); state = "connecting"; }
		return Response.json({ state, installed: true, version: "0.66.0" });
	}) as typeof fetch;
	await mount();
	const button = document.querySelector<HTMLButtonElement>('[data-testid="gemini-cli-connect"]'); assert(button); assert.match(button.textContent ?? "", /Google|Connect/);
	await act(async () => button.click()); assert.deepEqual(writes, [{ action: "connect" }]);
	assert.match(document.body.textContent ?? "", /browser|браузер/i);
	assert.equal(document.querySelector('input[type="password"]'), null);
});

test("M2: missing runtime is shown honestly and login cannot silently call an API", async () => {
	globalThis.fetch = (async () => Response.json({ state: "unavailable", installed: false, version: null, error: "Gemini CLI runtime was not found" })) as typeof fetch;
	await mount(); assert.match(document.body.textContent ?? "", /not found|unavailable|не найден/i);
	assert.equal(document.querySelector<HTMLButtonElement>('[data-testid="gemini-cli-connect"]')?.disabled, true);
});

test("Gemini subscription connection now uses Antigravity and explains signing in again", async () => {
	globalThis.fetch = (async () => Response.json({ state: "disconnected", installed: true, version: "0.66.0" })) as typeof fetch;
	await mount();
	assert.match(document.body.textContent ?? "", /through Antigravity CLI/);
	assert.match(document.body.textContent ?? "", /Google AI Pro or Ultra/);
	assert.match(document.body.textContent ?? "", /previous Gemini CLI login requires signing in again/);
});
