import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { prepareDownload } from "../../core/deliverables.ts";
import { serverExecute } from "../tool-execute.ts";

const fileInput = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 180, description: "Download filename with extension, without a directory path." }),
	content: Type.String({ maxLength: 14 * 1024 * 1024, description: "Exact file contents as UTF-8 text, or actual binary bytes encoded as base64." }),
	encoding: Type.Optional(Type.Union([Type.Literal("utf8"), Type.Literal("base64")], { description: "Defaults to utf8. Use base64 for actual binary data." })),
	mime_type: Type.Optional(Type.String({ maxLength: 120, description: "Optional MIME type; normally inferred from the filename." })),
});
const textInput = Type.Object({
	text: Type.String({ minLength: 1, maxLength: 1_000_000, description: "Exact text to copy, preserving all whitespace. Do not wrap in Markdown fences." }),
	title: Type.Optional(Type.String({ minLength: 1, maxLength: 180, description: "Short title for the text block." })),
	language: Type.Optional(Type.String({ maxLength: 50, description: "Optional code language label, e.g. python, latex, json." })),
});

/** Conversation output tools: transcript-backed, no arbitrary filesystem writes. */
export function createDeliveryTools(): AgentTool<any>[] {
	return [{
		name: "create_file", label: "Создать файл",
		description: "Create a downloadable file in this chat. Use for requested notes, Markdown, TXT, CSV, JSON, source code and other files. " +
			"The learner sees a Download button and can download again after reopening the chat. Maximum 10 MiB. " +
			"UTF-8 creates text files; base64 accepts actual binary file data. Renaming text to .pdf or .docx does not convert it. " +
			"This creates a chat attachment, not a local filesystem path. Use copy_text for a copyable snippet. Does not end your turn.",
		parameters: fileInput,
		execute: serverExecute("create_file", fileInput, (input) => prepareDownload(input)),
	}, {
		name: "copy_text", label: "Текст для копирования",
		description: "Display a separate text or code block with a Copy button. Use when the learner needs to copy a prompt, formula source, command, code or any exact text. " +
			"Pass the original text with its whitespace, without Markdown fences. The block persists in chat history. Does not end your turn.",
		parameters: textInput,
		execute: serverExecute("copy_text", textInput, (input) => ({ kind: "copy_text", title: input.title ?? "Текст для копирования" })),
	}];
}
