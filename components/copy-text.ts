/** Clipboard write with a fallback: navigator.clipboard needs the
 *  `clipboard-sanitized-write` permission, which Electron's deny-by-default
 *  handler (electron/main.cjs) must grant from the loopback origin — and
 *  browsers with a stale/absent API reject too. The hidden-textarea
 *  execCommand path is the belt under that: a failed write would otherwise
 *  be a silent no-op, which is exactly what the owner saw. Returns whether
 *  the copy landed (drives the Copied pill). */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		/* fall through to the legacy path */
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.setAttribute("readonly", "");
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}
