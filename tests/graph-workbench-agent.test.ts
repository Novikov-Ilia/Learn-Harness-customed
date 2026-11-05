import assert from "node:assert/strict";
import { it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { analyzeKnowledgeGraph, explainKnowledge } from "../src/agent/subagents/graph-workbench.ts";

const graph = { nodes: ["a", "b"].map((id) => ({ id, name: id, statement: `Full ${id} proposition`, aliases: [`Alias ${id}`], provenance: [], createdAt: "2026-11-04" })), chains: [] };
function engine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({}); faux.setResponses(steps); return { model: faux.getModel(), streamFn: faux.streamSimple };
}

it("graph reanalysis runs the real Pi submit loop, gives all stored knowledge to the engine and separates themes from implications", async () => {
	const result = { chains: [{ premises: ["a"], conclusion: "b", reason: "a entails b" }], groups: [{ name: "Theme", nodeIds: ["a", "b"] }] };
	const model = engine([(context) => {
		assert.match(JSON.stringify(context), /Full a proposition/); assert.match(JSON.stringify(context), /Full b proposition/);
		return fauxAssistantMessage([fauxToolCall("submit_graph_reanalysis", result)], { stopReason: "toolUse" });
	}]);
	assert.deepEqual(await analyzeKnowledgeGraph(graph, model), result);
});

it("graph agent retries schema-valid but semantically dangling IDs instead of committing them", async () => {
	const model = engine([
		fauxAssistantMessage([fauxToolCall("submit_graph_reanalysis", { chains: [{ premises: ["missing"], conclusion: "b", reason: "bad" }], groups: [] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("submit_graph_reanalysis", { chains: [], groups: [] })], { stopReason: "toolUse" }),
	]);
	assert.deepEqual(await analyzeKnowledgeGraph(graph, model), { chains: [], groups: [] });
});

it("knowledge explanations use the real subagent with saved formulations and return its actual text", async () => {
	const model = engine([(context) => {
		assert.match(JSON.stringify(context), /Alias a/);
		return fauxAssistantMessage("An actual generated explanation.");
	}]);
	assert.equal(await explainKnowledge({ node: graph.nodes[0]!, graph }, model), "An actual generated explanation.");
});

it("a model that never submits valid graph findings fails explicitly", async () => {
	const model = engine([fauxAssistantMessage("No tool submission.")]);
	await assert.rejects(analyzeKnowledgeGraph(graph, model), /did not submit/);
});

it("a truncated knowledge explanation is reported as incomplete, never saved as a finished answer", async () => {
	const model = engine([fauxAssistantMessage("An unfinished derivation...", { stopReason: "length" })]);
	await assert.rejects(explainKnowledge({ node: graph.nodes[0]!, graph }, model), /cut off|limit|incomplete/);
});
