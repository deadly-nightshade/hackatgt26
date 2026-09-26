import { NextResponse } from "next/server";
import { z } from "zod";
import { getQuestion } from "@/lib/onboarding/questions";
import { checkAnswer } from "@/lib/profile/answerQuality";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

const Body = z.object({ questionId: z.string(), transcript: z.string().max(20_000) });

/** POST { questionId, transcript } → { ok, followUp? } */
export const POST = withRoute("POST /api/onboarding/check", async (req) => {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "Expected { questionId, transcript }");
  const question = getQuestion(body.data.questionId);
  if (!question) throw new HttpError(400, `Unknown questionId ${body.data.questionId}`);
  return NextResponse.json(await checkAnswer(question, body.data.transcript));
});
