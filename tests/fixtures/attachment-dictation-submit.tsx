import React, { act, useState } from "react";
import assert from "node:assert/strict";
import { mock } from "node:test";
import { parseHTML } from "linkedom";

const surface = process.argv[2];
const mode = process.argv[3] as "teach" | "practice" | "planning";
const { window: win, document: doc } = parseHTML("<!DOCTYPE html><html><body><div id='root'></div></body></html>");
let activeElement: Element = doc.body;
Object.defineProperty(doc, "activeElement", { get: () => activeElement });
win.HTMLElement.prototype.focus = function () { activeElement = this; };
Object.assign(doc, { oninput: null, getSelection: () => null });
const creations: unknown[] = [];
const storage = new Map<string, string>();
Object.assign(globalThis, {
	React, window: win, document: doc, HTMLElement: win.HTMLElement,
	Element: win.Element, Node: win.Node, CustomEvent: win.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
	getComputedStyle: () => ({ overflow: "visible", overflowY: "visible" }),
	requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
	cancelAnimationFrame: clearTimeout,
	sessionStorage: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => { storage.set(key, value); },
		removeItem: (key: string) => { storage.delete(key); },
	},
	fetch: async (url: string | URL | Request, init?: RequestInit) => {
		assert.equal(url, "/api/chats", "only the intentional final retry may create a chat");
		assert.equal(init?.method, "POST");
		creations.push(JSON.parse(String(init?.body)));
		return Response.json({ id: "attachment-safe-chat" });
	},
});

let finishResolve!: () => void;
let finishCalls = 0;
let endDictation!: () => void;
let appendDictation!: (text: string) => void;
const finishWait = new Promise<void>((resolve) => { finishResolve = resolve; });
const originalDictation = await import("../../components/dictation.tsx");
mock.module(new URL("../../components/dictation.tsx", import.meta.url).href, { namedExports: {
	...originalDictation,
	useDictation: ({ append }: { append: (text: string) => void }) => {
		const [active, setActive] = useState(true);
		appendDictation = append;
		endDictation = () => { setActive(false); finishResolve(); };
		return {
			active, finish: () => { finishCalls++; return finishWait; },
			phase: active ? "recording" : "idle", levelRef: { current: 0 },
			toggle() {}, stop() {}, cancel() {}, error: null, clearError() {},
		};
	},
	DictationBar: () => null,
} });

// These siblings do not participate in input/submission. Keep the real
// Composer, PathInput, attachment registry, and owning page handlers mounted.
mock.module(new URL("../../components/stats-bar.tsx", import.meta.url).href, { namedExports: {
	StatsBar: ({ leadingSlot }: { leadingSlot?: React.ReactNode }) => <div>{leadingSlot}</div>,
} });
mock.module(new URL("../../components/setup-dialog.tsx", import.meta.url).href, { namedExports: { SetupDialog: () => null } });
mock.module(new URL("../../components/graph-view.tsx", import.meta.url).href, { namedExports: { GraphView: () => null } });
mock.module(new URL("../../components/minimal-home.tsx", import.meta.url).href, { namedExports: { MinimalHome: () => null } });
const originalSetup = await import("../../components/setup-cta.tsx");
mock.module(new URL("../../components/setup-cta.tsx", import.meta.url).href, { namedExports: {
	...originalSetup, useModelSetup: () => ({ catalog: undefined, configured: true, zeroKeys: false }),
} });

const { beginAttachmentUpload } = await import("../../components/attachment-upload-state.ts");
const { createRoot } = await import("react-dom/client");
const { DraftShell } = await import("../../components/new-session.tsx");
const { Home } = await import("../../components/home.tsx");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
let sent = 0;
let latestDraft = "Typed goal";
function DraftHarness() {
	const [text, setText] = useState(latestDraft);
	return <DraftShell busy={false} text={text} mode={mode} onChange={(next) => { latestDraft = next; setText(next); }} onSend={() => { sent++; }} />;
}
const root = createRoot(doc.getElementById("root")!);
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {}, bfcacheId: "attachment-test" };
let finishUpload: (() => void) | undefined;
try {
	await act(async () => root.render(surface === "draft"
		? <DraftHarness />
		: <AppRouterContext.Provider value={router}><Home initialConfigured rendering={false} /></AppRouterContext.Provider>));
	const field = doc.querySelector<HTMLElement>("[data-file-path-input]")!;
	assert.ok(field, "real attachment-capable input is mounted");
	if (surface === "home") {
		if (mode === "practice") await act(async () => doc.querySelector<HTMLButtonElement>('[data-testid="home-mode-practice"]')!.click());
		await act(async () => {
			field.textContent = latestDraft;
			field.dispatchEvent(new win.Event("input", { bubbles: true }));
		});
	}
	const form = field.closest("form")!;
	const submit = () => form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
	await act(async () => { submit(); });
	assert.equal(finishCalls, 1, "submit first awaits speech finalization");
	assert.equal(sent + creations.length, 0);
	await act(async () => { finishUpload = beginAttachmentUpload(field); });
	await act(async () => {
		appendDictation("and dictated tail");
		endDictation();
		await finishWait;
	});
	assert.equal(sent + creations.length, 0, "an upload started during finish() must prevent the deferred send");
	assert.match(field.textContent ?? "", /Typed goal and dictated tail/, "the complete opening draft remains editable");
	await act(async () => { finishUpload!(); });
	assert.equal(sent + creations.length, 0, "upload completion must not auto-send a previously blocked draft");
	await act(async () => { submit(); });
	assert.equal(sent + creations.length, 1, "an explicit retry after the upload completes sends once");
	if (surface === "draft") assert.equal(latestDraft, "Typed goal and dictated tail");
	else assert.deepEqual(creations, [{ title: "Typed goal and dictated tail", ...(mode === "practice" ? { kind: "practice" } : {}) }]);
	console.log("deferred dictation/upload regression passed");
} finally {
	await act(async () => { finishUpload?.(); root.unmount(); });
	mock.restoreAll();
}
