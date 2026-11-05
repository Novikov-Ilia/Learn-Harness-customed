"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { type GeminiCliStatus } from "@/src/core";
import { notifySettingsSaved } from "@/components/settings-signal";
import { Button } from "@/components/ui/button";
const headers = { "x-learnharness-gemini-cli": "1", "Content-Type": "application/json" };
export function GeminiCliConnection() {
	const [status, setStatus] = useState<GeminiCliStatus | null>(null);
	const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
	const mounted = useRef(true); const previousState = useRef<string | undefined>(undefined);
	const request = useRef<AbortController | null>(null);
	const adopt = useCallback((value: GeminiCliStatus) => {
		if (!mounted.current) return;
		setStatus(value);
		if (previousState.current !== value.state && (value.state === "connected" || previousState.current === "connected")) notifySettingsSaved("geminiCli");
		previousState.current = value.state;
	}, []);
	const read = useCallback(async () => {
		request.current?.abort(); const controller = new AbortController(); request.current = controller;
		try {
			const response = await fetch("/api/gemini-cli", { headers, cache: "no-store", signal: controller.signal });
			if (!response.ok) throw new Error("Could not read Gemini CLI connection.");
			const value = await response.json() as GeminiCliStatus;
			if (!["unavailable", "disconnected", "connecting", "connected", "error"].includes(value.state)) throw new Error("Invalid Gemini CLI status.");
			if (!controller.signal.aborted) { adopt(value); setError(null); }
		} catch (failure) { if (!controller.signal.aborted && mounted.current) setError(failure instanceof Error ? failure.message : "Gemini CLI status unavailable."); }
	}, [adopt]);
	useEffect(() => { mounted.current = true; void read(); return () => { mounted.current = false; request.current?.abort(); }; }, [read]);
	useEffect(() => { if (status?.state !== "connecting") return; const timer = setInterval(() => void read(), 1000); return () => clearInterval(timer); }, [status?.state, read]);
	const change = async (action: "connect" | "disconnect" | "cancel") => {
		setBusy(true); setError(null);
		try {
			const response = await fetch("/api/gemini-cli", { method: "POST", headers, body: JSON.stringify({ action }) });
			const value = await response.json();
			if (!response.ok) throw new Error(value.error ?? "Could not change Gemini CLI connection.");
			adopt(value as GeminiCliStatus); notifySettingsSaved("geminiCli");
		} catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "Gemini CLI connection failed."); }
		finally { if (mounted.current) setBusy(false); }
	};
	const connecting = status?.state === "connecting", connected = status?.state === "connected";
	const label = connecting ? "Waiting for Google login in your browser…" : connected ? "Google login saved locally" : status?.state === "unavailable" ? "Antigravity CLI unavailable" : "Not connected";
	return <div className="space-y-2" data-testid="gemini-cli-connection">
		<div className="flex flex-wrap items-center gap-3">
			<span className="font-prose text-(length:--lh-prose-size) text-foreground">Gemini (Antigravity CLI)</span>
			<span role="status" className="text-xs text-muted-foreground">{label}</span>
			{connecting ? <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void change("cancel")}>Cancel login</Button> : connected ? <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void change("disconnect")} data-testid="gemini-cli-disconnect">Disconnect</Button> : <Button type="button" size="xs" variant="outline" disabled={!status?.installed || busy} onClick={() => void change("connect")} data-testid="gemini-cli-connect">Connect Google account</Button>}
			<Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void read()}>Refresh</Button>
		</div>
		{(error || status?.error) && <p role="alert" className="text-xs text-red-400">{error ?? status?.error}</p>}
		<p className="text-xs leading-relaxed text-muted-foreground">Connect opens Google's sign-in page in your browser through Antigravity CLI. Sign in with the Google account associated with your Google AI Pro or Ultra subscription, then select a Gemini (Antigravity CLI) model in Models.</p>
		<p className="text-xs leading-relaxed text-muted-foreground">A saved Google login does not verify a paid plan, model access or remaining quota. Antigravity manages account limits; LearnHarness does not fall back to API-key billing or enable extra AI credit spending. Credentials stay in this application's separate local profile. A previous Gemini CLI login requires signing in again.</p>
	</div>;
}
