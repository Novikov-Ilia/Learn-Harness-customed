import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-graph-workbench-route-"));
process.env.LH_DATA_DIR = directory; process.env.LH_AUTH_FILE = path.join(directory, "auth.json"); fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const { GET } = await import("../app/api/graph/route.ts");
const { PATCH } = await import("../app/api/graph/regions/route.ts");
const { POST: reprocess } = await import("../app/api/graph/reprocess/route.ts");
const { DELETE: remove } = await import("../app/api/graph/nodes/[id]/route.ts");
const { stores } = await import("../src/server/stores.ts");
const { claimGraphMaintenance } = await import("../src/core/graph-maintenance.ts");
const { graphPersonalizationStore } = await import("../src/store/graph-personalization.ts");
const chat = stores.chatStore.createChat("Original source title");
for (const id of ["a", "b", "c"]) stores.graphStore.appendNode({ id, name: id, statement: `Proposition ${id}`, aliases: [], createdAt: "2026-11-04", provenance: [{ chatId: chat.id, messageId: "passage" }] });
const rename = (body: unknown) => PATCH(new Request("http://localhost/api/graph/regions", { method: "PATCH", body: JSON.stringify(body) }));

it("region HTTP mutation updates the graph label independently of chat renames and leaves the layout and ledgers intact", async () => {
	const before = stores.graphStore.readNodes(); stores.graphStore.writePositions({ a: { x: 1, y: 2 } });
	assert.equal((await rename({ id: chat.id, name: "My independent region" })).status, 200);
	stores.chatStore.renameChat(chat.id, "Renamed source");
	const snapshot = await (await GET()).json();
	assert.equal(snapshot.clusters[0].label, "My independent region"); assert.equal(snapshot.sessions[chat.id], "Renamed source");
	assert.deepEqual(stores.graphStore.readNodes(), before); assert.deepEqual(stores.graphStore.readPositions(), { a: { x: 1, y: 2 } });
});

it("graph endpoints honestly refuse malformed, oversized, stale and unconfigured requests", async () => {
	assert.equal((await rename({ id: chat.id, name: " " })).status, 400);
	assert.equal((await rename({ id: "missing", name: "Name" })).status, 404);
	assert.equal((await PATCH(new Request("http://localhost/api/graph/regions", { method: "PATCH", body: "{" }))).status, 400);
	assert.equal((await rename({ id: chat.id, name: "x".repeat(17_000) })).status, 400);
	const unavailable = await reprocess(); assert.equal(unavailable.status, 503); assert.match((await unavailable.json()).error, /model/i);
});

it("real node-deletion endpoint cannot mutate the graph while the reanalysis maintenance lock is held", async () => {
	graphPersonalizationStore.write({ ...graphPersonalizationStore.read(), groups: [{ id: "topic_test", name: "A topic", nodeIds: ["a", "b"] }], explanations: { a: { text: "Saved explanation to remove", generatedAt: "2026-11-04" } } });
	const release = claimGraphMaintenance(), before = stores.graphStore.readNodes();
	try {
		const response = await remove(new Request("http://localhost/api/graph/nodes/a", { method: "DELETE" }), { params: Promise.resolve({ id: "a" }) });
		assert.equal(response.status, 409); assert.deepEqual(stores.graphStore.readNodes(), before);
	} finally { release(); }
	assert.equal((await remove(new Request("http://localhost/api/graph/nodes/a", { method: "DELETE" }), { params: Promise.resolve({ id: "a" }) })).status, 200);
	const snapshot = await (await GET()).json(); assert.ok(!snapshot.propositions.some((node: { id: string }) => node.id === "a"));
	assert.equal(graphPersonalizationStore.read().explanations.a, undefined); assert.deepEqual(graphPersonalizationStore.read().groups, []);
	assert.ok(stores.chatStore.getChat(chat.id), "deleting a knowledge must preserve its source chat");
});
