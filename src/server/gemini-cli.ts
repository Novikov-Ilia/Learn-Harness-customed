import { geminiConnection } from "../agent/gemini-cli/connection.ts";
import { streamGeminiCli } from "../agent/gemini-cli/stream.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";
import { emit } from "../core/events.ts";
interface ConnectionPort { status(): Promise<unknown>; connect(): Promise<void>; disconnect(): Promise<void> }
const productionConnection: ConnectionPort = {
	status: () => geminiConnection.status(), connect: () => geminiConnection.connect(),
	disconnect: async () => { await streamGeminiCli.dispose(); await geminiConnection.disconnect(); },
};
/** Browser intent is same-origin; a public server still needs its own access control. */
export async function geminiCliConnectionResponse(request: Request, connection: ConnectionPort = productionConnection): Promise<Response> {
	const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
	const origin = subscriptionRequestOrigin(request); const supplied = request.headers.get("origin");
	if (!origin || request.headers.get("x-learnharness-gemini-cli") !== "1" || request.headers.get("sec-fetch-site") === "cross-site" || (supplied !== null && supplied !== origin)) return Response.json({ error: "Antigravity CLI actions require a same-origin LearnHarness request." }, { status: 403, headers });
	try {
		if (request.method === "GET") return Response.json(await connection.status(), { headers });
		if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
		let value: unknown; try { value = await request.json(); } catch { return Response.json({ error: "Invalid JSON body" }, { status: 400, headers }); }
		const action = value && typeof value === "object" ? (value as { action?: unknown }).action : undefined;
		if (action === "connect") await connection.connect();
		else if (action === "disconnect" || action === "cancel") await connection.disconnect();
		else return Response.json({ error: "Unknown Antigravity CLI connection action" }, { status: 400, headers });
		emit("subscriptions-changed", {});
		return Response.json(await connection.status(), { headers });
	} catch { return Response.json({ error: "Antigravity CLI connection could not be changed. Check the runtime and try again." }, { status: 500, headers }); }
}
