import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { DownloadCard, CopyTextCard } from "../components/artifacts/delivery-card.tsx";
import type { ArtifactPartProps } from "../src/core/contracts.ts";

const { window, document } = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window, document, Element: window.Element, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
let root: Root | undefined, host: HTMLElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; });
after(() => { if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator); });
async function render(card: React.ReactNode) { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root!.render(card)); }
function part(name: string, input: unknown): ArtifactPartProps["part"] {
	return JSON.parse(JSON.stringify({ type: `tool-${name}`, toolCallId: "saved-call", state: "output-available", input, output: { kind: name } }));
}

test("download button retains exact file bytes and works again after reopening the saved artifact", async () => {
	const text = "  Формула: α + β\n\tвторая строка\n", saved = part("create_file", { name: "Моя заметка.md", content: text });
	const blobs: Blob[] = [], downloads: string[] = [];
	URL.createObjectURL = (blob) => { blobs.push(blob as Blob); return "blob:fixture-download"; };
	URL.revokeObjectURL = () => {};
	// Linkedom URL-encodes its download getter; inspect the actual DOM attribute.
	const click = (event: Event) => { const element = event.target as HTMLAnchorElement; if (element.tagName === "A") downloads.push(element.getAttribute("download") ?? ""); };
	document.addEventListener("click", click);
	try {
		await render(<DownloadCard part={saved} />);
		await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
		await act(async () => root!.unmount()); host!.remove(); root = undefined;
		await render(<DownloadCard part={JSON.parse(JSON.stringify(saved))} />);
		await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
		assert.deepEqual(downloads, ["Моя заметка.md", "Моя заметка.md"]);
		assert.equal(blobs.length, 2);
		for (const blob of blobs) assert.equal(await blob.text(), text);
	} finally { document.removeEventListener("click", click); }
});

test("copy button preserves whitespace and treats supplied markup as text", async () => {
	const text = "  <script>test()</script>\n\tα = β\n"; let copied = "";
	Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value: string) => { copied = value; } } } });
	await render(<CopyTextCard part={part("copy_text", { title: "Формула", text })} />);
	assert.equal(host!.querySelector("script"), null);
	await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
	assert.equal(copied, text);
	assert.match(host!.textContent ?? "", /Скопировано/);
});

test("failed clipboard access is shown honestly instead of claiming a successful copy", async () => {
	Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async () => { throw new Error("Clipboard denied"); } } } });
	await render(<CopyTextCard part={part("copy_text", { text: "Keep this text" })} />);
	await act(async () => host!.querySelector<HTMLButtonElement>("button")!.click());
	assert.match(host!.querySelector('[role="alert"]')?.textContent ?? "", /Не удалось скопировать/);
	assert.doesNotMatch(host!.querySelector("button")?.textContent ?? "", /Скопировано/);
});
