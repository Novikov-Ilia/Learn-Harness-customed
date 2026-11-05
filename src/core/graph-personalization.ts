import type { Cluster, GraphNode, GraphSnapshot } from "./contracts.ts";

export interface KnowledgeExplanation { text: string; generatedAt: string; }
export interface ThematicGroup { id: string; name: string; nodeIds: string[]; }
export interface GraphPersonalization {
	version: 1;
	regionNames: Record<string, string>;
	groups: ThematicGroup[];
	explanations: Record<string, KnowledgeExplanation>;
}
export interface GraphPersonalizationStore {
	readonly file: string;
	read(): GraphPersonalization;
	write(value: GraphPersonalization): void;
}
export interface GraphReanalysis {
	chains: Array<{ premises: string[]; conclusion: string; reason: string }>;
	groups: Array<{ name: string; nodeIds: string[] }>;
}
export type GraphReprocessPhase = "idle" | "analyzing" | "completed" | "failed" | "aborted";
export interface GraphReprocessStatus { phase: GraphReprocessPhase; error?: string; chainsAdded?: number; groups?: number; }

/** Themes affect only grouping and proximity. They never manufacture an arrow. */
export function personalizedClusters(nodes: readonly GraphNode[], fallback: readonly Cluster[], state: GraphPersonalization): Cluster[] {
	const live = new Set(nodes.map((n) => n.id));
	const assigned = new Set<string>();
	const thematic: Cluster[] = [];
	for (const group of state.groups) {
		const members = group.nodeIds.filter((id) => live.has(id) && !assigned.has(id));
		if (members.length < 2) continue;
		for (const id of members) assigned.add(id);
		thematic.push({ id: group.id, label: state.regionNames[group.id] ?? group.name, members });
	}
	const inherited = fallback.flatMap((cluster) => {
		const members = cluster.members.filter((id) => live.has(id) && !assigned.has(id));
		return members.length >= 3 ? [{ ...cluster, members, label: state.regionNames[cluster.id] ?? cluster.label }] : [];
	});
	return [...thematic, ...inherited];
}

export function personalizeGraphSnapshot(snapshot: GraphSnapshot, state: GraphPersonalization): GraphSnapshot {
	const clusters = state.groups.length
		? personalizedClusters(snapshot.propositions, snapshot.clusters, state)
		: snapshot.clusters.map((cluster) => ({ ...cluster, members: [...cluster.members], label: state.regionNames[cluster.id] ?? cluster.label }));
	if (state.groups.length) attachThematicImplications(clusters, snapshot.impLinks);
	return { ...snapshot, clusters, regionNames: { ...state.regionNames }, explanations: state.explanations };
}

export function attachThematicImplications(clusters: Cluster[], implications: readonly { id: string; premises: string[] }[]): void {
	// Geometry junctions follow the majority of their premise groups. This
	// is a layout choice, separate from the chain's logical endpoints.
	const groupOf = new Map(clusters.flatMap((c) => c.members.map((id) => [id, c.id] as const)));
	for (const imp of implications) {
		const votes = new Map<string, number>();
		for (const id of imp.premises) { const group = groupOf.get(id); if (group) votes.set(group, (votes.get(group) ?? 0) + 1); }
		const winner = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
		const group = clusters.find((c) => c.id === winner); if (group && !group.members.includes(imp.id)) group.members.push(imp.id);
	}
}
