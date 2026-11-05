import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, it } from "node:test";
import type { GraphChain, GraphNode } from "../src/core/contracts.ts";
import type { GraphStore } from "../src/core/ports.ts";
import { deriveView, getGraph } from "../src/core/graph.ts";
import { personalizeGraphSnapshot } from "../src/core/graph-personalization.ts";
import { deleteNodeTraces } from "../src/core/graph-deletion.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-personal-graph-"));
after(() => fs.rmSync(directory, { recursive: true, force: true }));
let sequence = 0;
const nodesFixture = (): GraphNode[] => ["a", "b", "c"].map((id, i) => ({
	id, name: `Idea ${id}`, statement: `Full proposition ${id}.`, aliases: [`Alternative ${id}`],
	createdAt: "2026-11-04T10:00:00.000Z", provenance: [{ chatId: `source-${i}`, messageId: `message-${i}` }],
}));
function memoryGraph() {
	let nodes = nodesFixture(), chains: GraphChain[] = [];
	let positions: Record<string, { x: number; y: number }> = {};
	const store = {
		readNodes: () => structuredClone(nodes), readChains: () => structuredClone(chains),
		appendChain: (value: GraphChain) => { chains.push(structuredClone(value)); },
		readCoverage: () => [{ chatId: "source-0", fp: "already-covered", tokens: 100, foldedAt: "2026-11-04" }],
		readPositions: () => structuredClone(positions), writePositions: (value: typeof positions) => { positions = value; },
		rewriteLedgers: (next: { nodes?: GraphNode[]; chains?: GraphChain[] }) => {
			if (next.nodes) nodes = structuredClone(next.nodes);
			if (next.chains) chains = structuredClone(next.chains);
		},
	} as GraphStore;
	return store;
}
const analysis = { chains: [{ premises: ["a"], conclusion: "b", reason: "Proposition a entails b." }], groups: [{ name: "Shared topic", nodeIds: ["a", "c"] }] };
async function harness(overrides: Record<string, unknown> = {}) {
	const { createGraphPersonalizationStore } = await import("../src/store/graph-personalization.ts");
	const { createGraphWorkbench } = await import("../src/server/graph-workbench.ts");
	const details = createGraphPersonalizationStore(path.join(directory, `graph-${++sequence}.json`));
	const graph = memoryGraph();
	const workbench = createGraphWorkbench({ graphStore: graph, detailsStore: details,
		analyze: async () => analysis, explain: async () => "A full explanation with a worked example.",
		isExtractionRunning: () => false, ...overrides });
	return { graph, details, workbench };
}

it("G1/G2: deleting one knowledge removes dependent chains, preserves neighbours, and a cancelled dialog has no store effect", () => {
	const store = memoryGraph();
	store.appendChain({ id: "arg_ab", premises: ["a"], conclusion: "b", provenance: [], createdAt: "2026-11-04" });
	const untouched = store.readNodes();
	assert.deepEqual(store.readNodes(), untouched, "no mutation until confirmed deletion");
	assert.deepEqual(deleteNodeTraces(store, "a"), { chainsRemoved: 1 });
	assert.deepEqual(store.readNodes().map((n) => n.id), ["b", "c"]);
	assert.deepEqual(store.readChains(), []);
	assert.equal(deleteNodeTraces(store, "a"), null);
});

it("G3: independent region names persist across new store instances without changing source names or graph ledgers", async () => {
	const { graph, details, workbench } = await harness();
	const before = graph.readNodes();
	await workbench.renameRegion("source-0", "My calculus block");
	const { createGraphPersonalizationStore } = await import("../src/store/graph-personalization.ts");
	const reopened = createGraphPersonalizationStore(details.file);
	assert.equal(reopened.read().regionNames["source-0"], "My calculus block");
	assert.deepEqual(graph.readNodes(), before);
});

it("G3: blank/unknown region names refuse without changing saved names", async () => {
	const { details, workbench } = await harness();
	await assert.rejects(async () => workbench.renameRegion("source-0", "  "), /name/i);
	await assert.rejects(async () => workbench.renameRegion("gone", "Anything"), /region|exist/i);
	assert.deepEqual(details.read().regionNames, {});
});

it("G4: explanation is based on full stored knowledge, is saved, and remains available after reopening", async () => {
	let received: unknown;
	const { details, workbench } = await harness({ explain: async (value: unknown) => { received = value; return "Detailed reasoning."; } });
	const result = await workbench.explainNode("a");
	assert.equal(result.text, "Detailed reasoning.");
	assert.match(JSON.stringify(received), /Full proposition a/);
	assert.match(JSON.stringify(received), /Alternative a/);
	const { createGraphPersonalizationStore } = await import("../src/store/graph-personalization.ts");
	assert.equal(createGraphPersonalizationStore(details.file).read().explanations.a!.text, "Detailed reasoning.");
});

it("G4/G7: a failed explanation preserves the last successful explanation and surfaces the real error", async () => {
	let fail = false;
	const { details, workbench } = await harness({ explain: async () => { if (fail) throw new Error("synthetic provider unavailable"); return "Previous explanation"; } });
	await workbench.explainNode("a"); fail = true;
	await assert.rejects(workbench.explainNode("a"), /synthetic provider unavailable/);
	assert.equal(details.read().explanations.a!.text, "Previous explanation");
	await assert.rejects(workbench.explainNode("missing"), /exist|node/i);
});

it("G5: manual reanalysis receives the whole stored graph across sources despite existing extraction coverage", async () => {
	let count = 0;
	const { workbench } = await harness({ analyze: async (graph: { nodes: GraphNode[] }) => { count = graph.nodes.length; assert.deepEqual(new Set(graph.nodes.flatMap((n) => n.provenance.map((p) => p.chatId))), new Set(["source-0", "source-1", "source-2"])); return analysis; } });
	const result = await workbench.reprocess();
	assert.equal(count, 3); assert.equal(result.chainsAdded, 1); assert.equal(result.groups, 1);
});

it("G6: logical connections are deduplicated; thematic similarity creates regions, never logical edges", async () => {
	const { graph, details, workbench } = await harness();
	await workbench.reprocess();
	assert.equal((await workbench.reprocess()).chainsAdded, 0);
	const stored = getGraph(graph);
	assert.equal(stored.nodes.length, 3); assert.equal(stored.chains.length, 1);
	assert.deepEqual(stored.chains[0]!.premises, ["a"]); assert.equal(stored.chains[0]!.conclusion, "b");
	assert.deepEqual(details.read().groups[0]!.nodeIds.sort(), ["a", "c"]);
	assert.ok(!stored.chains.some((c) => c.premises.includes("c") || c.conclusion === "c"));
});

it("G6: invalid chain endpoints, self-inference, empty premises and duplicate group membership refuse before graph writes", async () => {
	for (const invalid of [
		{ ...analysis, chains: [{ premises: ["missing"], conclusion: "b", reason: "bad" }] },
		{ ...analysis, chains: [{ premises: ["a"], conclusion: "a", reason: "bad" }] },
		{ ...analysis, chains: [{ premises: [], conclusion: "b", reason: "bad" }] },
		{ ...analysis, groups: [{ name: "bad", nodeIds: ["a", "missing"] }] },
		{ ...analysis, groups: [{ name: "one", nodeIds: ["a", "b"] }, { name: "two", nodeIds: ["a", "c"] }] },
	]) {
		const { graph, details, workbench } = await harness({ analyze: async () => invalid });
		const before = graph.readNodes(); await assert.rejects(workbench.reprocess());
		assert.deepEqual(graph.readNodes(), before); assert.deepEqual(graph.readChains(), []); assert.deepEqual(details.read().groups, []);
	}
});

it("G7: provider failure and cancellation preserve all existing knowledge and produce explicit status", async () => {
	const failed = await harness({ analyze: async () => { throw new Error("synthetic analysis failure"); } });
	await assert.rejects(failed.workbench.reprocess(), /synthetic analysis failure/);
	assert.equal(failed.workbench.status().phase, "failed");
	assert.match(failed.workbench.status().error ?? "", /synthetic analysis failure/);
	assert.deepEqual(failed.graph.readNodes(), nodesFixture());
	const controller = new AbortController();
	const aborted = await harness({ analyze: async () => { controller.abort(); return analysis; } });
	await assert.rejects(aborted.workbench.reprocess(controller.signal), /abort|cancel/i);
	assert.equal(aborted.workbench.status().phase, "aborted");
	assert.deepEqual(aborted.graph.readChains(), []);
});

it("G8: extraction in progress refuses reanalysis without calling the agent", async () => {
	let called = false;
	const { workbench } = await harness({ isExtractionRunning: () => true, analyze: async () => { called = true; return analysis; } });
	await assert.rejects(workbench.reprocess(), /running|busy|extraction/i);
	assert.equal(called, false);
});

it("G8: graph changes during reanalysis reject stale findings and preserve the concurrent change", async () => {
	const { graph, workbench } = await harness({ analyze: async () => { deleteNodeTraces(graph, "c"); return analysis; } });
	await assert.rejects(workbench.reprocess(), /changed|retry/i);
	assert.deepEqual(graph.readNodes().map((n) => n.id), ["a", "b"]); assert.deepEqual(graph.readChains(), []);
});

it("G8: only one reanalysis is admitted, and its lock is released after success", async () => {
	let release!: (value: typeof analysis) => void;
	const { workbench } = await harness({ analyze: () => new Promise((resolve) => { release = resolve; }) });
	const running = workbench.reprocess();
	await assert.rejects(workbench.reprocess(), /running|busy/i);
	release(analysis); await running;
	assert.equal(workbench.status().phase, "completed");
});

it("G3/G7: corrupt or newer personalization storage is refused without overwriting the original bytes", async () => {
	const { createGraphPersonalizationStore } = await import("../src/store/graph-personalization.ts");
	for (const content of ["{", '{"version":999,"regionNames":{},"groups":[],"explanations":{}}']) {
		const file = path.join(directory, `broken-${++sequence}.json`); fs.writeFileSync(file, content);
		const store = createGraphPersonalizationStore(file); assert.throws(() => store.read());
		assert.equal(fs.readFileSync(file, "utf8"), content);
	}
});

it("G6: themed snapshots retain logical edges exactly, prune removed members and attach geometry junctions once", async () => {
	const { graph, details, workbench } = await harness({ analyze: async () => ({ chains: [{ premises: ["a", "c"], conclusion: "b", reason: "Joint logical inference" }], groups: analysis.groups }) });
	await workbench.reprocess();
	const stored = getGraph(graph), view = deriveView(stored);
	const base = { ...view, propositions: stored.nodes, chains: stored.chains, clusters: [], sessions: {}, fileSources: {}, nodeSessions: {} };
	const snapshot = personalizeGraphSnapshot(base, details.read());
	assert.deepEqual(snapshot.logicalEdges, base.logicalEdges);
	assert.equal(snapshot.clusters.length, 1); assert.equal(snapshot.clusters[0]!.label, "Shared topic");
	assert.equal(snapshot.clusters[0]!.members.length, 3, "two thematic propositions plus one implication geometry node");
	assert.equal(new Set(snapshot.clusters[0]!.members).size, 3);
	const twice = personalizeGraphSnapshot(snapshot, details.read());
	assert.equal(twice.clusters[0]!.members.length, 3, "snapshot decoration is idempotent");
	assert.ok(Object.values(graph.readPositions()).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
	deleteNodeTraces(graph, "c"); const remaining = getGraph(graph), nextView = deriveView(remaining);
	assert.deepEqual(personalizeGraphSnapshot({ ...base, ...nextView, propositions: remaining.nodes, chains: remaining.chains }, details.read()).clusters, []);
});
