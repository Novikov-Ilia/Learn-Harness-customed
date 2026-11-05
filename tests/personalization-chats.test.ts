import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-personal-chats-"));
process.env.LH_DATA_DIR = scratch;
process.env.LH_AUTH_FILE = path.join(scratch, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { chatStore } = await import("../src/store/chats.ts");
const { danglingQuestionOf } = await import("../src/core/native-messages.ts");
const load = (relative: string): Promise<any> => import(new URL(relative, import.meta.url).href);
const user = (id: string, text: string): any => ({ id, role: "user", content: text, timestamp: 1 });
const assistant = (id: string, text: string): any => ({ id, role: "assistant", content: [{ type: "text", text }], timestamp: 2, api: "test", provider: "test", model: "test", stopReason: "stop", usage: {} });
const read = (id: string): any => chatStore.getChat(id)!;
const note = (text: string): any => ({ updatedAt: "2026-11-04", throughMessageId: "evidence", mastered: [{ topic: text, evidenceIds: ["evidence"] }], errors: [] });

test("B1/B2: branch stores a frozen full parent snapshot separately from the child's live transcript", async () => {
  const { createChatBranch, chatContextMessages } = await load("../src/server/chat-context.ts");
  const parent = chatStore.createChat("Calculus");
  chatStore.saveMessages(parent.id, [user("u1", "Define continuity"), assistant("a1", "Parent explanation")]);
  const before = read(parent.id);
  const child = createChatBranch(parent.id, { title: "Uniform continuity", requestId: "branch-1" }, { chatStore });
  assert.equal(child.parentId, parent.id);
  assert.equal(child.messages.length, 0);
  assert.deepEqual(child.contextSnapshot.messages, before.messages);
  assert.deepEqual(read(parent.id), before, "branching never rewrites the parent");
  chatStore.saveMessages(parent.id, [...before.messages, user("later", "PRIVATE LATER PARENT TURN")]);
  assert.match(JSON.stringify(chatContextMessages(child.id, { chatStore })), /Parent explanation/);
  assert.doesNotMatch(JSON.stringify(chatContextMessages(child.id, { chatStore })), /PRIVATE LATER PARENT TURN/);
});

test("B3/B4: parent sees child note, never child raw transcript; sibling and unrelated chat stay isolated", async () => {
  const { createChatBranch, chatContextMessages } = await load("../src/server/chat-context.ts");
  const parent = chatStore.createChat("Root");
  const child = createChatBranch(parent.id, { title: "Child", requestId: "one" }, { chatStore });
  const sibling = createChatBranch(parent.id, { title: "Sibling", requestId: "two" }, { chatStore });
  const unrelated = chatStore.createChat("Unrelated");
  chatStore.saveMessages(child.id, [user("secret", "CHILD PRIVATE TRANSCRIPT")]);
  (chatStore as any).saveLearningNote(child.id, note("Child has verified the epsilon argument"));
  const parentWire = JSON.stringify(chatContextMessages(parent.id, { chatStore }));
  assert.match(parentWire, /Child has verified the epsilon argument/);
  assert.doesNotMatch(parentWire, /CHILD PRIVATE TRANSCRIPT/);
  for (const id of [sibling.id, unrelated.id]) assert.doesNotMatch(JSON.stringify(chatContextMessages(id, { chatStore })), /CHILD PRIVATE TRANSCRIPT|Child has verified/);
});

test("B5/B7/B8: nested branches persist, legacy roots survive, and request retries are idempotent", async () => {
  const { createChatBranch } = await load("../src/server/chat-context.ts");
  const root = chatStore.createChat("Legacy root");
  const child = createChatBranch(root.id, { title: "Child", requestId: "same-request" }, { chatStore });
  const retry = createChatBranch(root.id, { title: "Child", requestId: "same-request" }, { chatStore });
  assert.equal(retry.id, child.id);
  const nested = createChatBranch(child.id, { title: "Nested", requestId: "nested" }, { chatStore });
  const freshStore = (await import("../src/store/chats.ts")).chatStore;
  assert.equal((freshStore.getChat(nested.id) as any).parentId, child.id);
  assert.equal((freshStore.listChats().find(c => c.id === child.id) as any).parentId, root.id);
  assert.equal((freshStore.getChat(root.id) as any).parentId, undefined);
  assert.throws(() => createChatBranch("missing", { title: "Bad", requestId: "bad" }, { chatStore }), /not found|unknown/i);
});

test("B7: corrupted ancestry is refused instead of looping or leaking foreign context", async () => {
  const { createChatBranch } = await load("../src/server/chat-context.ts");
  const root = chatStore.createChat("Corrupt");
  const file = path.join(scratch, "chats", `${root.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...read(root.id), parentId: root.id }));
  assert.throws(() => createChatBranch(root.id, { title: "Bad", requestId: "cycle" }, { chatStore }), /cycle|ancestry|parent/i);
});

test("B9: pending ancestor question and compaction stay historical, not a pending child question", async () => {
  const { createChatBranch, chatContextMessages } = await load("../src/server/chat-context.ts");
  const parent = chatStore.createChat("Long parent");
  const pending: any = { ...assistant("question", ""), stopReason: "toolUse", content: [{ type: "toolCall", id: "q-parent", name: "quiz", arguments: { question: "Parent only?" } }] };
  const long = [user("old", "x".repeat(100000)), pending];
  chatStore.saveMessages(parent.id, long);
  const child = createChatBranch(parent.id, { title: "Detour", requestId: "pending" }, { chatStore });
  assert.equal(danglingQuestionOf(child.messages), null);
  assert.equal(child.contextSnapshot.messages[0].content.length, 100000, "full snapshot remains durable");
  assert.match(JSON.stringify(chatContextMessages(child.id, { chatStore })), /Parent only/);
});

test("B10: parent deletion is blocked before any graph or record changes", async () => {
  const { createChatBranch } = await load("../src/server/chat-context.ts");
  const { deleteChatSession } = await import("../src/server/chats.ts");
  const parent = chatStore.createChat("Keep parent");
  const child = createChatBranch(parent.id, { title: "Keep child", requestId: "keep" }, { chatStore });
  const result = await deleteChatSession(parent.id, "delete-nodes");
  assert.equal(result.ok, false);
  assert.equal((result as any).code, "has_children");
  assert.equal((result as any).status, 409);
  assert.ok(read(parent.id)); assert.ok(read(child.id));
});

test("P1/P4/P5: planning persists as its own mode; choosing a valid block creates one teaching branch", async () => {
  const { POST } = await import("../app/api/chats/route.ts");
  const res = await POST(new Request("http://localhost/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Master course", kind: "planning" }) }));
  const { id } = await res.json();
  assert.equal(read(id).kind, "planning");
  chatStore.saveMessages(id, [user("material", "MATERIAL: textbook.pdf; GOAL: learn limits"), assistant("diagnosis", "DIAGNOSTIC: algebra confirmed; limit laws missing")]);
  chatStore.saveTree(id, { version: 1, nodes: [{ id: "limits", title: "Limits", summary: "Definitions and epsilon proofs" }], edges: [] });
  const { createChatBranch, chatContextMessages } = await load("../src/server/chat-context.ts");
  const child = createChatBranch(id, { blockId: "limits", requestId: "choose-limits" }, { chatStore });
  assert.equal(child.kind ?? "teach", "teach");
  assert.equal(child.planBlockId, "limits");
  const wire = JSON.stringify(chatContextMessages(child.id, { chatStore }));
  assert.match(wire, /textbook.pdf/); assert.match(wire, /algebra confirmed/); assert.match(wire, /Definitions and epsilon proofs/);
  assert.equal(createChatBranch(id, { blockId: "limits", requestId: "another-click" }, { chatStore }).id, child.id);
  assert.throws(() => createChatBranch(id, { blockId: "absent", requestId: "bad-block" }, { chatStore }), /block|node/i);
});

test("P2/P3: planning agent receives materials and diagnosis tools, writes plans, and has no teaching quiz tool", async () => {
  const { createPlanningAgent } = await load("../src/agent/planning-agent.ts");
  const { createFauxCore } = await import("@earendil-works/pi-ai");
  const faux = createFauxCore({});
  const plan = chatStore.createChat("Planner");
  const agent = createPlanningAgent({ chatId: plan.id, chatStore }, { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, messages: [user("goal", "Attached materials and learning goal")] });
  const names = agent.state.tools.map((tool: any) => tool.name);
  assert.ok(names.includes("plan_init")); assert.ok(names.includes("probe")); assert.ok(names.includes("ask_user_question")); assert.ok(names.includes("read"));
  assert.ok(!names.includes("quiz")); assert.ok(!names.includes("explain")); assert.ok(!names.includes("problem"));
  assert.match(agent.state.systemPrompt, /materials|material/i);
  assert.match(agent.state.systemPrompt, /diagnos|assess|probe/i);
  assert.match(agent.state.systemPrompt, /select|choos/i);
});

test("B2/B9: the real turn handler passes inherited context to a fake agent and persists only new child output", async () => {
  process.env.OPENROUTER_API_KEY = "test-fixture-only";
  const { createChatBranch } = await load("../src/server/chat-context.ts");
  const { handleChatInput } = await import("../src/server/chat-handler.ts");
  const { runningTurn } = await import("../src/server/turn-runs.ts");
  const { createTeacherAgent } = await import("../src/agent/teacher-agent.ts");
  const { createFauxCore, fauxAssistantMessage, fauxText } = await import("@earendil-works/pi-ai");
  const parent = chatStore.createChat("Context source");
  chatStore.saveMessages(parent.id, [user("ancestor", "ANCESTOR MATERIAL"), assistant("ancestor-a", "ANCESTOR EXPLANATION")]);
  const child = createChatBranch(parent.id, { title: "Handler branch", requestId: "real-handler" }, { chatStore });
  chatStore.saveSettings(child.id, { model: { provider: "openrouter", id: "openai/gpt-6.1-sol" } });
  let received = "";
  const faux = createFauxCore({}); faux.setResponses([(context) => { received = JSON.stringify(context.messages); return fauxAssistantMessage([fauxText("CHILD ONLY REPLY")]); }]);
  const response = await handleChatInput(child.id, { type: "text", text: "Ask in the child" }, (opts) => createTeacherAgent(undefined, { ...opts, engine: { model: faux.getModel(), streamFn: faux.streamSimple } }));
  assert.equal(response.status, 200, await response.text());
  const running = runningTurn(child.id); if (running) await new Response(running.subscribe()).text();
  assert.match(received, /ANCESTOR MATERIAL/); assert.match(received, /Ask in the child/);
  const childRecord = read(child.id);
  assert.equal(childRecord.messages.length, 2, "model-only snapshot must never be appended to local history");
  assert.doesNotMatch(JSON.stringify(childRecord.messages), /ANCESTOR MATERIAL|ANCESTOR EXPLANATION/);
  assert.match(JSON.stringify(childRecord.messages), /CHILD ONLY REPLY/);
});

test("B9: inherited history participates in compaction while its full snapshot stays untouched", async () => {
  const { createChatBranch, contextCompactionStore, chatContextMessages } = await load("../src/server/chat-context.ts");
  const { ensureCompacted, projectedContextTokens } = await import("../src/server/compaction.ts");
  const { createFauxCore } = await import("@earendil-works/pi-ai"); const faux = createFauxCore({});
  const parent = chatStore.createChat("Very long course");
  chatStore.saveMessages(parent.id, Array.from({ length: 20 }, (_, index) => index % 2 ? assistant(`a${index}`, "x".repeat(15000)) : user(`u${index}`, "x".repeat(15000))));
  const child = createChatBranch(parent.id, { title: "Compact branch", requestId: "compact-child" }, { chatStore });
  chatStore.saveMessages(child.id, [user("child-new", "Current question")]);
  const snapshot = structuredClone(read(child.id).contextSnapshot);
  let summarized = 0;
  await ensureCompacted({ chatStore: contextCompactionStore(chatStore), engine: { model: faux.getModel(), streamFn: faux.streamSimple }, modelId: "fixture:model", kind: "teach", thresholdTokens: 50000, systemPromptTokens: 100, summarize: async () => { summarized++; return { summary: "Earlier course context, kept in full on disk.", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }; } }, child.id);
  assert.equal(summarized, 1);
  assert.deepEqual(read(child.id).contextSnapshot, snapshot);
  assert.equal(read(child.id).messages.length, 2, "only own question and new compaction marker are local");
  assert.ok(projectedContextTokens(chatContextMessages(child.id, { chatStore }), 100) < 50000);
});

test("P2/P3: planning writes scope summaries and stops before an automatic teaching generation", async () => {
  const { createPlanningAgent } = await load("../src/agent/planning-agent.ts");
  const { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");
  const chat = chatStore.createChat("Planning stop", "planning"); const faux = createFauxCore({}); let generations = 0;
  faux.setResponses([() => { generations++; return fauxAssistantMessage([fauxText("Here is the material-based plan. Choose a block."), fauxToolCall("plan_init", { mermaid: "graph TD\n limits[Limits]", blocks: [{ id: "limits", summary: "Epsilon definitions, not derivatives" }] }, { id: "plan" })], { stopReason: "toolUse" }); }, () => { generations++; return fauxAssistantMessage([fauxText("UNAUTHORIZED AUTOMATIC TEACHING")]); }]);
  const agent = createPlanningAgent({ chatId: chat.id, chatStore }, { engine: { model: faux.getModel(), streamFn: faux.streamSimple } });
  await agent.prompt("Material: textbook.pdf. Goal: learn limits. Diagnosis: algebra is held.");
  assert.equal(generations, 1); assert.equal(read(chat.id).tree.nodes[0].summary, "Epsilon definitions, not derivatives");
});

test("P2/F6: planning can dispatch a scanned PDF for visual reading instead of reading binary bytes", async () => {
  const { createPlanningAgent } = await load("../src/agent/planning-agent.ts");
  const { jobStore } = await import("../src/store/jobs.ts");
  const { createFauxCore } = await import("@earendil-works/pi-ai"); const faux = createFauxCore({});
  const chat = chatStore.createChat("Scanned textbook", "planning"); let spawned = 0;
  const agent = createPlanningAgent({ chatId: chat.id, chatStore, jobs: { chatId: chat.id, jobStore, spawn: () => { spawned++; } } }, { engine: { model: faux.getModel(), streamFn: faux.streamSimple } });
  const pdf = agent.state.tools.find((tool: any) => tool.name === "pdf");
  assert.ok(pdf, "scan-only pages require the PDF visual reader, not the plain read tool");
  const result = await pdf.execute("scan-pdf", { path: "/managed/scanned.pdf", question: "Find the course's logical blocks and prerequisite material" });
  assert.equal(spawned, 1); assert.equal(jobStore.listJobs(chat.id)[0]?.kind, "pdf");
  assert.doesNotMatch(JSON.stringify(result.content), /keep teaching|weave it into the lesson/i);
});

test("B8: snapshot, parent and inherited provider settings are committed by one creation write", async () => {
  const { createChatBranch } = await load("../src/server/chat-context.ts");
  const parent = chatStore.createChat("Pinned provider");
  chatStore.saveSettings(parent.id, { model: { provider: "fixture-provider", id: "fixture-model" }, thinkingLevel: "high" });
  let creationWrites = 0;
  const atomicStore = { ...chatStore, createChat(...args: Parameters<typeof chatStore.createChat>) { creationWrites++; return chatStore.createChat(...args); }, saveSettings() { throw new Error("A second settings write must not be needed"); } };
  const child = createChatBranch(parent.id, { title: "Atomic child", requestId: "atomic-child" }, { chatStore: atomicStore });
  assert.equal(creationWrites, 1); assert.deepEqual(child.settings, read(parent.id).settings);
  assert.deepEqual(createChatBranch(parent.id, { title: "Atomic child", requestId: "atomic-child" }, { chatStore: atomicStore }).settings, read(parent.id).settings);
});

test("B3: child notes never split a question call from its submitted answer in provider context", async () => {
  const { createChatBranch, chatContextMessages } = await load("../src/server/chat-context.ts");
  const { toLlmMessages } = await import("../src/core/native-messages.ts");
  const parent = chatStore.createChat("Answer with child notes");
  const child = createChatBranch(parent.id, { title: "Subtopic", requestId: "note-boundary" }, { chatStore });
  (chatStore as any).saveLearningNote(child.id, note("Verified subtopic"));
  const call = { ...assistant("question-note", ""), stopReason: "toolUse", content: [{ type: "toolCall", id: "q-with-note", name: "quiz", arguments: { question: "Which limit?" } }] };
  const answer: any = { id: "answer-note", role: "toolResult", toolCallId: "q-with-note", toolName: "quiz", content: [{ type: "text", text: "Learner answer" }], isError: false, timestamp: 3 };
  chatStore.saveMessages(parent.id, [user("ask-note", "Teach"), call, answer]);
  const wire = toLlmMessages(chatContextMessages(parent.id, { chatStore }));
  const callIndex = wire.findIndex((m) => m.role === "assistant");
  assert.equal(wire[callIndex + 1]?.role, "toolResult", "providers require question results adjacent to their call, before user-role notes");
});
