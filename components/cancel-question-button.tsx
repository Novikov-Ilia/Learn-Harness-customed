"use client";

export function CancelQuestionButton({ onCancel, disabled = false }: { onCancel: () => void; disabled?: boolean }) {
	return <button type="button" disabled={disabled} onClick={onCancel} className="pointer-events-auto rounded-md border px-3 py-1.5 font-ui text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50">Cancel question</button>;
}
