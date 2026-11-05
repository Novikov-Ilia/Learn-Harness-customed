/** Managed chat uploads. References use the existing quoted-path syntax. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.markdown";
export interface ChatAttachment {
	id: string;
	name: string;
	mimeType: string;
	size: number;
	path: string;
	url: string;
}
export interface AttachmentFile {
	name: string;
	bytes: Uint8Array;
}
export interface AttachmentStore {
	save(files: readonly AttachmentFile[]): Promise<ChatAttachment[]>;
	get(id: string): ChatAttachment | null;
	getByPath(filePath: string): ChatAttachment | null;
	read(id: string): Uint8Array;
}

/** Only paths minted by our store get a preview URL; ordinary local paths stay chips. */
export function attachmentPreview(path: string): { url: string; image: boolean } | null {
	const match = /[/\\]attachments[/\\]([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})[/\\]([^/\\]+)$/i.exec(path);
	if (!match) return null;
	return { url: `/api/attachments/${match[1]}`, image: /\.(?:png|jpe?g|webp)$/i.test(match[2]!) };
}
