import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { PracticeDock } from "../components/practice-dock.tsx";
import { QuestionDock } from "../components/question-dock.tsx";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });
async function mount(element: React.ReactNode) {
	const { window: win, document: doc } = parseHTML("<html><body><div id='host'></div></body></html>");
	let active: Element = doc.body;
	Object.defineProperty(doc, "activeElement", { get: () => active });
	win.HTMLElement.prototype.focus = function () { active = this; };
	Object.assign(doc, { oninput: null, getSelection: () => null });
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, window: win, document: doc, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(doc.getElementById("host")!);
	await act(async () => root.render(element));
	cleanup = async () => { await act(async () => root.unmount()); for (const [key, descriptor] of previous) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key];
	} };
	return { doc, win };
}

test("F7: practice button and global Enter wait for uploads without discarding the typed solution", async () => {
	const submitted: string[] = [];
	const { doc, win } = await mount(<PracticeDock problemCallId="p1" input={{ statement: "Solve" }} expanded onExpand={() => {}} onSubmit={text => submitted.push(text)} />);
	const field = doc.querySelector<HTMLElement>("[data-file-path-input]")!;
	await act(async () => { field.textContent = "My solution"; field.dispatchEvent(new win.Event("input", { bubbles: true })); });
	const { beginAttachmentUpload } = await import("../components/attachment-upload-state.ts");
	let finish!: () => void;
	await act(async () => { finish = beginAttachmentUpload(field); });
	const button = doc.querySelector<HTMLButtonElement>('[data-testid="practice-send"]')!;
	assert.equal(button.disabled, true);
	await act(async () => { button.click(); win.dispatchEvent(Object.assign(new win.Event("keydown", { bubbles: true, cancelable: true }), { key: "Enter" })); });
	assert.deepEqual(submitted, []); assert.equal(field.textContent, "My solution");
	await act(async () => finish());
	await act(async () => button.click());
	assert.deepEqual(submitted, ["My solution"]);
});

test("F7: a question waits for an upload in its separate reading/Other field", async () => {
	const submitted: unknown[] = [];
	const { doc, win } = await mount(<div data-attachment-scope=""><div data-testid="reading-upload" /><QuestionDock toolName="ask_user_question" toolCallId="q1" input={{ question: "Choose", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }} expanded onExpand={() => {}} onSubmit={answer => submitted.push(answer)} dictationClaim={false} /></div>);
	await act(async () => doc.querySelector<HTMLButtonElement>('[role="radio"]')!.click());
	const { beginAttachmentUpload } = await import("../components/attachment-upload-state.ts");
	let finish!: () => void;
	await act(async () => { finish = beginAttachmentUpload(doc.querySelector<HTMLElement>('[data-testid="reading-upload"]')!); });
	const button = doc.querySelector<HTMLButtonElement>('button[type="submit"]')!;
	assert.equal(button.disabled, true);
	await act(async () => { button.click(); win.dispatchEvent(Object.assign(new win.Event("keydown", { bubbles: true, cancelable: true }), { key: "Enter" })); });
	assert.deepEqual(submitted, []);
	await act(async () => finish());
	assert.equal(button.disabled, false);
	// linkedom does not synthesize the browser's submit default action for a button click.
	await act(async () => doc.querySelector("form")!.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true })));
	assert.equal(submitted.length, 1);
});

test("pending uploads are scoped and finishing/cancelling twice is harmless", async () => {
	const { doc } = await mount(<><div data-attachment-scope="" id="one"><div id="upload" /></div><div data-attachment-scope="" id="two" /></>);
	const { beginAttachmentUpload, hasPendingAttachmentUploads } = await import("../components/attachment-upload-state.ts");
	const finish = beginAttachmentUpload(doc.getElementById("upload")!);
	assert.equal(hasPendingAttachmentUploads(doc.getElementById("one")), true);
	assert.equal(hasPendingAttachmentUploads(doc.getElementById("two")), false);
	finish(); finish(); assert.equal(hasPendingAttachmentUploads(doc.getElementById("one")), false);
});
