import { PATHS } from "../../config.ts";
import { graphPersonalizationStore } from "../store/graph-personalization.ts";
import { resolveRoleSpec } from "../core/settings-resolution.ts";
import { ModelsNotConfiguredError, ROLE_SLOT } from "../core/settings.ts";
import { piEngineForSpec } from "../agent/models.ts";
import { analyzeKnowledgeGraph, explainKnowledge } from "../agent/subagents/graph-workbench.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { emit } from "../core/events.ts";
import { stores } from "./stores.ts";
import { createGraphWorkbench } from "./graph-workbench.ts";

function engineFor(role: "teacher" | "auditor") {
	const spec = resolveRoleSpec(role, stores.settingsStore.readSettings());
	if (!spec) throw new ModelsNotConfiguredError([ROLE_SLOT[role]]);
	return piEngineForSpec(spec, true, undefined, () => stores.settingsStore.readSettings()?.models?.[ROLE_SLOT[role]]?.cacheRetention);
}

function createRuntime() {
	let controller: AbortController | null = null;
	const workbench = createGraphWorkbench({ graphStore: stores.graphStore, detailsStore: graphPersonalizationStore,
		analyze: (graph, signal) => analyzeKnowledgeGraph(graph, engineFor("auditor"), signal),
		explain: (knowledge, signal) => explainKnowledge(knowledge, engineFor("teacher"), signal),
		isExtractionRunning: () => extractionStatuses().length > 0,
		onChanged: () => emit("activity-changed", {}),
	});
	return { workbench,
		start() {
			if (controller) throw new Error("Graph reprocessing is already running.");
			// Fail admission before returning 202 when configuration is absent.
			engineFor("auditor");
			if (extractionStatuses().length) throw new Error("An extraction is running; wait for it to finish.");
			controller = new AbortController();
			void workbench.reprocess(controller.signal).catch((error: unknown) => { console.error("[graph reprocessing]", error); }).finally(() => { controller = null; emit("activity-changed", {}); });
			emit("activity-changed", {});
		},
		abort() { if (!controller) return false; controller.abort(); return true; },
	};
}

const globals = globalThis as typeof globalThis & { __lhGraphWorkbenchRuntime?: { profile: string; runtime: ReturnType<typeof createRuntime> } };
function runtime() {
	if (!globals.__lhGraphWorkbenchRuntime || globals.__lhGraphWorkbenchRuntime.profile !== PATHS.data) globals.__lhGraphWorkbenchRuntime = { profile: PATHS.data, runtime: createRuntime() };
	return globals.__lhGraphWorkbenchRuntime.runtime;
}
export const graphWorkbenchStatus = () => runtime().workbench.status();
export const startGraphReprocessing = () => runtime().start();
export const abortGraphReprocessing = () => runtime().abort();
export const renameGraphRegion = (id: string, name: string) => runtime().workbench.renameRegion(id, name);
export const explainGraphNode = (id: string, signal?: AbortSignal) => runtime().workbench.explainNode(id, signal);

/** Bounds mutation bodies before parsing; file contents never go through here. */
export async function readGraphMutation(request: Request): Promise<Record<string, unknown>> {
	if (Number(request.headers.get("content-length")) > 16_384) throw new Error("Graph action is too large.");
	const reader = request.body?.getReader(); if (!reader) throw new Error("Missing graph action.");
	const chunks: Uint8Array[] = []; let total = 0;
	try { for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > 16_384) throw new Error("Graph action is too large."); chunks.push(value); } }
	finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
	const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
	const text = new TextDecoder().decode(bytes);
	const value: unknown = JSON.parse(text);
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid graph action.");
	return value as Record<string, unknown>;
}
export function graphActionFailure(error: unknown): Response {
	const message = error instanceof Error ? error.message : String(error);
	return Response.json({ error: message }, { status: error instanceof ModelsNotConfiguredError ? 503 : /running|changed|busy/i.test(message) ? 409 : /exist/i.test(message) ? 404 : 400 });
}
