import { getChat, learningNoteError } from "@/src/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
	return Response.json({ kind: chat.kind ?? "teach", title: chat.title, parentId: chat.parentId, note: chat.learningNote ?? null, error: learningNoteError(id) ?? chat.learningNoteError, tree: chat.tree ?? null });
}
