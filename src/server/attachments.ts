import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { parseFilePaths } from "../core/file-paths.ts";
import { estimateTokens } from "../core/compaction.ts";
import { MAX_ATTACHMENT_BYTES, type AttachmentStore } from "../core/attachments.ts";
import { attachmentStore } from "../store/attachments.ts";
import { convertPdf } from "../agent/subagents/pdf-ops.ts";
import { joinPages } from "../agent/subagents/pdf-markdown.ts";
import { processImage } from "../agent/image-processing/index.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";

export interface AttachmentHydrationOptions { model?: Pick<Model<Api>, "input" | "inputLimits" | "contextWindow"> }
const MAX_INLINE_TEXT_BYTES = 64 * 1024;
const MAX_FILE_EXCERPT_BYTES = 32 * 1024;
function excerpt(text: string, limit: number): { text: string; truncated: boolean } {
	const bytes = Buffer.from(text);
	if (bytes.length <= limit) return { text, truncated: false };
	// Ignore an incomplete final UTF-8 code point rather than corrupting it.
	const decoder = new TextDecoder();
	return { text: decoder.decode(bytes.subarray(0, Math.max(0, limit)), { stream: true }), truncated: true };
}

function referencedPaths(text: string): string[] {
	const paths = parseFilePaths(text).flatMap(part => part.kind === "path" ? [part.path] : []);
	// Answer tool results contain JSON-escaped learner fields, including filenames with quotes.
	try {
		const collect = (value: unknown): void => {
			if (typeof value === "string") paths.push(...parseFilePaths(value).flatMap(part => part.kind === "path" ? [part.path] : []));
			else if (Array.isArray(value)) value.forEach(collect);
			else if (value && typeof value === "object") Object.values(value).forEach(collect);
		};
		collect(JSON.parse(text));
	} catch { /* Ordinary prose is not JSON. */ }
	return paths;
}

/** Enrich the model projection only. Persisted history retains durable file references. */
export async function hydrateAttachmentMessages(messages: readonly Message[], store: AttachmentStore = attachmentStore, options: AttachmentHydrationOptions = {}): Promise<Message[]> {
	const emitted = new Set<string>();
	const window = options.model?.contextWindow;
	let remainingTokens = window ? Math.max(0, window - estimateTokens(messages as readonly AgentMessage[]) - Math.min(16_384, Math.floor(window / 3))) : Number.POSITIVE_INFINITY;
	let textBytesLeft = Math.min(MAX_INLINE_TEXT_BYTES, remainingTokens);
	const out: Message[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "toolResult") { out.push(message); continue; }
		const original = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
		const paths = original.flatMap(block => block.type === "text" ? referencedPaths(block.text) : []);
		const used = new Set<string>();
		const additions: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [];
		for (const filePath of paths) {
			const file = store.getByPath(filePath);
			if (!file || used.has(file.id) || emitted.has(file.id)) continue;
			used.add(file.id);
			emitted.add(file.id);
			let block: { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
				try {
					const bytes = store.read(file.id);
					if (file.mimeType.startsWith("image/")) {
						if (options.model && !options.model.input.includes("image")) throw new Error("The selected model does not accept images. Select a vision-capable model.");
						if (remainingTokens < 1_400) block = { type: "text", text: `[Image ${file.name} remains attached; inline context budget exhausted. Use the read tool on its attached path when needed.]` };
						else {
							const processed = await processImage(bytes, file.mimeType, { resizeOptions: options.model?.inputLimits?.images?.resize });
							if (!processed.ok) throw new Error(processed.message);
							block = { type: "image", data: processed.data, mimeType: processed.mimeType };
							remainingTokens -= 1_200;
							textBytesLeft = Math.min(textBytesLeft, remainingTokens);
						}
					} else {
						let text: string;
						let notice = "";
						if (file.mimeType === "application/pdf") {
						const pdf = await convertPdf(bytes, 1000);
						if (pdf.kind !== "converted") throw new Error(pdf.kind === "too-long" ? "PDF exceeds 1,000 pages." : "Could not read PDF.");
						text = joinPages(pdf.pages);
						const skipped = pdf.pages.filter(page => page.kind === "image-only").length;
						notice = skipped ? `\n[${skipped} image-only pages: use the PDF reading tool for their content.]` : "";
						if (!text) notice += "\nNo extractable text; use the PDF reading tool on the attached path for scanned pages.";
						} else text = new TextDecoder().decode(bytes);
						const portion = excerpt(text, Math.min(MAX_FILE_EXCERPT_BYTES, textBytesLeft));
						const consumed = Buffer.byteLength(portion.text);
						textBytesLeft = Math.max(0, textBytesLeft - consumed); remainingTokens = Math.max(0, remainingTokens - consumed);
						block = { type: "text", text: `[Attached file: ${file.name}]\n${portion.text}${portion.truncated ? "\n[Excerpt truncated to fit context. Use the read/PDF reading tool on the attached path for the remaining material.]" : ""}${notice}` };
					}
				} catch (error) {
					block = { type: "text", text: `[Attachment unavailable: ${file.name}. ${error instanceof Error ? error.message : "Could not read file."}]` };
				}
			additions.push(block);
		}
		out.push(additions.length ? { ...message, content: [...original, ...additions] } as Message : message);
	}
	return out;
}

export async function attachmentUploadResponse(request: Request, store: AttachmentStore = attachmentStore): Promise<Response> {
	const origin = request.headers.get("origin");
	if (origin && origin !== subscriptionRequestOrigin(request)) return Response.json({ error: "Cross-origin upload refused." }, { status: 403 });
	const maxBody = MAX_ATTACHMENT_BYTES + 1024 * 1024;
	if (Number(request.headers.get("content-length")) > maxBody) return Response.json({ error: "Attachment limit: 25 MiB." }, { status: 413 });
	let form: FormData;
	try {
		const reader = request.body?.getReader();
		if (!reader) throw new Error("Missing upload body.");
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read(); if (done) break;
				size += value.byteLength;
				if (size > maxBody) { await reader.cancel(); return Response.json({ error: "Attachment limit: 25 MiB." }, { status: 413 }); }
				chunks.push(value);
			}
		} finally { reader.releaseLock(); }
		form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
	} catch { return Response.json({ error: "Invalid attachment upload." }, { status: 400 }); }
	const files = form.getAll("files").filter((item): item is File => typeof item !== "string");
	try {
		const inputs = await Promise.all(files.map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
		if (inputs.length > 100 || inputs.reduce((sum, file) => sum + file.bytes.byteLength, 0) > MAX_ATTACHMENT_BYTES) return Response.json({ error: "Attachment limit: 25 MiB per upload." }, { status: 413 });
		for (const file of inputs) {
			if (/\.(png|jpe?g|webp)$/i.test(file.name)) {
				const mime = /\.png$/i.test(file.name) ? "image/png" : /\.webp$/i.test(file.name) ? "image/webp" : "image/jpeg";
				const checked = await processImage(file.bytes, mime);
				if (!checked.ok) throw new Error(`Invalid image: ${checked.message}`);
			}
		}
		const saved = await store.save(inputs);
		return Response.json({ files: saved });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Could not save attachments.";
		return Response.json({ error: message }, { status: /^Attachment limit:/i.test(message) ? 413 : 400 });
	}
}

export function attachmentContentResponse(id: string, store: AttachmentStore = attachmentStore): Response {
	const file = store.get(id);
	if (!file) return Response.json({ error: "Attachment not found." }, { status: 404 });
	try {
		return new Response(Buffer.from(store.read(id)), { headers: {
			"Content-Type": file.mimeType,
			"Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "private, no-store",
			"Content-Security-Policy": "sandbox",
		} });
	} catch { return Response.json({ error: "Attachment unavailable." }, { status: 404 }); }
}
