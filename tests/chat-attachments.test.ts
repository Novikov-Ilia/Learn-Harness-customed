import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { newUserMessage, newThinkingMessage, newAnswerResult, toLlmMessages } from "../src/core/native-messages.ts";
import { quoteFilePath } from "../src/core/file-paths.ts";
import { tinyPdf } from "./helpers/tiny-pdf.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const png = createCanvas(1, 1).toBuffer("image/png");
async function fixture() {
  const { createAttachmentStore } = await import("../src/store/attachments.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-attachments-")); roots.push(root);
  return { root, store: createAttachmentStore(path.join(root, "attachments")) };
}

test("F1/F5: uploaded files are local copies and survive recreating the store", async () => {
  const { root, store } = await fixture();
  const bytes = new TextEncoder().encode("Материал: непрерывность функции");
  const [file] = await store.save([{ name: "лекция 1.md", bytes }]);
  assert.ok(file);
  assert.equal(file.name, "лекция 1.md");
  assert.equal(file.size, bytes.length);
  assert.deepEqual(new Uint8Array(fs.readFileSync(file.path)), bytes);
  const { createAttachmentStore } = await import("../src/store/attachments.ts");
  const reopened = createAttachmentStore(path.join(root, "attachments"));
  assert.equal(reopened.get(file.id)?.path, file.path);
  assert.equal(reopened.get(file.id)?.name, file.name);
  assert.match(file.url, /^\/api\/attachments\/[a-f0-9-]+$/);
});

test("F7: one unsupported file rejects the whole batch without persisting partial uploads", async () => {
  const { root, store } = await fixture();
  await assert.rejects(store.save([
    { name: "notes.txt", bytes: new TextEncoder().encode("valid") },
    { name: "office.docx", bytes: new Uint8Array([80, 75, 3, 4]) },
  ]), /format|supported/i);
  const dir = path.join(root, "attachments");
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], []);
});

test("F7: forged image content, unsafe names and oversized batches are refused", async () => {
  const { store } = await fixture();
  await assert.rejects(store.save([{ name: "fake.png", bytes: new TextEncoder().encode("not an image") }]), /image|content|format/i);
  await assert.rejects(store.save([{ name: "../../escape.txt", bytes: new Uint8Array([65]) }]), /name|path/i);
  await assert.rejects(store.save([{ name: "huge.txt", bytes: new Uint8Array(25 * 1024 * 1024 + 1) }]), /25|large|limit/i);
  assert.equal(store.get("../../etc/passwd"), null);
});

test("F4/F6: an image-only message reaches the provider as genuine image content", async () => {
  const { store } = await fixture();
  const [file] = await store.save([{ name: "задача.png", bytes: png }]);
  assert.ok(file);
  const native = [newUserMessage(quoteFilePath(file.path))];
  const before = JSON.stringify(native);
  const { hydrateAttachmentMessages } = await import("../src/server/attachments.ts");
  const messages = await hydrateAttachmentMessages(toLlmMessages(native), store);
  assert.equal(JSON.stringify(native), before, "model enrichment must not modify persisted history");
  const content = messages[0]!.content;
  assert.ok(Array.isArray(content));
  const image = content.find(block => block.type === "image");
  assert.ok(image && image.type === "image");
  assert.equal(image?.mimeType, "image/png");
  assert.deepEqual(Buffer.from(image!.data, "base64"), png);
});

test("F2/F3/F6: teaching answers and practice-thinking both carry uploaded images", async () => {
  const { store } = await fixture();
  const [file] = await store.save([{ name: "solution.png", bytes: png }]);
  assert.ok(file);
  const reference = quoteFilePath(file.path);
  const thinking = newThinkingMessage("problem-1", `Моё решение ${reference}`);
  const answer = newAnswerResult("question-1", "ask", { kind: "ask", question: "Explain", answer: reference, thinking: reference });
  const { hydrateAttachmentMessages } = await import("../src/server/attachments.ts");
  for (const input of [thinking, answer]) {
    const [message] = await hydrateAttachmentMessages(toLlmMessages([input]), store);
    assert.ok(message);
    assert.ok(Array.isArray(message.content));
    assert.equal(message.content.filter((block: { type: string }) => block.type === "image").length, 1, "each mode includes its file once");
  }
});

test("F6: text and PDF attachments provide actual text with source labels", async () => {
  const { store } = await fixture();
  const files = await store.save([
    { name: "notes.md", bytes: new TextEncoder().encode("# Определение\nНепрерывность") },
    { name: "lecture.pdf", bytes: tinyPdf([{ runs: [{ text: "A continuous function", x: 72, y: 700 }] }]) },
  ]);
  const { hydrateAttachmentMessages } = await import("../src/server/attachments.ts");
  const messages = await hydrateAttachmentMessages(toLlmMessages([newUserMessage(files.map(file => quoteFilePath(file.path)).join(" "))]), store);
  const text = JSON.stringify(messages);
  assert.match(text, /Непрерывность/);
  assert.match(text, /A continuous function/);
  assert.match(text, /lecture\.pdf/);
});

test("F7: arbitrary external file paths are never read as managed uploads", async () => {
  const { root, store } = await fixture();
  const external = path.join(root, "private.txt"); fs.writeFileSync(external, "DO_NOT_READ_THIS");
  const { hydrateAttachmentMessages } = await import("../src/server/attachments.ts");
  const messages = await hydrateAttachmentMessages(toLlmMessages([newUserMessage(quoteFilePath(external))]), store);
  assert.doesNotMatch(JSON.stringify(messages), /DO_NOT_READ_THIS/);
});

test("F5/F7: a missing managed file produces an explicit unavailable notice", async () => {
  const { store } = await fixture();
  const [file] = await store.save([{ name: "notes.txt", bytes: new TextEncoder().encode("original") }]);
  assert.ok(file);
  fs.unlinkSync(file.path);
  const { hydrateAttachmentMessages } = await import("../src/server/attachments.ts");
  const messages = await hydrateAttachmentMessages(toLlmMessages([newUserMessage(quoteFilePath(file.path))]), store);
  assert.match(JSON.stringify(messages), /unavailable|missing|недоступ/i);
  assert.doesNotMatch(JSON.stringify(messages), /original/);
});

test("F1/F7: multipart upload and download preserve bytes and reject cross-origin writes", async () => {
  const { store } = await fixture();
  const { attachmentUploadResponse, attachmentContentResponse } = await import("../src/server/attachments.ts");
  const form = new FormData(); form.append("files", new File([new Uint8Array(png)], "figure.png", { type: "image/png" }));
  const uploaded = await attachmentUploadResponse(new Request("http://localhost/api/attachments", { method: "POST", body: form }), store);
  assert.equal(uploaded.status, 200);
  const { files } = await uploaded.json() as { files: { id: string }[] };
  const downloaded = attachmentContentResponse(files[0]!.id, store);
  assert.equal(downloaded.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
  const foreign = await attachmentUploadResponse(new Request("http://localhost/api/attachments", { method: "POST", headers: { origin: "https://unrelated.example" }, body: new FormData() }), store);
  assert.equal(foreign.status, 403);
  assert.equal(attachmentContentResponse("../private", store).status, 404);
});

test("F7: upload body without a declared length is bounded before multipart parsing", async () => {
  const { store } = await fixture();
  const { attachmentUploadResponse } = await import("../src/server/attachments.ts");
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  const response = await attachmentUploadResponse(new Request("http://localhost/api/attachments", { method: "POST", body, duplex: "half", headers: { "content-type": "multipart/form-data; boundary=empty" } } as RequestInit), store);
  assert.equal(response.status, 413); assert.equal(cancelled, true);
});

test("F1: same-origin uploads use the addressed Host when Next normalizes its request URL", async () => {
  const { store } = await fixture();
  const { attachmentUploadResponse } = await import("../src/server/attachments.ts");
  const form = new FormData(); form.append("files", new File(["Material"], "notes.md"));
  const response = await attachmentUploadResponse(new Request("http://localhost:3000/api/attachments", {
    method: "POST", headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }, body: form,
  }), store);
  assert.equal(response.status, 200);
});

test("F6/F7: large materials use bounded excerpts and explicitly point to the remaining file", async () => {
  const { store } = await fixture();
  const [file] = await store.save([{ name: "large.md", bytes: new TextEncoder().encode("Материал ".repeat(200_000)) }]);
  assert.ok(file);
  const { hydrateAttachmentMessages } = await import("../src/server/attachments.ts");
  const messages = await hydrateAttachmentMessages(toLlmMessages([newUserMessage(quoteFilePath(file.path))]), store);
  assert.ok(Buffer.byteLength(JSON.stringify(messages)) < 80_000, "the allowed 25 MiB file must not expand unboundedly into context");
  assert.match(JSON.stringify(messages), /excerpt|truncat|фрагмент|сокращ/i);
  assert.match(JSON.stringify(messages), /read|PDF/);
});

test("F6/F7: repeated file references inline their contents once per provider request", async () => {
  const { store } = await fixture();
  const [file] = await store.save([{ name: "note.txt", bytes: new TextEncoder().encode("UNIQUE_ATTACHED_CONTENT") }]); assert.ok(file);
  const { hydrateAttachmentMessages } = await import("../src/server/attachments.ts");
  const reference = quoteFilePath(file.path);
  const messages = await hydrateAttachmentMessages(toLlmMessages([newUserMessage(reference), newUserMessage(`Use ${reference} again`)]), store);
  assert.equal(JSON.stringify(messages).split("UNIQUE_ATTACHED_CONTENT").length - 1, 1);
});

test("F7: a truncated image is refused by HTTP upload and never becomes invalid model image content", async () => {
  const { store } = await fixture();
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const { attachmentUploadResponse, hydrateAttachmentMessages } = await import("../src/server/attachments.ts");
  const form = new FormData(); form.append("files", new File([bytes], "broken.png", { type: "image/png" }));
  const response = await attachmentUploadResponse(new Request("http://localhost/api/attachments", { method: "POST", body: form }), store);
  assert.equal(response.status, 400);
  const [file] = await store.save([{ name: "broken.png", bytes }]); assert.ok(file);
  const messages = await hydrateAttachmentMessages(toLlmMessages([newUserMessage(quoteFilePath(file.path))]), store);
  assert.doesNotMatch(JSON.stringify(messages), /"type":"image"/);
  assert.match(JSON.stringify(messages), /unavailable|omitted|invalid|недоступ/i);
});
