import { baseAgentOptions, type AgentBuildOptions } from "./teacher-agent.ts";
import { askUserQuestionTool, probeQuizTool, probeExplainTool, quizMechanics } from "./tools.ts";
import { readTool } from "./tools/read.ts";
import { lsTool } from "./tools/ls.ts";
import { findTool } from "./tools/find.ts";
import { grepTool } from "./tools/grep.ts";
import { planTools, type PlanToolContext } from "./tools/plan.ts";
import { healToolRecord } from "./tools/heal.ts";
import { jobTools, type JobToolContext } from "./tools/jobs.ts";

/** A planner can diagnose and author a course, but cannot start a teaching/practice loop. */
export function createPlanningAgent(ctx: PlanToolContext & { jobs?: JobToolContext }, opts: AgentBuildOptions = {}) {
	const pdf = ctx.jobs && opts.toolToggles?.pdf !== false ? jobTools(ctx.jobs).pdf : undefined;
	const tools = healToolRecord({
		...(quizMechanics(opts.toolToggles) === "free" ? { recall: probeExplainTool } : { probe: probeQuizTool }),
		ask_user_question: askUserQuestionTool,
		read: readTool, ls: lsTool, find: findTool, grep: grepTool,
		...planTools(ctx),
		...(pdf ? { pdf: { ...pdf, description: "Read an attached PDF using a background specialist: text extraction and visual page reading for scans, formulas and diagrams. Ask for the material's scope and prerequisite structure. Results arrive as a background message; use them for planning only.", execute: async (...args: Parameters<typeof pdf.execute>) => {
			const result = await pdf.execute(...args);
			return result.isError ? result : { ...result, content: [{ type: "text" as const, text: "PDF reading dispatched. Its page-cited brief will arrive as a background message. Continue diagnosis or end this turn; do not begin teaching. Use the result to prepare or revise the global learning plan." }] };
		} } } : {}),
	});
	return baseAgentOptions("planning", opts, Object.values(opts.tools ?? tools));
}
