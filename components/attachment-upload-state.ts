"use client";

import { useSyncExternalStore, type RefObject } from "react";

const pending = new Map<Element, number>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** The submission scope includes reading thoughts and all question fields. */
export function hasPendingAttachmentUploads(element: Element | null | undefined): boolean {
	if (!element) return false;
	const scope = element.closest("[data-attachment-scope]") ?? element;
	for (const [source, count] of pending) if (count > 0 && scope.contains(source)) return true;
	return false;
}

export function beginAttachmentUpload(element: Element): () => void {
	pending.set(element, (pending.get(element) ?? 0) + 1); notify();
	let finished = false;
	return () => {
		if (finished) return; finished = true;
		const count = (pending.get(element) ?? 1) - 1;
		if (count <= 0) pending.delete(element); else pending.set(element, count);
		notify();
	};
}

export function usePendingAttachmentUploads(ref: RefObject<HTMLElement | null>): boolean {
	return useSyncExternalStore(subscribe, () => hasPendingAttachmentUploads(ref.current), () => false);
}
