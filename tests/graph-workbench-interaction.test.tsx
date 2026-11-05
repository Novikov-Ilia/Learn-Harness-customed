import React, { act } from "react";
import assert from "node:assert/strict";
import { it } from "node:test";
import { parseHTML } from "linkedom";
import { createRoot } from "react-dom/client";
import { GraphWorkbenchControls } from "../components/graph-workbench-controls.tsx";
import { DeleteNodeDialog } from "../components/delete-node-dialog.tsx";

it("graph UI dispatches explicit reprocessing/cancellation and saves a region name; failed rename remains visible", async () => {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	Object.assign(globalThis, { React, window: dom.window, document: dom.document, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true });
	const root = createRoot(document.getElementById("root")!);
	let starts = 0, aborts = 0, fail = false;
	const renamed: string[][] = [];
	try {
		await act(async () => { root.render(<GraphWorkbenchControls regions={[{ id: "topic", label: "Region", members: ["a", "b"] }]} phase="idle" error={null}
			onReprocess={() => { starts++; }} onAbort={() => { aborts++; }} onRename={async (id, name) => { if (fail) throw new Error("Synthetic rename write failed"); renamed.push([id, name]); }} />); });
		const buttons = () => [...document.querySelectorAll("button")];
		await act(async () => { (buttons().find((b) => b.textContent === "Reprocess graph") as HTMLElement).click(); });
		assert.equal(starts, 1);
		const input = document.querySelector("input")!; input.value = "Independent title";
		await act(async () => { document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
		assert.deepEqual(renamed, [["topic", "Independent title"]]);
		fail = true;
		await act(async () => { document.querySelector("form")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); });
		assert.match(document.querySelector('[role="alert"]')!.textContent ?? "", /Synthetic rename write failed/);
		await act(async () => { root.render(<GraphWorkbenchControls regions={[]} phase="analyzing" error={null} onReprocess={() => { starts++; }} onAbort={() => { aborts++; }} onRename={async () => {}} />); });
		const reprocess = buttons().find((b) => b.textContent === "Reprocess graph") as HTMLButtonElement;
		assert.ok(reprocess.disabled);
		await act(async () => { (buttons().find((b) => b.textContent === "Cancel") as HTMLElement).click(); });
		assert.equal(aborts, 1);
	} finally { await act(async () => { root.unmount(); }); }
});

it("node deletion UI cancels without a request, presents a conflict without removing knowledge, and retries confirmed deletion", async () => {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	Object.assign(globalThis, { React, window: dom.window, document: dom.document, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true });
	const root = createRoot(document.getElementById("root")!);
	const originalFetch = globalThis.fetch;
	let requests = 0, cancels = 0, completed = 0;
	globalThis.fetch = async () => { requests++; return requests === 1 ? Response.json({ code: "maintenance_running", error: "Graph reprocessing is running" }, { status: 409 }) : Response.json({ graphRevision: 42 }); };
	try {
		await act(async () => { root.render(<DeleteNodeDialog nodes={[{ id: "a", name: "Idea" }]} onClose={() => { cancels++; }} onDeleted={(ids, revision) => { assert.deepEqual(ids, ["a"]); assert.equal(revision, 42); completed++; }} />); });
		await act(async () => { (document.querySelector('[data-testid="node-delete-cancel"]') as HTMLElement).click(); });
		assert.equal(cancels, 1); assert.equal(requests, 0);
		await act(async () => { (document.querySelector('[data-testid="node-delete-confirm"]') as HTMLElement).click(); });
		assert.equal(requests, 1); assert.equal(completed, 0); assert.match(document.querySelector('[role="alert"]')!.textContent ?? "", /Graph reprocessing is running/);
		await act(async () => { (document.querySelector('[data-testid="node-delete-retry"]') as HTMLElement).click(); });
		assert.equal(requests, 2); assert.equal(completed, 1);
	} finally { globalThis.fetch = originalFetch; await act(async () => { root.unmount(); }); }
});
