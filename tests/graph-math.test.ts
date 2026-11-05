import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatGraphMath } from "../src/core/graph-math.ts";

describe("graph knowledge math presentation", () => {
	it("isolates formulas in Russian prose without swallowing the explanation", () => {
		assert.equal(formatGraphMath("Обобщённая сила равна Q_k = F·∂r/∂q_k. Это коэффициент при dq_k в δA = Σ_k Q_k dq_k."),
			"Обобщённая сила равна $Q_k = F·∂r/∂q_k$. Это коэффициент при $dq_k$ в $δA = Σ_k Q_k dq_k$.");
	});
	it("preserves accents, differential notation and every original formula character", () => {
		for (const formula of ["m r̈ = F", "d/dt(∂T/∂q̇_k) − ∂T/∂q_k = Q_k", "W = V̇τ + (V²/ρ)n", "T = mV²/2", "∂r/∂q_i", "h_i"])
			assert.equal(formatGraphMath(formula), `$${formula}$`);
	});
	it("keeps vector expressions and balanced nested parentheses together", () => {
		const source = "a_B = a_A + α × r + ω × (ω × r), где ω — угловая скорость.";
		assert.equal(formatGraphMath(source), "$a_B = a_A + α × r + ω × (ω × r)$, где $ω$ — угловая скорость.");
		assert.equal(formatGraphMath("ω × (ω × r) = −|ω|²r"), "$ω × (ω × r) = −|ω|²r$");
	});
	it("separates comma-delimited expressions and conjunctions", () => {
		assert.equal(formatGraphMath("A=f_xx, B=f_xy, C=f_yy и Δ=AC−B². Условия: Δ>0 и A>0."),
			"$A=f_xx$, $B=f_xy$, $C=f_yy$ и $Δ=AC−B²$. Условия: $Δ>0$ и $A>0$.");
	});
	it("recognizes function arguments and implicit products only within a formula", () => {
		assert.equal(formatGraphMath("Уравнение F(x,y,z(x,y))=0 даёт r = AB."),
			"Уравнение $F(x,y,z(x,y))=0$ даёт $r = AB$.");
	});
	it("preserves all already delimited math and code byte for byte", () => {
		const source = String.raw`$x_i=2$; $$y_j=3$$; \(z_k=4\); \[q_i=5\]. ` + "`a_i=6`\n\n```text\nb_i = 7\n```\n\n    c_i = 8\n";
		assert.equal(formatGraphMath(source), source);
	});
	it("formats prose on either side of protected code and existing math", () => {
		assert.equal(formatGraphMath("h_i и `$x_k$` и $r_j$ и ∂r/∂q_i"), "$h_i$ и `$x_k$` и $r_j$ и $∂r/∂q_i$");
	});
	it("preserves prose, file names, identifiers, currency and version numbers", () => {
		for (const source of ["Обычный текст без формул.", "API and PDF support", "user_id graph_data.json file_name.md", "Запуск v1.2, 2026-11-04, 25 MB.", "Стоимость $5 или \\$10.", "English words have underscores and are safe."])
			assert.equal(formatGraphMath(source), source);
		assert.equal(formatGraphMath("API h_i и PDF Q_k = 2"), "API $h_i$ и PDF $Q_k = 2$");
	});
	it("does not insert math inside links, URLs, paths or HTML", () => {
		const source = "[x_i=2](https://example.test/?x=2) ![h_i](/tmp/a_b.png) https://example.test/?x=2 /tmp/x_y=3.txt C:\\tmp\\x_y.txt <span data-id=\"x_i\">name</span>";
		assert.equal(formatGraphMath(source), source);
	});
	it("does not reinterpret an expression embedded in an ordinary identifier", () => {
		for (const source of ["some_x_i", "prefixQ_k", "project_x=2.txt", "version1.2", "x86_64", "foo/bar_baz"])
			assert.equal(formatGraphMath(source), source);
	});
	it("leaves source Markdown structure and newlines intact", () => {
		assert.equal(formatGraphMath("## Условие h_i\n\n- Δ>0\n- A>0\n\n**Ответ:** Q_k = 2."),
			"## Условие $h_i$\n\n- $Δ>0$\n- $A>0$\n\n**Ответ:** $Q_k = 2$.");
	});
	it("is idempotent and does not repair an ambiguous incomplete expression", () => {
		const source = "Пример Q_k = F·∂r/∂q_k и `x_i`.";
		assert.equal(formatGraphMath(formatGraphMath(source)), formatGraphMath(source));
		assert.equal(formatGraphMath("Здесь x + и foo_bar."), "Здесь x + и foo_bar.");
	});
});
