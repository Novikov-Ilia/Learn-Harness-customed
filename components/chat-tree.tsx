"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { fuzzyScore, type ChatListItem, type ChatKind } from "@/src/core";

const COLLAPSED_KEY = "lh:collapsed-chat-branches";
export function ChatTree({ chats, activeId, query = "", kindFilter = "all", onOpen, renderRow, onVisibleRowsChange }: {
	chats: ChatListItem[]; activeId?: string; query?: string; kindFilter?: ChatKind | "all";
	onOpen: (id: string) => void; renderRow?: (chat: ChatListItem, index: number) => ReactNode;
	onVisibleRowsChange?: (chats: ChatListItem[]) => void;
}) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	useEffect(() => { try { const saved: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"); if (Array.isArray(saved)) setCollapsed(new Set(saved.filter((id): id is string => typeof id === "string"))); } catch {} }, []);
	const byId = useMemo(() => new Map(chats.map((c) => [c.id, c])), [chats]);
	const children = useMemo(() => {
		const map = new Map<string | undefined, ChatListItem[]>();
		for (const chat of chats) { const parent = chat.parentId && byId.has(chat.parentId) ? chat.parentId : undefined; const list = map.get(parent) ?? []; list.push(chat); map.set(parent, list); }
		return map;
	}, [chats, byId]);
	const rows = useMemo(() => {
		const keep = new Set<string>(); const filtering = !!query.trim() || kindFilter !== "all";
		for (const chat of chats) if ((!query.trim() || fuzzyScore(query.trim(), chat.title) !== null) && (kindFilter === "all" || chat.kind === kindFilter)) {
			for (let c: ChatListItem | undefined = chat; c && !keep.has(c.id); c = c.parentId ? byId.get(c.parentId) : undefined) keep.add(c.id);
		}
		const out: Array<{ chat: ChatListItem; depth: number; hasChildren: boolean }> = []; const visited = new Set<string>();
		const walk = (parent: string | undefined, depth: number) => { for (const chat of children.get(parent) ?? []) {
			if (visited.has(chat.id) || (filtering && !keep.has(chat.id))) continue; visited.add(chat.id);
			out.push({ chat, depth, hasChildren: (children.get(chat.id)?.length ?? 0) > 0 });
			if (filtering || !collapsed.has(chat.id)) walk(chat.id, depth + 1);
		} };
		walk(undefined, 1); return out;
	}, [chats, children, byId, collapsed, query, kindFilter]);
	useEffect(() => { onVisibleRowsChange?.(rows.map((r) => r.chat)); }, [rows, onVisibleRowsChange]);
	const toggle = (id: string, expand?: boolean) => setCollapsed((previous) => {
		const next = new Set(previous); if (expand ?? next.has(id)) next.delete(id); else next.add(id);
		try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch {} return next;
	});
	return <div role="tree" aria-label="Chat branches">{rows.map(({ chat, depth, hasChildren }, index) => <div
		key={chat.id} role="treeitem" data-chat-id={chat.id} aria-level={depth} aria-selected={chat.id === activeId}
		aria-expanded={hasChildren ? !!query.trim() || kindFilter !== "all" || !collapsed.has(chat.id) : undefined}
		tabIndex={chat.id === activeId || (!activeId && index === 0) ? 0 : -1}
		onKeyDown={(event) => {
			if (event.key === "ArrowRight" && hasChildren) { event.preventDefault(); event.stopPropagation(); toggle(chat.id, true); }
			else if (event.key === "ArrowLeft" && hasChildren) { event.preventDefault(); event.stopPropagation(); toggle(chat.id, false); }
			else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); const all = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLElement>('[role="treeitem"]')); all[(index + (event.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus(); }
			else if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); onOpen(chat.id); }
		}}
		className="flex items-center" style={{ paddingLeft: (depth - 1) * 14 }}>
		{hasChildren ? <button type="button" aria-label={`${collapsed.has(chat.id) ? "Expand" : "Collapse"} ${chat.title}`} data-testid={`chat-tree-toggle-${chat.id}`} onClick={() => toggle(chat.id)} className="shrink-0 rounded p-0.5 hover:bg-accent">{collapsed.has(chat.id) && !query.trim() ? <ChevronRightIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}</button> : <span className="w-4 shrink-0" />}
		<div className="min-w-0 flex-1">{renderRow ? renderRow(chat, index) : <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-accent" onClick={() => onOpen(chat.id)}>{chat.title}</button>}</div>
	</div>)}</div>;
}
