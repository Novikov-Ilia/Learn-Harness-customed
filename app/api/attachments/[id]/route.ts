import { attachmentContentResponse } from "@/src/server";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	return attachmentContentResponse((await params).id);
}
