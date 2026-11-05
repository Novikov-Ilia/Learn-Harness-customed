"use client";

import Link from "next/link";
import { propositionSessionHref, type GraphChain, type GraphNode, type KnowledgeExplanation } from "@/src/core";
import { GraphMathText } from "./graph-math-text.tsx";

export function GraphKnowledgeCard({ node, nodes, chains, sessions, fileSources, explanation, onClose, onDelete, onExplain, explaining, error }: {
	node: GraphNode; nodes: readonly GraphNode[]; chains: readonly GraphChain[];
	sessions: Record<string, string>; fileSources: Record<string, string>;
	explanation?: KnowledgeExplanation; onClose: () => void; onDelete: () => void;
	onExplain: () => void; explaining: boolean; error: string | null;
}) {
	const names = new Map(nodes.map((n) => [n.id, n.name]));
	const sources = [...new Set(node.provenance.map((p) => p.chatId))];
	const related = chains.filter((c) => c.conclusion === node.id || c.premises.includes(node.id));
	return <section aria-label={`Knowledge: ${node.name}`} data-testid="graph-knowledge-card" className="flex max-h-[min(76vh,52rem)] w-[34rem] max-w-full flex-col rounded-xl border bg-card text-sm shadow-xl">
		<div className="flex items-start gap-3 border-b p-4">
			<div role="heading" aria-level={2} className="min-w-0 flex-1 break-words font-semibold"><GraphMathText>{node.name}</GraphMathText></div>
			<button type="button" onClick={onClose} aria-label="Close knowledge" className="rounded px-2 hover:bg-accent">×</button>
		</div>
		<div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4">
			<div><h3 className="mb-1 text-xs font-medium text-muted-foreground">Full statement</h3><GraphMathText>{node.statement}</GraphMathText></div>
			{node.aliases.length > 0 && <div><h3 className="mb-1 text-xs font-medium text-muted-foreground">Other formulations</h3><ul className="list-inside list-disc space-y-1">{node.aliases.map((text, i) => <li key={i} className="break-words"><GraphMathText>{text}</GraphMathText></li>)}</ul></div>}
			<div><h3 className="mb-1 text-xs font-medium text-muted-foreground">Sources</h3>
				{sources.length ? sources.map((id) => fileSources[id] !== undefined
					? <p key={id} className="break-all">{fileSources[id]}</p>
					: <div key={id}><Link href={propositionSessionHref(node, id)} className="break-words underline underline-offset-2">{sessions[id] ?? id}</Link>
						{node.provenance.filter((p) => p.chatId === id && p.messageId).slice(1).map((p) => <Link key={p.messageId} href={propositionSessionHref({ provenance: [p] }, id)} className="ml-2 text-xs underline">Next passage</Link>)}</div>)
					: <p className="text-muted-foreground">No sources recorded.</p>}
			</div>
			<div><h3 className="mb-1 text-xs font-medium text-muted-foreground">Logical connections</h3>
				{related.length ? <ul className="space-y-2">{related.map((chain) => <li key={chain.id} className="rounded-lg border p-2">
					<GraphMathText className="break-words">{`${chain.premises.map((id) => names.get(id) ?? id).join(" + ")} → ${names.get(chain.conclusion) ?? chain.conclusion}`}</GraphMathText>
					{chain.origin === "reanalysis" && <div className="mt-1 text-xs text-muted-foreground"><GraphMathText>{`Inferred during AI reprocessing${chain.reason ? `: ${chain.reason}` : ""}`}</GraphMathText></div>}
				</li>)}</ul> : <p className="text-muted-foreground">No logical connections recorded.</p>}
			</div>
			<p className="text-xs text-muted-foreground">Added: {node.createdAt}</p>
			<div className="border-t pt-3">
				<button type="button" onClick={onExplain} disabled={explaining} className="rounded-lg border px-3 py-1.5 hover:bg-accent disabled:opacity-50">{explaining ? "Preparing explanation…" : explanation ? "Explain with AI again" : "Explain with AI"}</button>
				{error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
				{explanation && <div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">AI explanation · {explanation.generatedAt}</p><GraphMathText>{explanation.text}</GraphMathText></div>}
			</div>
		</div>
		<div className="border-t px-4 py-2"><button type="button" aria-label="Delete knowledge" onClick={onDelete} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-accent">Delete knowledge</button></div>
	</section>;
}
