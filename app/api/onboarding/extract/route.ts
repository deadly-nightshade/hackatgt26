import { NextResponse } from "next/server";
import { z } from "zod";
import { extractProfile, ExtractionError } from "@/lib/profile/extract";
import { AnswerSchema } from "@/lib/profile/schema";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";
export const maxDuration = 60; // extraction + one retry, 30s timeout each

const Body = z.object({
  displayName: z.string().trim().min(1).max(60),
  answers: z.array(AnswerSchema.extend({ transcript: z.string().max(20_000) })).min(1).max(20),
});

/** POST { displayName, answers[] } → { profile } */
export const POST = withRoute("POST /api/onboarding/extract", async (req) => {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "Expected { displayName, answers: [{ questionId, transcript }] }");
  try {
    return NextResponse.json({ profile: await extractProfile(body.data) });
  } catch (err) {
    if (err instanceof ExtractionError) throw new HttpError(502, "Couldn't build your profile — please try again.");
    throw new HttpError(502, `AI call failed: ${(err as Error).message}`);
  }
});
