import { abortGraphReprocessing, graphActionFailure, graphWorkbenchStatus, startGraphReprocessing } from "@/src/server";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json(graphWorkbenchStatus()); }
export async function POST() {
	try { startGraphReprocessing(); return Response.json({ started: true }, { status: 202 }); }
	catch (error) { return graphActionFailure(error); }
}
export async function DELETE() { return Response.json({ aborted: abortGraphReprocessing() }); }
