import { NextResponse } from "next/server";
import { createRealtimeSttToken } from "@/lib/ai/transcribe";
import { config } from "@/lib/config";
import { HttpError, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST → { token } for live browser→ElevenLabs transcription.
 * 204 in AI_MODE=mock: the client then records + uploads to /api/transcribe (canned, zero API calls).
 */
export const POST = withRoute("POST /api/stt-token", async () => {
  if (config.aiMode() === "mock") return new Response(null, { status: 204 });
  try {
    return NextResponse.json({ token: await createRealtimeSttToken() }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    throw new HttpError(502, (err as Error).message);
  }
});
