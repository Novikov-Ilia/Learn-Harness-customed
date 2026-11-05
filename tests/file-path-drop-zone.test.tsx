import React, { act } from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { FilePathDropZone } from "../components/file-path-drop-zone.tsx";
import { PathInput } from "../components/path-input.tsx";
import { readPathInput, restorePathSelection } from "../components/path-input-dom.ts";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

/** Managed uploads replace the previous desktop-only path-drop contract. */
async function fixture({ available = true, failUpload = false, desktop = false } = {}) {
 const { window: win, document: doc } = parseHTML("<html><body><div id='root'></div></body></html>");
 let active: Element = doc.body;
 Object.defineProperty(doc, "activeElement", { get: () => active });
 const selection = { anchorNode: null as Node | null, anchorOffset: 0, focusNode: null as Node | null, focusOffset: 0,
  setBaseAndExtent(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number) { Object.assign(this, { anchorNode, anchorOffset, focusNode, focusOffset }); } };
 Object.assign(doc, { getSelection: () => selection, oninput: null });
 win.HTMLElement.prototype.focus = function () { active = this; };
 const uploads: File[][] = []; let submits = 0; let value = "readthis";
 const descriptors = new Map<string, PropertyDescriptor | undefined>();
 for (const [name, next] of Object.entries({ React, window: win, document: doc, Node: win.Node, HTMLElement: win.HTMLElement,
  Element: win.Element, Event: win.Event, CustomEvent: win.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
  fetch: async (_url: unknown, init: RequestInit) => {
   const files = (init.body as FormData).getAll("files") as File[]; uploads.push(files);
   if (failUpload) return Response.json({ error: "Upload failed" }, { status: 500 });
   return Response.json({ files: files.map((file, i) => ({ id: `copy-${i}`, name: file.name, path: `/managed/attachments/copy-${i}/${file.name}`, url: `/api/attachments/copy-${i}`, mimeType: file.type, size: file.size })) });
  },
 })) { descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: next }); }
 if (desktop) Object.defineProperty(win, "lh", { configurable: true, value: { getPathForFile() { throw new Error("Must copy bytes instead of referring to the original file"); } } });
 const { createRoot } = await import("react-dom/client");
 const root = createRoot(doc.getElementById("root")!);
 const draw = () => root.render(<><aside data-testid="sidebar">Sidebar</aside><FilePathDropZone><form onSubmit={event => { event.preventDefault(); submits++; }}>
  {available && <PathInput data-testid="editor" defaultDropTarget value={value} onValueChange={next => { value = next; draw(); }} />}
  <button type="button" data-testid="elsewhere">Elsewhere</button><div data-testid="content">Content</div>
 </form></FilePathDropZone></>);
 await act(async () => { draw(); });
 cleanup = async () => { await act(async () => root.unmount()); for (const [name, descriptor] of descriptors) {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name];
 } };
 const editor = doc.querySelector<HTMLElement>('[data-testid="editor"]');
 const file = (name = "notes.md") => new File(["real uploaded bytes"], name, { type: "text/markdown" });
 const transfer = (files: File[], directories: number[] = [], types = ["Files"]) => ({ types, files,
  items: files.map((file, i) => ({ kind: "file", getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: directories.includes(i) }) })), dropEffect: "none" });
 async function event(type: string, dataTransfer = transfer([]), target: Element = doc.querySelector('[data-testid="content"]')!) {
  const e = Object.assign(new win.Event(type, { bubbles: true, cancelable: true }), { dataTransfer });
  await act(async () => { target.dispatchEvent(e); await new Promise(resolve => setTimeout(resolve, 0)); }); return e;
 }
 return { doc, editor, uploads, file, transfer, event, get value() { return value; }, get submits() { return submits; },
  get status() { return doc.querySelector('[role="alert"]')?.textContent ?? doc.querySelector('[role="status"]')?.textContent ?? ""; },
  focusEditor(offset: number) { editor!.focus(); restorePathSelection(editor!, { anchor: offset, focus: offset }); doc.dispatchEvent(new win.Event("selectionchange")); },
 };
}

for (const desktop of [false, true]) test(`F1/F5: ${desktop ? "desktop" : "browser"} drop uploads copies at the focused caret`, async () => {
 const f = await fixture({ desktop }); f.focusEditor(4);
 const files = [f.file("lecture one.md"), f.file("задача.txt")];
 const dropped = await f.event("drop", f.transfer(files));
 assert.equal(dropped.defaultPrevented, true); assert.equal(f.uploads.length, 1);
 assert.deepEqual(f.uploads[0]!.map(file => file.name), files.map(file => file.name));
 assert.equal(f.value, "read `/managed/attachments/copy-0/lecture one.md` `/managed/attachments/copy-1/задача.txt` this");
 assert.equal(readPathInput(f.editor!), f.value); assert.equal(f.submits, 0); assert.equal(f.status, "");
});

test("F1: unfocused content drop uses the default message field", async () => {
 const f = await fixture(); f.doc.querySelector<HTMLElement>('[data-testid="elsewhere"]')!.focus();
 await f.event("drop", f.transfer([f.file()]));
 assert.equal(f.uploads.length, 1); assert.match(f.value, /managed\/attachments/); assert.equal(f.submits, 0);
});

test("F1: dropping directly onto an input uploads exactly once and clears its parent overlay", async () => {
 const f = await fixture(); const transfer = f.transfer([f.file()]);
 await f.event("dragenter", transfer); assert.ok(f.doc.querySelector('[data-testid="file-path-drop-indicator"]'));
 await f.event("drop", transfer, f.editor!);
 assert.equal(f.uploads.length, 1); assert.equal(f.doc.querySelector('[data-testid="file-path-drop-indicator"]'), null);
});

test("F2: clipboard images upload instead of pasting the accompanying HTML or text", async () => {
 const f = await fixture(); f.focusEditor(4); const file = new File([new Uint8Array([1])], "clipboard.png", { type: "image/png" });
 const e = Object.assign(new window.Event("paste", { bubbles: true, cancelable: true }), { clipboardData: { files: [file], items: [], getData: () => "<img src=unsafe>" } });
 await act(async () => { f.editor!.dispatchEvent(e); await new Promise(resolve => setTimeout(resolve, 0)); });
 assert.equal(e.defaultPrevented, true); assert.equal(f.uploads.length, 1); assert.match(f.value, /clipboard\.png/);
 assert.doesNotMatch(f.value, /unsafe/); assert.equal(f.submits, 0);
});

test("F7: upload failure preserves draft and shows a retryable error", async () => {
 const f = await fixture({ failUpload: true }); f.focusEditor(4);
 await f.event("drop", f.transfer([f.file()]));
 assert.equal(f.value, "readthis"); assert.match(f.status, /Upload failed/); assert.equal(f.submits, 0);
});

test("directories are skipped and missing destinations never upload", async () => {
 const f = await fixture({ available: false });
 await f.event("drop", f.transfer([f.file("folder")], [0])); assert.match(f.status, /directories/);
 await f.event("drop", f.transfer([f.file()])); assert.match(f.status, /Open a chat/); assert.equal(f.uploads.length, 0);
});

test("non-file drags stay native and sidebar drops prevent navigation without uploads", async () => {
 const f = await fixture(); const plain = f.transfer([], [], ["text/plain"]);
 for (const type of ["dragenter", "dragover", "drop"]) assert.equal((await f.event(type, plain)).defaultPrevented, false);
 assert.equal((await f.event("drop", f.transfer([f.file()]), f.doc.querySelector('[data-testid="sidebar"]')!)).defaultPrevented, true);
 assert.equal(f.uploads.length, 0);
});

test("nested enter/leave depth keeps the overlay until the zone is left", async () => {
 const f = await fixture(); const transfer = f.transfer([f.file()]);
 await f.event("dragenter", transfer); await f.event("dragenter", transfer); await f.event("dragleave", transfer);
 assert.ok(f.doc.querySelector('[data-testid="file-path-drop-indicator"]'));
 await f.event("dragleave", transfer); assert.equal(f.doc.querySelector('[data-testid="file-path-drop-indicator"]'), null);
});

test("production AppShell keeps sidebar outside the upload drop zone", () => {
 const source = readFileSync(new URL("../components/sidebar.tsx", import.meta.url), "utf8");
 const shell = source.slice(source.indexOf("export function AppShell("));
 assert.match(shell, /<SessionsSidebar\s*\/>\s*<FilePathDropZone\b[^>]*>\{children\}<\/FilePathDropZone>/);
});
