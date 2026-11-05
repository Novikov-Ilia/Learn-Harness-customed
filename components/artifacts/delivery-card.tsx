"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, FileText } from "lucide-react";
import { downloadContent, prepareDownload, type ArtifactPartProps, type CopyTextInput, type DownloadInput } from "@/src/core";
import { copyText } from "@/components/copy-text";

const buttonClass = "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring";

function ToolStatus({ part }: ArtifactPartProps) {
	const error = (part as ArtifactPartProps["part"] & { errorText?: string }).errorText;
	return <p className={`my-2 text-sm ${part.state === "output-error" ? "text-red-500" : "text-muted-foreground"}`} role="status">
		{part.state === "output-error" ? error ?? "Не удалось подготовить результат." : "Подготовка…"}
	</p>;
}

export function DownloadCard({ part }: ArtifactPartProps) {
	const [error, setError] = useState("");
	if (part.state !== "output-available") return <ToolStatus part={part} />;
	const input = part.input as DownloadInput;
	let file;
	try { file = prepareDownload(input); } catch {
		return <p role="alert" className="text-sm text-red-500">Не удалось прочитать данные файла.</p>;
	}
	const size = file.size < 1024 ? `${file.size} Б` : file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} КБ` : `${(file.size / 1024 / 1024).toFixed(1)} МБ`;
	return <section data-testid="download-card" className="my-3 w-full max-w-2xl rounded-xl border bg-card p-4">
		<div className="flex items-center gap-3">
			<FileText className="size-5 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<p className="break-all text-sm font-medium">{file.name}</p>
				<p className="mt-0.5 text-xs text-muted-foreground">{size}</p>
			</div>
			<button type="button" className={buttonClass} aria-label={`Скачать ${file.name}`} onClick={() => {
				try {
					const blob = new Blob([downloadContent(input)], { type: file.mimeType + (file.encoding === "utf8" ? ";charset=utf-8" : "") });
					const url = URL.createObjectURL(blob);
					const anchor = document.createElement("a");
					anchor.href = url; anchor.download = file.name;
					document.body.appendChild(anchor); anchor.click(); anchor.remove();
					window.setTimeout(() => URL.revokeObjectURL(url), 1000);
					setError("");
				} catch { setError("Не удалось скачать файл. Повторите попытку."); }
			}}><Download className="size-3.5" />Скачать</button>
		</div>
		{error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
	</section>;
}

export function CopyTextCard({ part }: ArtifactPartProps) {
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState("");
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	if (part.state !== "output-available") return <ToolStatus part={part} />;
	const input = part.input as CopyTextInput | undefined;
	if (!input || typeof input.text !== "string") return <p role="alert" className="text-sm text-red-500">Не удалось прочитать текст.</p>;
	return <section data-testid="copy-text-card" className="my-3 w-full max-w-2xl overflow-hidden rounded-xl border bg-card">
		<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
			<div className="min-w-0">
				<p className="break-words text-sm font-medium">{typeof input.title === "string" && input.title ? input.title : "Текст для копирования"}</p>
				{typeof input.language === "string" && input.language && <p className="text-xs text-muted-foreground">{input.language}</p>}
			</div>
			<button type="button" className={buttonClass} onClick={async () => {
				const ok = await copyText(input.text);
				if (!ok) { setCopied(false); setError("Не удалось скопировать. Можно выделить и скопировать текст вручную."); return; }
				setError(""); setCopied(true); window.clearTimeout(timer.current);
				timer.current = window.setTimeout(() => setCopied(false), 1500);
			}}>{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Скопировано" : "Скопировать"}</button>
		</div>
		<pre className="max-h-80 select-text overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm leading-relaxed">{input.text}</pre>
		{error && <p role="alert" className="px-4 pb-3 text-xs text-red-500">{error}</p>}
	</section>;
}
