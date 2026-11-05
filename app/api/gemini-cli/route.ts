import { geminiCliConnectionResponse } from "@/src/server";
export const runtime = "nodejs";
export async function GET(request: Request) { return geminiCliConnectionResponse(request); }
export async function POST(request: Request) { return geminiCliConnectionResponse(request); }
