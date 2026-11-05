import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { GraphKnowledgeCard } from "../components/graph-knowledge-card.tsx";

const base = { id: "math-node", name: "Обобщённая сила", statement: "Для силы F компонента равна Q_k = F·∂r/∂q_k. Это коэффициент работы.", aliases: [] as string[], createdAt: "2026-11-04", provenance: [{ chatId: "source", messageId: "message" }] };
function render(overrides: Partial<React.ComponentProps<typeof GraphKnowledgeCard>> = {}) {
	return parseHTML(renderToStaticMarkup(<GraphKnowledgeCard node={base} nodes={[base]} chains={[]}
		sessions={{ source: "Учебный чат" }} fileSources={{}} onClose={() => {}} onDelete={() => {}} onExplain={() => {}}
		explaining={false} error={null} {...overrides} />)).document;
}
function section(document: Document, title: string) {
	const heading = [...document.querySelectorAll("h3")].find(element => element.textContent === title);
	assert.ok(heading, title); return heading.parentElement!;
}

test("saved unmarked graph formulas render as accessible math while surrounding Russian prose stays readable", () => {
	const document = render();
	const statement = section(document, "Full statement");
	assert.ok(statement.querySelector(".katex math msub"), "Q_k and q_k must be rendered subscripts");
	assert.ok(statement.querySelector(".katex math"), "actual MathML, not only styled TeX source");
	assert.match(statement.textContent!, /Для силы F компонента равна/);
	assert.match(statement.textContent!, /Это коэффициент работы\./);
	assert.equal(statement.querySelector(".katex-error"), null);
});

test("node heading, aliases, chain names and reasons, and AI explanation share mathematical rendering", () => {
	const node = { ...base, name: "Скорость $v_B$", aliases: [String.raw`Компонента \(v_A\)`] };
	const next = { ...base, id: "next", name: "Ускорение $a_B$" };
	const document = render({ node, nodes: [node, next],
		chains: [{ id: "chain", premises: [node.id], conclusion: next.id, provenance: [], createdAt: "2026-11-04", origin: "reanalysis", reason: "При h_i > 0" }],
		explanation: { text: String.raw`Ускорение:
\[
a_B = a_A + \omega \times r
\]`, generatedAt: "2026-11-04" },
	});
	const heading = document.querySelector('h2, [role="heading"][aria-level="2"]')!;
	assert.ok(heading.querySelector(".katex"), "the vertex name also renders math");
	assert.ok(section(document, "Other formulations").querySelector(".katex"));
	assert.equal(section(document, "Logical connections").querySelectorAll(".katex").length, 3);
	assert.ok(document.querySelector(".katex-display"), "AI display equation retains display layout");
	assert.equal(document.querySelector(".katex-error"), null);
	assert.equal(document.querySelector('h2 div, p div'), null, "Markdown blocks are never nested in inline-only containers");
});

test("graph math repairs encoded TeX for display without changing saved source or treating code and source paths as formulas", () => {
	const node = { ...base, statement: String.raw`Дробь $\\frac{a}{b}$; код: \`q_k = 0\`.`.replaceAll("\\`", "`"), aliases: ["`q_i` остаётся кодом"] };
	const original = structuredClone(node);
	const sourcePath = "/home/user/q_i.pdf";
	const document = render({ node, nodes: [node], fileSources: { source: sourcePath } });
	assert.ok(section(document, "Full statement").querySelector("math mfrac"));
	assert.equal(document.querySelector(".katex-error"), null);
	assert.match(section(document, "Full statement").querySelector("code")!.textContent!, /q_k = 0/);
	assert.equal(section(document, "Other formulations").querySelector(".katex"), null);
	assert.equal(section(document, "Sources").querySelector(".katex"), null);
	assert.equal(section(document, "Sources").textContent, "Sources" + sourcePath);
	assert.deepEqual(node, original, "all recovery is presentation-only");
});
