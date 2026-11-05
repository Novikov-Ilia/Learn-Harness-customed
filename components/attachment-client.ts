import { MAX_ATTACHMENT_BYTES, type ChatAttachment } from "../src/core/index.ts";

export function filesFromTransfer(transfer: DataTransfer | null | undefined): File[] {
	if (!transfer) return [];
	const files = Array.from(transfer.files ?? []);
	if (files.length) return files;
	return Array.from(transfer.items ?? []).flatMap(item => item.kind === "file" ? [item.getAsFile()].filter((file): file is File => file !== null) : []);
}

export async function uploadAttachments(files: readonly File[], fetchLike: typeof fetch = fetch, signal?: AbortSignal): Promise<ChatAttachment[]> {
	if (files.reduce((n, file) => n + file.size, 0) > MAX_ATTACHMENT_BYTES) throw new Error("Attachment limit: 25 MiB per upload.");
	const form = new FormData();
	files.forEach(file => form.append("files", file));
	const response = await fetchLike("/api/attachments", { method: "POST", body: form, signal });
	const body = await response.json() as { files?: ChatAttachment[]; error?: string };
	if (!response.ok || !Array.isArray(body.files)) throw new Error(body.error ?? "Could not upload attachments.");
	return body.files;
}
