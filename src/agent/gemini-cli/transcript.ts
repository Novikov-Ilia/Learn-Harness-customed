import type { ContentBlock } from "@agentclientprotocol/sdk";
import type { Message } from "@earendil-works/pi-ai";
/** LearnHarness owns history; replay restores content and images, not CLI saved sessions. */
export function geminiReplay(messages: Message[]): ContentBlock[] {
	const blocks: ContentBlock[] = [];
	for (const message of messages) {
		if (message.role === "system") continue;
		const label = message.role === "toolResult" ? `[tool result ${message.toolName}${message.isError ? " error" : ""}]` : `[${message.role}]`;
		blocks.push({ type: "text", text: label });
		if (typeof message.content === "string") { blocks.push({ type: "text", text: message.content }); continue; }
		for (const block of message.content) {
			if (block.type === "text") blocks.push({ type: "text", text: block.text });
			else if (block.type === "image") blocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
			else if (block.type === "toolCall") blocks.push({ type: "text", text: `[tool call ${block.name}] ${JSON.stringify(block.arguments)}` });
		}
	}
	return blocks;
}
