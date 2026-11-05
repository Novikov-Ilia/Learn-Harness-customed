import { graphActionFailure, readGraphMutation, renameGraphRegion } from "@/src/server";
export async function PATCH(request: Request) {
	try {
		const body = await readGraphMutation(request);
		if (typeof body.id !== "string" || typeof body.name !== "string") throw new Error("Region id and name are required.");
		renameGraphRegion(body.id, body.name); return Response.json({ renamed: true });
	} catch (error) { return graphActionFailure(error); }
}
