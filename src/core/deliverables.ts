/** Download contents live in the native tool call, so they survive chat reloads. */
export const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
export interface DownloadInput {
	name: string;
	content: string;
	encoding?: "utf8" | "base64";
	mime_type?: string;
}
export interface DownloadDetails {
	kind: "file";
	name: string;
	size: number;
	encoding: "utf8" | "base64";
	mimeType: string;
}
export interface CopyTextInput {
	text: string;
	title?: string;
	language?: string;
}
const MIME: Record<string, string> = {
	txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values",
	json: "application/json", html: "text/html", css: "text/css", js: "text/javascript",
	svg: "image/svg+xml", tex: "application/x-tex", py: "text/x-python", xml: "application/xml",
	pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
	zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function prepareDownload(input: DownloadInput): DownloadDetails {
	if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 180 ||
		/[\\/\x00-\x1f<>:"|?*]/.test(input.name) || /[. ]$/.test(input.name) || /^\.{1,2}$/.test(input.name)) {
		throw new Error("Укажите имя файла без пути и служебных символов.");
	}
	if (typeof input.content !== "string") throw new Error("Не задано содержимое файла.");
	const encoding = input.encoding ?? "utf8";
	if (encoding !== "utf8" && encoding !== "base64") throw new Error("Кодировка должна быть utf8 или base64.");
	let size: number;
	if (encoding === "base64") {
		const data = input.content.replace(/\s/g, "");
		if (data.length > Math.ceil(MAX_DOWNLOAD_BYTES / 3) * 4) throw new Error("Максимальный размер файла — 10 МБ.");
		if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
			throw new Error("Неверное содержимое base64. Передайте данные без префикса data:.");
		}
		size = data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
	} else {
		if (input.content.length > MAX_DOWNLOAD_BYTES) throw new Error("Максимальный размер файла — 10 МБ.");
		size = new TextEncoder().encode(input.content).byteLength;
	}
	if (size > MAX_DOWNLOAD_BYTES) throw new Error("Максимальный размер файла — 10 МБ.");
	const mimeType = input.mime_type ?? MIME[input.name.split(".").at(-1)!.toLowerCase()] ??
		(encoding === "utf8" ? "text/plain" : "application/octet-stream");
	if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) throw new Error("Неверный MIME-тип файла.");
	return { kind: "file", name: input.name, size, encoding, mimeType };
}

export function downloadContent(input: DownloadInput): Uint8Array<ArrayBuffer> {
	const details = prepareDownload(input);
	if (details.encoding === "utf8") return new TextEncoder().encode(input.content);
	const binary = atob(input.content.replace(/\s/g, ""));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
