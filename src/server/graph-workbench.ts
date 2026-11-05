import { createHash, randomUUID } from "node:crypto";
import { deriveView, getGraph, type DerivedGraph } from "../core/graph.ts";
import { incrementalLayout } from "../core/layout.ts";
import { attachThematicImplications, personalizedClusters } from "../core/graph-personalization.ts";
import { birthSessionPartition } from "../core/session-clusters.ts";
import { claimGraphMaintenance } from "../core/graph-maintenance.ts";
import type { GraphNode } from "../core/contracts.ts";
import type { GraphStore } from "../core/ports.ts";
import type { GraphPersonalizationStore, GraphReanalysis, GraphReprocessStatus, KnowledgeExplanation } from "../core/graph-personalization.ts";

function aborted(signal?: AbortSignal) { if (signal?.aborted) throw new Error("Graph operation cancelled (aborted)."); }
const fingerprint = (graph: DerivedGraph) => createHash("sha256").update(JSON.stringify(graph)).digest("hex");
const keyOf = (premises: string[], conclusion: string) => JSON.stringify([[...new Set(premises)].sort(), conclusion]);
export function validateGraphReanalysis(value: unknown, graph: DerivedGraph): GraphReanalysis {
	if (typeof value !== "object" || value === null) throw new Error("Graph agent returned an invalid analysis.");
	const candidate = value as GraphReanalysis;
	if (!Array.isArray(candidate.chains) || !Array.isArray(candidate.groups)) throw new Error("Graph analysis requires chains and thematic groups.");
	const nodes = new Set(graph.nodes.map((n) => n.id)), assigned = new Set<string>();
	for (const chain of candidate.chains) {
		if (!chain || !Array.isArray(chain.premises) || !chain.premises.length || !chain.premises.every((id) => typeof id === "string" && nodes.has(id)) || typeof chain.conclusion !== "string" || !nodes.has(chain.conclusion) || chain.premises.includes(chain.conclusion) || typeof chain.reason !== "string" || !chain.reason.trim()) throw new Error("Invalid logical connection: endpoints must exist, premises be nonempty, and inference must have a reason without self-inference.");
	}
	for (const group of candidate.groups) {
		if (!group || typeof group.name !== "string" || !group.name.trim() || group.name.length > 200 || !Array.isArray(group.nodeIds) || group.nodeIds.length < 2) throw new Error("Invalid thematic group: a name and at least two nodes are required.");
		for (const id of group.nodeIds) { if (!nodes.has(id) || assigned.has(id)) throw new Error("Invalid thematic group: unknown node or duplicate group membership."); assigned.add(id); }
	}
	return candidate;
}

export function createGraphWorkbench(deps: {
	graphStore: GraphStore; detailsStore: GraphPersonalizationStore;
	analyze: (graph: DerivedGraph, signal?: AbortSignal) => Promise<unknown>;
	explain: (knowledge: { node: GraphNode; graph: DerivedGraph }, signal?: AbortSignal) => Promise<string>;
	isExtractionRunning: () => boolean; onChanged?: () => void;
}) {
	let status: GraphReprocessStatus = { phase: "idle" };
	const explaining = new Set<string>();
	return {
		status: () => ({ ...status }),
		renameRegion(id: string, name: string) {
			if (typeof name !== "string" || !name.trim() || name.trim().length > 200) throw new Error("Region name must contain 1–200 characters.");
			const state = deps.detailsStore.read();
			if (!state.groups.some((g) => g.id === id) && !getGraph(deps.graphStore).nodes.some((n) => n.provenance.some((p) => p.chatId === id))) throw new Error("The region no longer exists.");
			state.regionNames = { ...state.regionNames, [id]: name.trim() }; deps.detailsStore.write(state); deps.onChanged?.();
		},
		async reprocess(signal?: AbortSignal) {
			if (deps.isExtractionRunning()) throw new Error("An extraction is running; retry reprocessing when it finishes.");
			const release = claimGraphMaintenance();
			status = { phase: "analyzing" };
			try {
				aborted(signal);
				const graph = getGraph(deps.graphStore), before = fingerprint(graph);
				if (graph.nodes.length === 0) throw new Error("The graph is empty; add knowledge before reprocessing.");
				const findings = validateGraphReanalysis(await deps.analyze(graph, signal), graph); aborted(signal);
				if (deps.isExtractionRunning() || fingerprint(getGraph(deps.graphStore)) !== before) throw new Error("The graph changed during reprocessing; retry using the updated graph.");
				const state = deps.detailsStore.read();
				const groups = findings.groups.map((group) => ({ id: `topic_${createHash("sha256").update(JSON.stringify([...group.nodeIds].sort())).digest("hex").slice(0, 16)}`, name: group.name.trim(), nodeIds: [...group.nodeIds].sort() }));
				const keys = new Set(graph.chains.map((c) => keyOf(c.premises, c.conclusion)));
				const chains = findings.chains.flatMap((chain) => {
					const key = keyOf(chain.premises, chain.conclusion); if (keys.has(key)) return []; keys.add(key);
					return [{ id: `arg_${randomUUID()}`, premises: [...new Set(chain.premises)].sort(), conclusion: chain.conclusion, createdAt: new Date().toISOString(), provenance: [], origin: "reanalysis" as const, reason: chain.reason.trim() }];
				});
				// Validate and save presentation first. Chain appends happen only
				// after successful storage, and never replace unrelated assertions.
				deps.detailsStore.write({ ...state, groups });
				for (const chain of chains) deps.graphStore.appendChain(chain);
				const current = getGraph(deps.graphStore), view = deriveView(current);
				const clusters = personalizedClusters(current.nodes, birthSessionPartition(current.nodes).map((c) => ({ ...c, label: null })), { ...state, groups });
				attachThematicImplications(clusters, view.impLinks);
				// Reprocessing deliberately rearranges related knowledge; ordinary
				// reads/renames keep the user's resting layout and camera intact.
				const positions = incrementalLayout(view.nodes, view.edges, new Map(Object.entries(deps.graphStore.readPositions())), { clusters, anchorRetention: 0, clusterPullStrength: 0.3, logicalEdges: view.logicalEdges, impLinks: view.impLinks });
				deps.graphStore.writePositions(Object.fromEntries(positions));
				status = { phase: "completed", chainsAdded: chains.length, groups: groups.length }; deps.onChanged?.();
				return { chainsAdded: chains.length, groups: groups.length };
			} catch (error) {
				status = { phase: signal?.aborted ? "aborted" : "failed", error: error instanceof Error ? error.message : String(error) }; throw error;
			} finally { release(); }
		},
		async explainNode(id: string, signal?: AbortSignal): Promise<KnowledgeExplanation> {
			if (explaining.has(id)) throw new Error("An explanation for this node is already running.");
			const graph = getGraph(deps.graphStore), node = graph.nodes.find((n) => n.id === id);
			if (!node) throw new Error("The knowledge node no longer exists.");
			explaining.add(id);
			try {
				aborted(signal); const text = await deps.explain({ node, graph }, signal); aborted(signal);
				if (typeof text !== "string" || !text.trim()) throw new Error("The agent returned an empty explanation.");
				const current = getGraph(deps.graphStore).nodes.find((n) => n.id === id);
				if (!current || JSON.stringify(current) !== JSON.stringify(node)) throw new Error("The knowledge changed during generation; retry the explanation.");
				const result = { text: text.trim(), generatedAt: new Date().toISOString() };
				const state = deps.detailsStore.read(); state.explanations = { ...state.explanations, [id]: result }; deps.detailsStore.write(state); deps.onChanged?.(); return result;
			} finally { explaining.delete(id); }
		},
	};
}
