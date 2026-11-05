import { createChatBranch, ChatBranchError, stores, isTurnRunning, compactionInFlight } from "@/src/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = await req.json().catch(() => null) as { title?: unknown; requestId?: unknown; blockId?: unknown } | null;
	if (!body || typeof body.requestId !== "string" || (body.title !== undefined && typeof body.title !== "string") || (body.blockId !== undefined && typeof body.blockId !== "string")) return Response.json({ error: "Invalid branch request" }, { status: 400 });
	try {
		const child = createChatBranch(id, { requestId: body.requestId, title: body.title as string | undefined, blockId: body.blockId as string | undefined }, { chatStore: stores.chatStore, isBusy: (chatId) => isTurnRunning(chatId) || compactionInFlight(chatId) });
		return Response.json({ id: child.id, title: child.title });
	} catch (error) {
		return Response.json({ error: error instanceof ChatBranchError ? error.message : "The branch could not be saved. Please try again." }, { status: error instanceof ChatBranchError ? error.status : 500 });
	}
}
