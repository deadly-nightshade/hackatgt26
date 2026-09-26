import { NextResponse } from "next/server";
import { z } from "zod";
import { formatZodError } from "@/lib/profile/extract";
import { AnswerSchema, normalizeProfile, ProfileSchema } from "@/lib/profile/schema";
import { getProfileRepository } from "@/lib/storage";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

const Body = z.object({
  profile: ProfileSchema,
  rawAnswers: z.array(AnswerSchema).default([]),
});

/** POST { profile (user-edited), rawAnswers } → validate → repo.save → { id } */
export const POST = withRoute("POST /api/onboarding/confirm", async (req) => {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, `Invalid profile:\n${formatZodError(body.error)}`);
  const { id } = await getProfileRepository().save({
    profile: normalizeProfile(body.data.profile),
    rawAnswers: body.data.rawAnswers,
  });
  return NextResponse.json({ id });
});
