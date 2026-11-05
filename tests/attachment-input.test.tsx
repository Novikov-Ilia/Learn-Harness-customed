import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PathInput } from "../components/path-input.tsx";
import { dismissedAnswer } from "../src/core/question-core.ts";
import { pendingQuestionOf, type LhMessage } from "../src/core/native-messages.ts";
import { SessionModel } from "../components/session-core.ts";

test("F1/F2/F3: every multiline input exposes an attachment picker; single-line values do not", () => {
  for (const placeholder of ["New session", "Message", "Answer", "Your thinking", "Thinking while reading", "Practice solution"]) {
    const html = renderToStaticMarkup(<PathInput value="" onValueChange={() => {}} placeholder={placeholder} />);
    assert.match(html, /aria-label="Attach files"/);
    assert.match(html, /type="file"/);
    assert.match(html, /\.pdf/);
    assert.match(html, /\.webp/);
  }
  const html = renderToStaticMarkup(<PathInput value="" onValueChange={() => {}} singleLine />);
  assert.doesNotMatch(html, /type="file"/);
});

test("F1/F2: clipboard files take precedence over its accompanying HTML/plain text", async () => {
  const { filesFromTransfer } = await import("../components/attachment-client.ts");
  const png = new File([new Uint8Array([1, 2, 3])], "clipboard.png", { type: "image/png" });
  assert.deepEqual(filesFromTransfer({ files: [png], items: [] } as unknown as DataTransfer), [png]);
  assert.deepEqual(filesFromTransfer({ files: [], items: [{ kind: "file", getAsFile: () => png }] } as unknown as DataTransfer), [png]);
  assert.deepEqual(filesFromTransfer({ files: [], items: [] } as unknown as DataTransfer), []);
});

test("F4/F7: uploads carry multiple actual files; failed uploads never become draft references", async () => {
  const { uploadAttachments } = await import("../components/attachment-client.ts");
  const files = [new File(["A"], "один.md"), new File(["B"], "two.txt")];
  let calls = 0;
  const result = await uploadAttachments(files, async (url, init) => {
    calls++; assert.equal(url, "/api/attachments"); assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData); assert.equal(init.body.getAll("files").length, 2);
    return Response.json({ files: [{ id: "id", name: "один.md", path: "/managed/attachments/id/один.md", url: "/api/attachments/id", mimeType: "text/markdown", size: 1 }] });
  });
  assert.equal(calls, 1); assert.equal(result[0]!.name, "один.md");
  await assert.rejects(uploadAttachments(files, async () => Response.json({ error: "Upload limit exceeded" }, { status: 413 })), /Upload limit exceeded/);
});

test("Q1: a visible cancel action is available for an unanswered question", async () => {
  const { CancelQuestionButton } = await import("../components/cancel-question-button.tsx");
  const html = renderToStaticMarkup(<CancelQuestionButton onCancel={() => {}} />);
  assert.match(html, /button/); assert.match(html, /Cancel question/);
});

test("Q2/Q3: cancellation preserves preceding teaching and silently releases the pending question", async () => {
  const lesson = { id: "lesson", role: "assistant", content: [{ type: "text", text: "Previous explanation" }, { type: "toolCall", id: "q1", name: "ask_user_question", arguments: { question: "Explain this" } }], stopReason: "toolUse", timestamp: 1 } as unknown as LhMessage;
  const requests: string[] = [];
  const model = new SessionModel({ chatId: "fixture", initialMessages: [lesson], fetch: async (url) => { requests.push(String(url)); return Response.json({ ok: true }); } });
  const pending = pendingQuestionOf(model.getState().nativeMessages)!;
  assert.ok(pending);
  await model.dismissQuestion("q1", dismissedAnswer("ask", "Explain this"), pending.key);
  const state = model.getState();
  assert.equal(pendingQuestionOf(state.nativeMessages), null);
  assert.match(JSON.stringify(state.nativeMessages), /Previous explanation/);
  assert.equal(state.nativeMessages.at(-1)?.role, "toolResult");
  assert.equal((state.nativeMessages.at(-1) as { details?: { dismissed?: boolean } }).details?.dismissed, true);
  assert.deepEqual(requests, ["/api/chats/fixture/dismiss"], "cancel must not dispatch a teacher turn");
});
