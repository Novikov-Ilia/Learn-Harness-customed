import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { MAX_ATTACHMENT_BYTES, type AttachmentFile, type AttachmentStore, type ChatAttachment } from "../core/attachments.ts";

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function safeName(name: string): boolean {
	return name.length > 0 && name.length <= 200 && name !== "." && name !== ".." && !/[/\\\x00-\x1f\x7f]/.test(name);
}
function mimeOf(file: AttachmentFile): string {
	if (!safeName(file.name)) throw new Error("Invalid attachment name or path.");
	const extension = path.extname(file.name).toLowerCase();
	const b = file.bytes;
	const magic = (values: number[], offset = 0) => values.every((value, i) => b[offset + i] === value);
	if (extension === ".png" && magic([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
	if ((extension === ".jpg" || extension === ".jpeg") && magic([255, 216, 255])) return "image/jpeg";
	if (extension === ".webp" && magic([82, 73, 70, 70]) && magic([87, 69, 66, 80], 8)) return "image/webp";
	if (extension === ".pdf" && magic([37, 80, 68, 70, 45])) return "application/pdf";
	if ([".txt", ".md", ".markdown"].includes(extension)) {
		try { new TextDecoder("utf-8", { fatal: true }).decode(b); }
		catch { throw new Error("Text attachment content must be UTF-8."); }
		if (b.includes(0)) throw new Error("Binary content is not a supported text format.");
		return extension === ".txt" ? "text/plain" : "text/markdown";
	}
	throw new Error("Unsupported attachment format or invalid image/PDF content. Use PDF, PNG, JPEG, WebP, TXT or MD.");
}

export function createAttachmentStore(directory = path.join(PATHS.data, "attachments")): AttachmentStore {
	const root = path.resolve(directory);
	function get(id: string): ChatAttachment | null {
		if (!ID.test(id)) return null;
		try {
			const meta = JSON.parse(fs.readFileSync(path.join(root, id, "metadata.json"), "utf8")) as ChatAttachment;
			if (meta.id !== id || !safeName(meta.name) || !Number.isSafeInteger(meta.size) || meta.size < 0 || typeof meta.mimeType !== "string") return null;
			return { id, name: meta.name, mimeType: meta.mimeType, size: meta.size,
				path: path.join(root, id, meta.name), url: `/api/attachments/${id}` };
		} catch { return null; }
	}
	return {
		async save(files) {
			if (!files.length) throw new Error("Choose at least one attachment.");
			if (files.length > 100 || files.reduce((n, f) => n + f.bytes.byteLength, 0) > MAX_ATTACHMENT_BYTES) throw new Error("Attachment limit: 25 MiB per upload.");
			// Validate the entire batch before writing any member of it.
			const types = files.map(mimeOf);
			const records: ChatAttachment[] = [];
			try {
				fs.mkdirSync(root, { recursive: true, mode: 0o700 });
				for (const [i, file] of files.entries()) {
					const id = randomUUID();
					const folder = path.join(root, id);
					const record: ChatAttachment = { id, name: file.name, mimeType: types[i]!, size: file.bytes.byteLength,
						path: path.join(folder, file.name), url: `/api/attachments/${id}` };
					records.push(record);
					fs.mkdirSync(folder, { mode: 0o700 });
					fs.writeFileSync(record.path, file.bytes, { mode: 0o600 });
					fs.writeFileSync(path.join(folder, "metadata.json"), JSON.stringify(record), { mode: 0o600 });
				}
				return records;
			} catch (error) {
				for (const record of records) fs.rmSync(path.dirname(record.path), { recursive: true, force: true });
				throw error;
			}
		},
		get,
		getByPath(filePath) {
			const candidate = path.resolve(filePath);
			const relative = path.relative(root, candidate);
			const parts = relative.split(path.sep);
			if (parts.length !== 2 || !ID.test(parts[0]!)) return null;
			const record = get(parts[0]!);
			return record?.path === candidate ? record : null;
		},
		read(id) {
			const record = get(id);
			if (!record) throw new Error("Attachment unavailable.");
			const stat = fs.lstatSync(record.path);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ATTACHMENT_BYTES) throw new Error("Attachment unavailable or too large.");
			return new Uint8Array(fs.readFileSync(record.path));
		},
	};
}

export const attachmentStore = createAttachmentStore();
