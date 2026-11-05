"use client";

import { useState } from "react";
import type { Cluster, GraphReprocessPhase } from "@/src/core";

export function GraphWorkbenchControls({ regions, onRename, onReprocess, onAbort, phase, error }: {
	regions: readonly Cluster[]; onRename: (id: string, name: string) => Promise<void>;
	onReprocess: () => void; onAbort: () => void; phase: GraphReprocessPhase; error: string | null;
}) {
	const [renameError, setRenameError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	return <div className="lh-no-drag relative rounded-xl border bg-card/95 p-1.5 text-xs shadow-lg backdrop-blur" data-testid="graph-workbench-controls">
		<div className="flex flex-wrap items-center gap-1">
			<button type="button" onClick={onReprocess} disabled={phase === "analyzing"} className="rounded-lg px-2 py-1.5 hover:bg-accent disabled:opacity-50">Reprocess graph</button>
			{phase === "analyzing" && <button type="button" onClick={onAbort} className="rounded-lg px-2 py-1.5 text-red-400 hover:bg-accent">Cancel</button>}
			{regions.length > 0 && <details className="relative"><summary className="cursor-pointer rounded-lg px-2 py-1.5 hover:bg-accent">Rename regions</summary>
				<div className="absolute right-0 z-30 mt-2 max-h-72 w-80 max-w-[85vw] space-y-2 overflow-y-auto rounded-xl border bg-card p-3 shadow-xl">
					<p className="text-muted-foreground">Region names are independent of chats and files.</p>
					{regions.map((region) => <form key={`${region.id}-${region.label}`} className="flex gap-1" onSubmit={async (event) => {
						event.preventDefault(); const form = event.currentTarget; const name = (form.querySelector('input[name="name"]') as HTMLInputElement | null)?.value ?? ""; setSaving(true); setRenameError(null);
						try { await onRename(region.id, name); } catch (error) { setRenameError(error instanceof Error ? error.message : String(error)); } finally { setSaving(false); }
					}}><input name="name" aria-label={`Name of region ${region.label ?? region.id}`} required maxLength={200} defaultValue={region.label ?? ""} className="min-w-0 flex-1 rounded border bg-background px-2 py-1" /><button type="submit" disabled={saving} className="rounded border px-2 hover:bg-accent">Save</button></form>)}
					{renameError && <p role="alert" className="text-red-400">{renameError}</p>}
				</div>
			</details>}
		</div>
		{phase === "analyzing" && <p role="status" className="px-2 pb-1 text-muted-foreground">Finding logical connections and thematic groups…</p>}
		{phase === "completed" && <p role="status" className="px-2 pb-1 text-muted-foreground">Graph reprocessing completed.</p>}
		{error && <p role="alert" className="max-w-96 px-2 pb-1 text-red-400">{error}</p>}
	</div>;
}
