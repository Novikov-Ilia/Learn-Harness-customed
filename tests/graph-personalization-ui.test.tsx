import assert from "node:assert/strict";
import { it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const node = { id: "a", name: "A full idea", statement: "The complete proposition, without truncation.", aliases: ["An alternative formulation"], createdAt: "2026-11-04T10:00:00Z", provenance: [{ chatId: "source", messageId: "message" }] };

it("G1/G4: expanded knowledge card exposes complete saved data, reasoning, explanation and discoverable deletion", async () => {
	const { GraphKnowledgeCard } = await import("../components/graph-knowledge-card.tsx");
	const html = renderToStaticMarkup(<GraphKnowledgeCard node={node}
		nodes={[node, { ...node, id: "b", name: "Conclusion" }]}
		chains={[{ id: "arg_ab", premises: ["a"], conclusion: "b", provenance: [], createdAt: "2026-11-04" }]}
		sessions={{ source: "Original source name" }} fileSources={{}} explanation={{ text: "Saved AI explanation", generatedAt: "2026-11-04T11:00:00Z" }}
		onClose={() => {}} onDelete={() => {}} onExplain={() => {}} explaining={false} error={null} />);
	for (const text of [node.statement, node.aliases[0]!, "Original source name", "Conclusion", "Saved AI explanation"]) assert.ok(html.includes(text), text);
	assert.match(html, /#message-message/);
	assert.match(html, /aria-label="Delete knowledge"/); assert.match(html, /Explain with AI/);
});

it("G3/G5/G7: graph workbench exposes independent region editing, reanalysis, cancellation and honest provider failures", async () => {
	const { GraphWorkbenchControls } = await import("../components/graph-workbench-controls.tsx");
	const html = renderToStaticMarkup(<GraphWorkbenchControls regions={[{ id: "topic", label: "My topic", members: ["a", "b"] }]}
		onRename={async () => {}} onReprocess={() => {}} onAbort={() => {}} phase="analyzing" error="Synthetic model unavailable" />);
	assert.match(html, /Rename regions/); assert.match(html, /Reprocess graph/); assert.match(html, /Cancel/);
	assert.match(html, /Synthetic model unavailable/); assert.match(html, /role="alert"/);
});

it("G3: an independently named region can acquire a label even when its original source was deleted", async () => {
	const { applyClusterLabels } = await import("../components/graph-canvas.ts");
	const regions = [{ id: "orphan-region", label: null as string | null }];
	const meta = [{ id: "orphan-region", label: null as string | null, lines: null as string[] | null }];
	assert.equal(applyClusterLabels(regions, meta, new Map([["orphan-region", "Independent name"]]), 200, 3, (s) => s.length * 5, true), true);
	assert.equal(regions[0]!.label, "Independent name"); assert.deepEqual(meta[0]!.lines, ["Independent name"]);
});
