import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import type { GraphPersonalization, GraphPersonalizationStore } from "../core/graph-personalization.ts";

const blank = (): GraphPersonalization => ({ version: 1, regionNames: {}, groups: [], explanations: {} });
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function validate(value: unknown): asserts value is GraphPersonalization {
	if (!record(value) || value.version !== 1 || !record(value.regionNames) || !record(value.explanations) || !Array.isArray(value.groups)) throw new Error("Unsupported or corrupt graph personalization storage.");
	if (!Object.entries(value.regionNames).every(([id, name]) => id.length > 0 && typeof name === "string" && name.trim().length > 0 && name.length <= 200)) throw new Error("Invalid region names in graph storage.");
	const ids = new Set<string>();
	for (const group of value.groups) {
		if (!record(group) || typeof group.id !== "string" || !group.id || ids.has(group.id) || typeof group.name !== "string" || !group.name.trim() || group.name.length > 200 || !Array.isArray(group.nodeIds) || !group.nodeIds.every((id) => typeof id === "string" && id.length > 0)) throw new Error("Invalid thematic group in graph storage.");
		ids.add(group.id);
	}
	for (const explanation of Object.values(value.explanations)) if (!record(explanation) || typeof explanation.text !== "string" || !explanation.text.trim() || typeof explanation.generatedAt !== "string") throw new Error("Invalid saved knowledge explanation.");
}

export function createGraphPersonalizationStore(file = path.join(PATHS.graph, "personalization.json")): GraphPersonalizationStore {
	return { file,
		read() {
			let raw: string;
			try { raw = fs.readFileSync(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return blank(); throw error; }
			const value: unknown = JSON.parse(raw); validate(value); return value;
		},
		write(value) {
			validate(value);
			// Never replace corrupt/newer data merely because a caller has a draft.
			this.read();
			fs.mkdirSync(path.dirname(file), { recursive: true });
			const temporary = `${file}.${randomUUID()}.tmp`;
			try { fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.renameSync(temporary, file); }
			finally { fs.rmSync(temporary, { force: true }); }
		},
	};
}
export const graphPersonalizationStore = createGraphPersonalizationStore();
