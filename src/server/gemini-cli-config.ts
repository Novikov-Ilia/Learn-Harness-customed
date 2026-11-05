import { geminiConnection } from "../agent/gemini-cli/connection.ts";
import { geminiInstallation } from "../agent/gemini-cli/runtime.ts";
/** Local cached account OAuth only. Never a subscription/quota guarantee. */
export function geminiCliAvailable(): boolean { return geminiInstallation().installed && geminiConnection.connected(); }
