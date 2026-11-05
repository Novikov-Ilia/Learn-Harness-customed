import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { prepareDownload, downloadContent, MAX_DOWNLOAD_BYTES } from "../src/core/deliverables.ts";
import { DownloadCard, CopyTextCard } from "../components/artifacts/delivery-card.tsx";
import { createDeliveryTools } from "../src/agent/tools/deliverables.ts";
import { projectView } from "../src/core/view.ts";
import type { ArtifactPartProps } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-deliverables-"));
const oldData = process.env.LH_DATA_DIR, oldAuth = process.env.LH_AUTH_FILE;
process.env.LH_DATA_DIR = path.join(scratch, "data");
process.env.LH_AUTH_FILE = path.join(scratch, "auth.json");
after(() => {
	if (oldData === undefined) delete process.env.LH_DATA_DIR; else process.env.LH_DATA_DIR = oldData;
	if (oldAuth === undefined) delete process.env.LH_AUTH_FILE; else process.env.LH_AUTH_FILE = oldAuth;
	fs.rmSync(scratch, { recursive: true, force: true });
});

test("downloads preserve exact UTF-8 and binary bytes, including whitespace and Unicode names", () => {
	const text = "  Формула: α + β\n\tстрока 2\n";
	const input = { name: "Формулы.txt", content: text };
	assert.equal(new TextDecoder().decode(downloadContent(input)), text);
	assert.equal(prepareDownload(input).size, Buffer.byteLength(text));
	assert.equal(prepareDownload(input).mimeType, "text/plain");
	const bytes = Buffer.from([0, 255, 10, 13, 128]);
	assert.deepEqual(Buffer.from(downloadContent({ name: "bytes.bin", content: bytes.toString("base64"), encoding: "base64" })), bytes);
	assert.equal(prepareDownload({ name: "empty.txt", content: "" }).size, 0);
});

test("invalid filenames, MIME types, binary payloads and oversized files are rejected", () => {
	for (const name of ["../file", "a\\b", "", "..", "bad\nname", "a.txt "]) assert.throws(() => prepareDownload({ name, content: "x" }));
	for (const content of ["not base64!", "a==", "data:image/png;base64,AAAA"]) assert.throws(() => prepareDownload({ name: "a.bin", content, encoding: "base64" }));
	assert.throws(() => prepareDownload({ name: "a.txt", content: "x", mime_type: "text/plain\r\nX: a" }));
	assert.throws(() => prepareDownload({ name: "a.txt", content: "я".repeat(MAX_DOWNLOAD_BYTES / 2 + 1) }), /10 МБ/);
	// Exercise a large valid payload: validation must not overflow the regexp stack.
	assert.equal(prepareDownload({ name: "a.bin", content: Buffer.alloc(1024 * 1024).toString("base64"), encoding: "base64" }).size, 1024 * 1024);
});

test("both delivery tools persist through native transcript serialization and view projection", async () => {
	const tools = createDeliveryTools();
	const inputs: Record<string, string>[] = [{ name: "Заметка.md", content: "# Теорема\n" }, { title: "Команда", text: "  <script>alert(1)</script>\n", language: "text" }];
	const messages: LhMessage[] = [];
	for (const [index, tool] of tools.entries()) {
		const id = `deliver-${index}`;
		messages.push({ ...fauxAssistantMessage([fauxToolCall(tool.name, inputs[index]!, { id })]), id: `assistant-${index}` } as LhMessage);
		const result = await tool.execute(id, inputs[index]);
		messages.push({ id: `result-${index}`, role: "toolResult", toolCallId: id, toolName: tool.name, ...result, isError: false, timestamp: index } as LhMessage);
	}
	const projected = projectView(JSON.parse(JSON.stringify(messages)));
	const parts = projected.flatMap((message) => message.parts).filter((part) => part.type.startsWith("tool-")) as ArtifactPartProps["part"][];
	assert.equal(parts.length, 2);
	assert(parts.every((part) => part.state === "output-available"));
	const fileHtml = renderToStaticMarkup(<DownloadCard part={parts[0]!} />);
	assert.match(fileHtml, /Скачать Заметка.md/);
	const textHtml = renderToStaticMarkup(<CopyTextCard part={parts[1]!} />);
	assert.match(textHtml, /Скопировать/);
	assert.match(textHtml, /&lt;script&gt;/);
	assert(!textHtml.includes("<script>"), "content must remain text, never executable markup");
	assert.equal((parts[1]!.input as { text: string }).text, inputs[1]!.text);
});

test("all conversation roles get delivery tools; explicitly injected registries remain caller-owned", async () => {
	const { createProberAgent, createTeacherAgent, createPracticeAgent } = await import("../src/agent/teacher-agent.ts");
	const { createPlanningAgent } = await import("../src/agent/planning-agent.ts");
	const { chatStore } = await import("../src/store/chats.ts");
	const { jobStore } = await import("../src/store/jobs.ts");
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	const chatId = chatStore.createChat("Delivery test").id;
	const proberContext = { chatId, chatStore, jobStore, deliver: () => {}, spawn: () => {} };
	for (const agent of [createProberAgent(proberContext, { engine }), createTeacherAgent(undefined, { engine }), createPracticeAgent({ chatId, chatStore }, { engine }), createPlanningAgent({ chatId, chatStore }, { engine })]) {
		for (const name of ["create_file", "copy_text"]) {
			const tool = agent.state.tools.find((item) => item.name === name);
			assert(tool); assert.equal(typeof tool.prepareArguments, "function");
		}
	}
	assert.deepEqual(createTeacherAgent(undefined, { engine, tools: {} }).state.tools, []);
});
