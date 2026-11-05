import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const memory = new Map<string, string>();
const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); }, removeItem: (key: string) => { memory.delete(key); } };
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const load = (relative: string): Promise<any> => import(new URL(relative, import.meta.url).href);
const item = (id: string, title: string, parentId?: string): any => ({ id, title, parentId, kind: "teach", createdAt: "2026-11-04", updatedAt: "2026-11-04", messageCount: 1, phase: "teach", pendingQuestion: false, pendingProblem: false, busy: false, compacting: false });

test("B5/B6: session tree renders nesting, collapses branches and keeps matching descendants searchable", async () => {
  const { ChatTree } = await load("../components/chat-tree.tsx");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const chats = [item("root", "Calculus"), item("child", "Continuity", "root"), item("nested", "Uniform continuity", "child")];
  let opened = "";
  try {
    await act(async () => { root.render(<ChatTree chats={chats} activeId="nested" onOpen={(id: string) => { opened = id; }} />); });
    assert.ok(host.querySelector('[role="tree"]'));
    assert.equal(host.querySelector('[data-chat-id="nested"]')?.getAttribute("aria-level"), "3");
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="chat-tree-toggle-root"]')!.click(); });
    assert.equal(host.querySelector('[data-chat-id="nested"]'), null);
    await act(async () => { root.render(<ChatTree chats={chats} query="Uniform" activeId="nested" onOpen={(id: string) => { opened = id; }} />); });
    assert.ok(host.querySelector('[data-chat-id="root"]'), "search preserves the ancestor path");
    const row = host.querySelector('[data-chat-id="nested"]')!;
    const key = new dom.window.Event("keydown", { bubbles: true, cancelable: true }); Object.defineProperty(key, "key", { value: "Enter" });
    await act(async () => { row.dispatchEvent(key); });
    assert.equal(opened, "nested");
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("N4/N5: notes UI displays mastery, corrected/open errors and failure without hiding the last successful note", async () => {
  const { LearningNoteView } = await load("../components/chat-learning-panel.tsx");
  const html = renderToStaticMarkup(<LearningNoteView note={{ mastered: [{ topic: "Limits", evidenceIds: ["a"] }], errors: [{ topic: "Signs", description: "Lost minus", status: "corrected", evidenceIds: ["b"] }, { topic: "Bounds", description: "Missing hypothesis", status: "open", evidenceIds: ["c"] }] }} error="Note refresh failed" />);
  assert.match(html, /Limits/); assert.match(html, /Lost minus/); assert.match(html, /Missing hypothesis/);
  assert.match(html, /corrected|исправ/i); assert.match(html, /open|unresolved|не устран/i); assert.match(html, /Note refresh failed/);
});

test("B8/P4: the visible block action sends blockId and opens the returned child; double clicks are blocked", async () => {
  const { ChatLearningPanel } = await load("../components/chat-learning-panel.tsx");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const writes: any[] = []; let opened = ""; let finish!: (value: Response) => void;
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "POST") { writes.push(JSON.parse(init.body as string)); return new Promise(resolve => { finish = resolve; }); }
    return Response.json({ kind: "planning", title: "Course", note: null, tree: { nodes: [{ id: "limits", title: "Limits", summary: "Epsilon proofs" }], edges: [], version: 1 } });
  };
  try {
    await act(async () => { root.render(<ChatLearningPanel chatId="parent" kind="planning" onBranchCreated={(id: string) => { opened = id; }} />); });
    const button = host.querySelector<HTMLButtonElement>('[data-testid="start-plan-block-limits"]')!; assert.ok(button);
    await act(async () => { button.click(); button.click(); });
    assert.equal(writes.length, 1); assert.equal(writes[0].blockId, "limits"); assert.equal(typeof writes[0].requestId, "string");
    await act(async () => { finish(Response.json({ id: "child" })); });
    assert.equal(opened, "child");
    assert.match(memory.get("lh.openingPrompt.child") ?? "", /Limits/);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("P1: a planning draft sends planning kind instead of silently creating teaching", async () => {
  const { startDraftSession, DraftShell } = await import("../components/new-session.tsx");
  let sent: any;
  const fakeStarter = { start: async (body: unknown) => { sent = body; return "/chat/planning"; } };
  const target = await startDraftSession("Plan a course", (async () => Response.json({})) as typeof fetch, "planning" as any, undefined, fakeStarter as any);
  assert.equal(target, "/chat/planning"); assert.equal(sent.kind, "planning");
  const html = renderToStaticMarkup(<DraftShell mode={"planning" as any} busy={false} text="" onChange={() => {}} onSend={() => {}} />);
  assert.match(html, /planning/i);
});

test("N4: a late response from the previous chat cannot overwrite the new chat's note", async () => {
  const { ChatLearningPanel } = await load("../components/chat-learning-panel.tsx");
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const replies = new Map<string, (value: Response) => void>();
  globalThis.fetch = async (url) => new Promise(resolve => { replies.set(String(url), resolve); });
  const payload = (topic: string) => ({ kind: "teach", title: topic, note: { mastered: [{ topic, evidenceIds: ["evidence"] }], errors: [] } });
  try {
    await act(async () => { root.render(<ChatLearningPanel chatId="old-chat" />); });
    await act(async () => { root.render(<ChatLearningPanel chatId="new-chat" />); });
    await act(async () => { replies.get("/api/chats/new-chat/learning")!(Response.json(payload("NEW CHAT KNOWLEDGE"))); });
    assert.match(host.textContent!, /NEW CHAT KNOWLEDGE/);
    await act(async () => { replies.get("/api/chats/old-chat/learning")!(Response.json(payload("OLD PRIVATE KNOWLEDGE"))); });
    assert.match(host.textContent!, /NEW CHAT KNOWLEDGE/); assert.doesNotMatch(host.textContent!, /OLD PRIVATE KNOWLEDGE/);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
