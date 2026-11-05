"use client";

import { formatGraphMath, repairMathForDisplay } from "@/src/core";
import { MessageResponse } from "./ai-elements/message.tsx";

/** Saved graph text is complete. Recover and mark math for presentation;
 * the original node, explanation and model context remain untouched. */
export function GraphMathText({ children, className }: { children: string; className?: string }) {
	return <MessageResponse mode="static" className={className}>{formatGraphMath(repairMathForDisplay(children))}</MessageResponse>;
}
