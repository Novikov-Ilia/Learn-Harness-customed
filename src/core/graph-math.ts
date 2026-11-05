/** Display-only recognition of unambiguous formulas in older graph prose.
 * Adds delimiters, never repairs notation or writes back to saved knowledge. */
import { fromMarkdown } from "mdast-util-from-markdown";
import { readContentSpans } from "./content-reader.ts";

type Range = { start: number; end: number };
type MarkdownNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: MarkdownNode[] };
const word = /[\p{L}\p{M}\p{N}_]/u;
const greek = /[\u0370-\u03ff]/u;
const accents = /[\u0300-\u036f]/gu;
const letters = /^[A-Za-z\u0370-\u03ff\u0300-\u036f]+/u;
const scripts = /^[²³¹⁰⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾]+/u;
const operator = /^[=+−\-*/×·<>≤≥≠≈∈∉⊂⊆→↔±^]/u;

/** Link targets, literal HTML, URLs and paths remain source text too. The
 * shared reader already supplies the renderer's actual code/math boundaries. */
function opaqueRanges(text: string): Range[] {
	const ranges: Range[] = [];
	const pending: MarkdownNode[] = [fromMarkdown(text)];
	while (pending.length) {
		const node = pending.pop()!;
		if (["link", "linkReference", "image", "imageReference", "definition", "html"].includes(node.type)) {
			const start = node.position?.start.offset, end = node.position?.end.offset;
			if (start !== undefined && end !== undefined) ranges.push({ start, end });
		} else if (node.children) pending.push(...node.children);
	}
	for (const pattern of [/(?:https?:\/\/|mailto:)[^\s<>]+/gu,
		/(?<![\p{L}\p{N}_])(?:[A-Za-z]:[\\/]|\.{1,2}\/|\/(?=[A-Za-z.])[^\s/]+\/)[^\s<>]+/gu]) {
		for (const match of text.matchAll(pattern)) ranges.push({ start: match.index, end: match.index + match[0].length });
	}
	return ranges.sort((a, b) => a.start - b.start);
}

type Atom = { end: number; variable: boolean; distinct: boolean };
function atomAt(text: string, start: number): Atom | undefined {
	let i = start, variable = false, distinct = false;
	const number = /^\d+(?:\.\d+)?/.exec(text.slice(i));
	const name = letters.exec(text.slice(i))?.[0];
	if (number) i += number[0].length;
	else if (name) {
		const plain = name.replace(accents, "");
		// Restrict bare Latin words, while retaining standard differential and
		// short point/vector products such as dt, dxdy, AB, mV and Vτ.
		if (!(plain.length === 1 || /^[A-Z]{2}$/.test(plain) || /^[a-z][A-Z]$/.test(plain)
			|| /^d(?:[A-Za-z]|[xyz]d[xyz])$/.test(plain)
			|| /^(?:sin|cos|tan|det|ln|log|exp)$/.test(plain)
			|| (greek.test(plain) && /^[A-Za-z\u0370-\u03ff]{1,4}$/u.test(plain)))) return;
		i += name.length; variable = true; distinct = greek.test(name) || name !== plain;
	} else if (/[∂∇∫∑∞]/u.test(text[i] ?? "")) {
		i++; variable = true; distinct = true;
	} else return;
	while (i < text.length) {
		if (text[i] === "_") {
			const sub = /^(?:\{[A-Za-z\u0370-\u03ff\d,+−-]+\}|[A-Za-z\u0370-\u03ff\d]+)/u.exec(text.slice(i + 1));
			if (!sub) break;
			i += 1 + sub[0].length; distinct = true;
		} else {
			const sup = scripts.exec(text.slice(i));
			if (!sup) break;
			i += sup[0].length; distinct = true;
		}
	}
	return { end: i, variable, distinct };
}

function formulaAt(text: string, start: number): number | undefined {
	if (start > 0 && /[\p{L}\p{M}\p{N}_\\./$@]/u.test(text[start - 1]!)) return;
	if (!/[A-Za-z\u0370-\u03ff∂∇∫∑∞(]/u.test(text[start] ?? "")) return;
	let i = start, complete = start, distinct = false, variable = false, expectsAtom = true;
	let completeDistinct = false, completeVariable = false;
	const stack: string[] = [];
	while (i < text.length && i - start < 2048) {
		const char = text[i]!;
		if (char === " " || char === "\t") { i++; continue; }
		const atom = atomAt(text, i);
		if (atom) {
			// Bare letter-number identifiers (x86_64, v1.2) do not provide
			// reliable mathematical evidence. Explicit scripts remain valid.
			if (!expectsAtom && i > start && /[A-Za-z\u0370-\u03ff]/u.test(text[i - 1]!) && /^\d/.test(char)) break;
			i = atom.end; variable ||= atom.variable; distinct ||= atom.distinct; expectsAtom = false;
		} else if (char === "(" || (char === "|" && expectsAtom)) {
			stack.push(char); i++; expectsAtom = true; continue;
		} else if (char === ")" || char === "|") {
			if (expectsAtom || stack.at(-1) !== (char === ")" ? "(" : "|")) break;
			stack.pop(); i++; expectsAtom = false;
			const sup = scripts.exec(text.slice(i));
			if (sup) { i += sup[0].length; distinct = true; }
		} else if (char === "," && stack.length && !expectsAtom) {
			i++; expectsAtom = true; continue;
		} else if (operator.test(char)) {
			if (expectsAtom && !/[+−-]/u.test(char)) break;
			distinct = true; expectsAtom = true; i++; continue;
		} else break;
		if (!stack.length && !expectsAtom) {
			complete = i; completeDistinct = distinct; completeVariable = variable;
		}
	}
	// A partial word or filename is not a formula boundary. Bare Latin
	// variables and numbers require an actual mathematical relation/operator.
	if (complete === start || !completeDistinct || !completeVariable
		|| word.test(text[complete] ?? "") || /^\.[A-Za-z]/.test(text.slice(complete))) return;
	return complete;
}

function formatPlain(text: string): string {
	let out = "", i = 0;
	while (i < text.length) {
		const end = formulaAt(text, i);
		if (end !== undefined) { out += `$${text.slice(i, end)}$`; i = end; }
		else {
			// Do not retry at the tail of an ordinary word/identifier.
			const literal = /^[\p{L}\p{M}\p{N}_]+/u.exec(text.slice(i))?.[0] ?? text[i]!;
			out += literal; i += literal.length;
		}
	}
	return out;
}

export function formatGraphMath(text: string): string {
	const opaque = opaqueRanges(text);
	let offset = 0;
	return readContentSpans(text).map(span => {
		const start = offset; offset += span.raw.length;
		if (span.kind !== "prose") return span.raw;
		let out = "", cursor = start;
		for (const range of opaque) {
			if (range.end <= cursor || range.start >= offset) continue;
			const opaqueStart = Math.max(cursor, range.start), opaqueEnd = Math.min(offset, range.end);
			out += formatPlain(text.slice(cursor, opaqueStart)) + text.slice(opaqueStart, opaqueEnd);
			cursor = opaqueEnd;
		}
		return out + formatPlain(text.slice(cursor, offset));
	}).join("");
}
