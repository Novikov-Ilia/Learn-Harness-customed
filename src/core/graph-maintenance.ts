/** Process-wide maintenance lock, also visible to destructive graph actions. */
const globalState = globalThis as typeof globalThis & { __lhGraphMaintenance?: symbol };
export function graphMaintenanceRunning(): boolean { return globalState.__lhGraphMaintenance !== undefined; }
export function claimGraphMaintenance(): () => void {
	if (graphMaintenanceRunning()) throw new Error("Graph reprocessing is already running; try again when it finishes.");
	const token = Symbol("graph-maintenance"); globalState.__lhGraphMaintenance = token;
	return () => { if (globalState.__lhGraphMaintenance === token) delete globalState.__lhGraphMaintenance; };
}
