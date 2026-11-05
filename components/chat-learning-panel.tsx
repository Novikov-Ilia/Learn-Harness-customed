"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatKind, LearningNote, PlanTree } from "@/src/core";
import { useNotifyHub } from "@/components/server-events";
import { stashOpeningPrompt } from "@/components/opening-prompt";

export function LearningNoteView({ note, error }: { note?: LearningNote | null; error?: string }) {
	return <div className="space-y-2 text-sm">
		{error && <p role="alert" className="text-destructive">{error}</p>}
		<p className="font-medium">Confirmed learning</p>
		{note?.mastered.length ? <ul className="list-disc space-y-1 pl-5">{note.mastered.map((fact) => <li key={fact.topic}>{fact.topic}</li>)}</ul> : <p className="text-muted-foreground">No learning has been confirmed yet. Discussing a topic alone does not confirm mastery.</p>}
		<p className="font-medium">Mistakes and corrections</p>
		{note?.errors.length ? <ul className="list-disc space-y-1 pl-5">{note.errors.map((item) => <li key={`${item.topic}-${item.description}`}><span>{item.topic}: {item.description}</span> <span className="text-xs text-muted-foreground">({item.status === "corrected" ? "corrected" : "unresolved / open"})</span></li>)}</ul> : <p className="text-muted-foreground">No verified mistakes recorded.</p>}
	</div>;
}

interface LearningState { kind: ChatKind; title: string; parentId?: string; note?: LearningNote | null; error?: string; tree?: PlanTree | null }
export function ChatLearningPanel({ chatId, kind = "teach", onBranchCreated }: { chatId: string; kind?: ChatKind; onBranchCreated?: (id: string) => void }) {
	const [data, setData] = useState<LearningState>({ kind, title: "" });
	const [busy, setBusy] = useState(false); const [error, setError] = useState<string>(); const [branchTitle, setBranchTitle] = useState("");
	const inFlight = useRef(false); const retry = useRef<{ action: string; requestId: string } | undefined>(undefined);
	const generation = useRef(0);
	const hub = useNotifyHub();
	const refresh = useCallback(async () => {
		const requestGeneration = ++generation.current;
		try { const response = await fetch(`/api/chats/${chatId}/learning`, { cache: "no-store" }); if (!response.ok) throw new Error("Learning note could not be loaded"); const next = await response.json(); if (requestGeneration === generation.current) { setData(next); setError(undefined); } }
		catch (failure) { if (requestGeneration === generation.current) setError(failure instanceof Error ? failure.message : "Learning note could not be loaded"); }
	}, [chatId]);
	useEffect(() => { setData({ kind, title: "" }); setError(undefined); retry.current = undefined; void refresh(); return () => { generation.current++; }; }, [refresh, kind]);
	useEffect(() => {
		if (!hub) return;
		const onChange = (event: { chatId: string }) => { if (event.chatId === chatId) void refresh(); };
		const off = [hub.subscribe("record-changed", onChange), hub.subscribe("turn-settled", onChange), hub.onResync(() => void refresh())];
		return () => { for (const unsubscribe of off) unsubscribe(); };
	}, [hub, chatId, refresh]);
	const branch = async (blockId?: string) => {
		if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(undefined);
		const action = blockId ?? branchTitle.trim();
		if (retry.current?.action !== action) retry.current = { action, requestId: crypto.randomUUID() };
		try {
			const response = await fetch(`/api/chats/${chatId}/branches`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: branchTitle.trim() || undefined, requestId: retry.current.requestId, blockId }) });
			const result = await response.json(); if (!response.ok || typeof result.id !== "string") throw new Error(result.error || "The branch could not be created");
			if (blockId) { const block = data.tree?.nodes.find((node) => node.id === blockId); if (!stashOpeningPrompt(result.id, `Начни освоение выбранного блока «${block?.title ?? blockId}». Используй материалы, цель и результаты диагностики из унаследованного контекста. Область блока: ${block?.summary ?? block?.title ?? blockId}.`)) throw new Error("The child chat was saved, but its opening message could not be handed over. Try starting the block again."); }
			if (onBranchCreated) onBranchCreated(result.id); else window.location.assign(`/chat/${encodeURIComponent(result.id)}`);
		} catch (failure) { setError(failure instanceof Error ? failure.message : "The branch could not be created"); }
		finally { inFlight.current = false; setBusy(false); }
	};
	return <section className="space-y-3 rounded-xl border bg-card p-3" data-testid="chat-learning-panel">
		{data.parentId && <a href={`/chat/${encodeURIComponent(data.parentId)}`} className="text-xs text-muted-foreground underline">Open parent chat</a>}
		{data.error && <p role="alert" className="text-sm text-destructive">{data.error}</p>}
		<details><summary className="cursor-pointer text-sm font-medium">Learning note</summary><div className="pt-3"><LearningNoteView note={data.note} /></div></details>
		{data.kind === "planning" && <div className="space-y-2" data-testid="planning-blocks"><p className="text-sm font-medium">Choose a block to start learning</p>{data.tree?.nodes.length ? data.tree.nodes.map((block) => <div key={block.id} className="rounded-lg border p-2"><p className="text-sm font-medium">{block.title}</p>{block.summary && <p className="mt-1 text-sm text-muted-foreground">{block.summary}</p>}<button type="button" disabled={busy} data-testid={`start-plan-block-${block.id}`} onClick={() => void branch(block.id)} className="mt-2 rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">Start block in a child chat</button></div>) : <p className="text-sm text-muted-foreground">The planner will read your materials, diagnose your starting point and prepare the blocks.</p>}</div>}
		<div className="flex items-center gap-2"><input aria-label="Branch topic" placeholder="Subtopic for a new branch" value={branchTitle} onChange={(event) => setBranchTitle(event.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm" /><button type="button" disabled={busy} onClick={() => void branch()} className="rounded border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50">{busy ? "Creating…" : "Branch chat"}</button></div>
		{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
	</section>;
}
