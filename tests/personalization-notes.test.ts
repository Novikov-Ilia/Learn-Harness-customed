import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-personal-notes-"));
process.env.LH_DATA_DIR = scratch;
process.env.LH_AUTH_FILE = path.join(scratch, "auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const { chatStore } = await import("../src/store/chats.ts");
const load = (): Promise<any> => import(new URL("../src/server/learning-notes.ts", import.meta.url).href);
const user = (id: string, text: string): any => ({ id, role: "user", content: text, timestamp: 1 });
const reply = (id: string, text: string): any => ({ id, role: "assistant", content: [{ type: "text", text }], timestamp: 2, api: "test", provider: "test", model: "test", stopReason: "stop", usage: {} });
function exchange(status: "correct" | "incorrect" | "dismissed" = "correct"): any[] {
  return [user("u", "I want to learn limits"), { ...reply("q", ""), stopReason: "toolUse", content: [{ type: "toolCall", id: "quiz1", name: "quiz", arguments: { question: "Find the limit" } }] }, { id: "evidence", role: "toolResult", toolCallId: "quiz1", toolName: "quiz", content: [{ type: "text", text: JSON.stringify({ status }) }], details: { status, correct: status === "correct", dismissed: status === "dismissed" }, timestamp: 3, isError: false }, reply("reaction", status === "correct" ? "Your derivation is correct" : "The sign is wrong")];
}
const good = { mastered: [{ topic: "Limits", evidenceIds: ["evidence"] }], errors: [] };

for (const kind of [undefined, "practice"] as const) test(`N1/N4: ${kind ?? "teach"} notes preserve verified mastery and visible persistence`, async () => {
  const { updateLearningNote } = await load();
  const chat = chatStore.createChat("Notes", kind);
  chatStore.saveMessages(chat.id, exchange());
  await updateLearningNote(chat.id, { chatStore, summarize: async () => good });
  const saved = chatStore.getChat(chat.id) as any;
  assert.deepEqual(saved.learningNote.mastered, good.mastered);
  assert.equal(saved.learningNote.throughMessageId, "reaction");
  assert.equal(saved.learningNote.errors.length, 0);
  const { GET } = await import(new URL("../app/api/chats/[id]/learning/route.ts", import.meta.url).href);
  const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: chat.id }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).note.mastered, good.mastered);
});

test("N2: mention-only, unchecked answers and dismissed questions cannot become mastery evidence", async () => {
  const { updateLearningNote } = await load();
  for (const messages of [[user("mention", "We discussed limits"), reply("answer", "A limit is...")], [user("unverified", "I think I solved it")], exchange("dismissed")]) {
    const chat = chatStore.createChat("No proof"); chatStore.saveMessages(chat.id, messages);
    await updateLearningNote(chat.id, { chatStore, summarize: async () => ({ mastered: [{ topic: "Invented mastery", evidenceIds: [messages[0].id] }], errors: [] }) });
    assert.equal(((chatStore.getChat(chat.id) as any).learningNote?.mastered ?? []).length, 0);
  }
});

test("N3: corrected misconception updates its existing entry without duplicating it", async () => {
  const { updateLearningNote } = await load();
  const chat = chatStore.createChat("Sign errors"); chatStore.saveMessages(chat.id, exchange("incorrect"));
  const error = { topic: "Limits", description: "Wrong sign", status: "open", evidenceIds: ["evidence"] };
  await updateLearningNote(chat.id, { chatStore, summarize: async () => ({ mastered: [], errors: [error] }) });
  chatStore.saveMessages(chat.id, [...exchange("incorrect"), ...exchange().map(m => ({ ...m, id: `fixed-${m.id}`, ...(m.role === "toolResult" ? { toolCallId: "fixed-quiz1" } : {}), ...(m.id === "q" ? { content: [{ type: "toolCall", id: "fixed-quiz1", name: "quiz", arguments: { question: "Try again" } }] } : {}) }))]);
  await updateLearningNote(chat.id, { chatStore, summarize: async () => ({ mastered: [], errors: [{ ...error, status: "corrected", evidenceIds: ["evidence", "fixed-evidence"] }] }) });
  const notes = (chatStore.getChat(chat.id) as any).learningNote;
  assert.equal(notes.errors.length, 1); assert.equal(notes.errors[0].status, "corrected");
});

test("N5: failed generation preserves the last note and records an honest error", async () => {
  const { updateLearningNote } = await load();
  const chat = chatStore.createChat("Keep note"); chatStore.saveMessages(chat.id, exchange());
  await updateLearningNote(chat.id, { chatStore, summarize: async () => good });
  const before = (chatStore.getChat(chat.id) as any).learningNote;
  chatStore.saveMessages(chat.id, [...exchange(), user("later", "More reasoning"), reply("later-r", "Checked")]);
  await updateLearningNote(chat.id, { chatStore, summarize: async () => { throw new Error("fixture note generation unavailable"); } });
  const record = chatStore.getChat(chat.id) as any;
  assert.deepEqual(record.learningNote, before);
  assert.match(record.learningNoteError, /unavailable|could not|failed/i);
});

test("N5: note write failure is surfaced and does not erase the successful note", async () => {
  const { updateLearningNote } = await load();
  const chat = chatStore.createChat("Disk failure"); chatStore.saveMessages(chat.id, exchange());
  await updateLearningNote(chat.id, { chatStore, summarize: async () => good });
  const before = (chatStore.getChat(chat.id) as any).learningNote;
  const broken = { ...chatStore, saveLearningNote() { throw new Error("fixture note write failure"); } };
  await updateLearningNote(chat.id, { chatStore: broken, summarize: async () => good });
  assert.deepEqual((chatStore.getChat(chat.id) as any).learningNote, before);
  assert.match((chatStore.getChat(chat.id) as any).learningNoteError, /write|save|failed/i);
});

test("N3: a correction preserves error identity when its topic and description are rephrased", async () => {
  const { updateLearningNote } = await load();
  const chat = chatStore.createChat("Rephrased error"); chatStore.saveMessages(chat.id, exchange("incorrect"));
  await updateLearningNote(chat.id, { chatStore, summarize: async () => ({ mastered: [], errors: [{ topic: "Limits", description: "Forgot a minus sign", status: "open", evidenceIds: ["evidence"] }] }) });
  const original = (chatStore.getChat(chat.id) as any).learningNote.errors[0];
  const correct = exchange().map(m => ({ ...m, id: `correct-${m.id}`, ...(m.role === "toolResult" ? { toolCallId: "correct-quiz1" } : {}), ...(m.id === "q" ? { content: [{ type: "toolCall", id: "correct-quiz1", name: "quiz", arguments: { question: "Check the sign again" } }] } : {}) }));
  chatStore.saveMessages(chat.id, [...exchange("incorrect"), ...correct]);
  await updateLearningNote(chat.id, { chatStore, summarize: async () => ({ mastered: [], errors: [{ topic: "Limit signs", description: "The previous sign misconception is now corrected", status: "corrected", evidenceIds: ["evidence", "correct-evidence"] }] }) });
  const errors = (chatStore.getChat(chat.id) as any).learningNote.errors;
  assert.equal(errors.length, 1); assert.equal(errors[0].status, "corrected");
  assert.equal(errors[0].id, original.id);
});

test("N5: invalid summary JSON shapes preserve the previous note and expose failure", async () => {
  const { updateLearningNote } = await load();
  const chat = chatStore.createChat("Invalid summary"); chatStore.saveMessages(chat.id, exchange());
  await updateLearningNote(chat.id, { chatStore, summarize: async () => good });
  const before = (chatStore.getChat(chat.id) as any).learningNote;
  chatStore.saveMessages(chat.id, [...exchange(), user("new-learner", "Continue"), reply("new-tutor", "Another exchange")]);
  for (const invalid of [null, {}, [], { mastered: [], errors: "not-an-array" }, { mastered: [{ topic: "Bad", evidenceIds: "evidence" }], errors: [] }, { mastered: [], errors: [{ topic: "Bad", description: "wrong", status: "invented", evidenceIds: ["evidence"] }] }]) {
    await updateLearningNote(chat.id, { chatStore, summarize: async () => invalid });
    const record = chatStore.getChat(chat.id) as any;
    assert.deepEqual(record.learningNote, before);
    assert.match(record.learningNoteError, /shape|format|invalid|failed/i);
  }
});
