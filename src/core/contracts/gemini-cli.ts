export const GEMINI_CLI_PROVIDER = "gemini-cli";
/** Keep the persisted provider ID; its runtime is now Antigravity CLI. */
export const GEMINI_CLI_VERSION = "1.5.0";
export interface GeminiCliStatus {
	state: "unavailable" | "disconnected" | "connecting" | "connected" | "error";
	installed: boolean;
	version: string | null;
	/** Local successful Google login, not subscription/entitlement verification. */
	authenticatedAt?: number;
	error?: string;
}
