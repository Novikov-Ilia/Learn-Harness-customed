import { explainGraphNode, graphActionFailure } from "@/src/server";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	try { const { id } = await params; return Response.json(await explainGraphNode(id, request.signal)); }
	catch (error) { return graphActionFailure(error); }
}
