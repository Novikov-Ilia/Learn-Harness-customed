"use client";

import { useEffect, useRef, useState } from "react";
import { FileSymlinkIcon, XIcon } from "lucide-react";
import { UPLOAD_FILES_EVENT } from "@/components/path-input";
import { filesFromTransfer } from "@/components/attachment-client";

const BROWSER_NOTICE = "Drop PDF, images or text files to attach them";

/** The content area only: the sidebar is deliberately outside this zone.
 * Dropped files use the same managed upload pipeline as picker and clipboard input. */
export function FilePathDropZone({ children, className }: { children: React.ReactNode; className?: string }) {
	const root = useRef<HTMLElement>(null);
	const depth = useRef(0);
	const [dragging, setDragging] = useState(false);
	const [notice, setNotice] = useState("");
	const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
	const clearDrag = () => { depth.current = 0; setDragging(false); };
	useEffect(() => {
		// The sidebar remains a non-target, but dropping a file there must not
		// navigate the app away. No indicator or attachment is produced there.
		const preventOutsideNavigation = (event: DragEvent) => {
			if (Array.from(event.dataTransfer?.types ?? []).includes("Files")
				&& event.target instanceof Node && !root.current?.contains(event.target)) event.preventDefault();
		};
		window.addEventListener("dragover", preventOutsideNavigation);
		window.addEventListener("drop", preventOutsideNavigation);
		return () => {
			window.removeEventListener("dragover", preventOutsideNavigation);
			window.removeEventListener("drop", preventOutsideNavigation);
		};
	}, []);
	return (
		<main
			ref={root}
			className={className}
			data-testid="file-path-drop-zone"
			onDragEnter={(event) => {
				if (!hasFiles(event)) return;
				event.preventDefault();
				depth.current++;
				setDragging(true);
				setNotice("");
			}}
			onDragOver={(event) => {
				if (!hasFiles(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
			}}
			onDragLeave={(event) => {
				if (!hasFiles(event)) return;
				depth.current = Math.max(0, depth.current - 1);
				if (depth.current === 0) setDragging(false);
			}}
			onDragEnd={clearDrag}
			onDrop={(event) => {
				if (!hasFiles(event)) return;
				clearDrag();
				// A drop directly onto PathInput is already handled by its native listener.
				if (event.defaultPrevented) return;
				event.preventDefault();
				event.stopPropagation();
				const entries = Array.from(event.dataTransfer.items ?? []).filter(item => item.kind === "file");
				const files = filesFromTransfer(event.dataTransfer).filter((_file, i) => !entries[i]?.webkitGetAsEntry?.()?.isDirectory);
				if (!files.length) { setNotice("Drop supported files, not directories."); return; }
				const focused = document.activeElement?.closest<HTMLElement>("[data-file-path-input]");
				const zone = event.currentTarget;
				const target = focused && zone.contains(focused) ? focused
					: zone.querySelector<HTMLElement>("[data-file-path-default]") ?? zone.querySelector<HTMLElement>("[data-file-path-input]");
				if (!target) { setNotice("Open a chat to attach files."); return; }
				target.dispatchEvent(new CustomEvent(UPLOAD_FILES_EVENT, { detail: files }));
				setNotice(files.length < event.dataTransfer.files.length ? "Directories were skipped." : "");
			}}
		>
			{children}
			{dragging && (
				<div data-testid="file-path-drop-indicator" className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 p-6 text-center backdrop-blur-sm">
					<div className="flex max-w-md flex-col items-center gap-3">
						<FileSymlinkIcon className="size-8 text-primary" aria-hidden />
						<span className="font-ui text-sm">{BROWSER_NOTICE}</span>
					</div>
				</div>
			)}
			{notice && <div role="status" className="absolute bottom-2 left-1/2 z-50 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-md border bg-card px-3 py-2 font-ui text-xs shadow-sm">
				<span>{notice}</span>
				<button type="button" aria-label="Dismiss attachment notice" onClick={() => setNotice("")} className="shrink-0 rounded-sm p-1 hover:bg-accent"><XIcon className="size-3" aria-hidden /></button>
			</div>}
		</main>
	);
}
