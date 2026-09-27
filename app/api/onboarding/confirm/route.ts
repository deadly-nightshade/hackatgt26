import { NextResponse } from "next/server";
import { z } from "zod";
import { AppearanceInput, getAppearance } from "@/lib/fish/appearance";
import { formatZodError } from "@/lib/profile/extract";
import { AnswerSchema, normalizeProfile, ProfileSchema } from "@/lib/profile/schema";
import { FISH_ID_HEADER } from "@/lib/meet/identity";
import { getProfileRepository } from "@/lib/storage";
import { isValidProfileId } from "@/lib/storage/profileRepo";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

const Body = z.object({
  profile: ProfileSchema,
  rawAnswers: z.array(AnswerSchema).default([]),
  /** From the creator; unknown ids → the slot default. */
  appearance: AppearanceInput.optional(),
  /** Redo onboarding: update this existing fish in place (friendships stay). Must be the caller's own fish. */
  id: z.string().refine(isValidProfileId).optional(),
  /** Analytics/debug only. */
  onboardingMode: z.enum(["quick", "full"]).optional(),
});

/**
 * POST { profile (user-edited), rawAnswers, appearance, id? } → { id, updated }
 * No id → a brand-new fish. With id (redo onboarding) → that fish is updated in place,
 * keeping its id so pairs/friendships/history survive.
 */
export const POST = withRoute("POST /api/onboarding/confirm", async (req) => {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, `Invalid profile:\n${formatZodError(body.error)}`);
  const record = {
    profile: normalizeProfile(body.data.profile),
    rawAnswers: body.data.rawAnswers,
    appearance: getAppearance(body.data.appearance),
    onboardingMode: body.data.onboardingMode,
  };
  const repo = getProfileRepository();
  if (body.data.id) {
    if (req.headers.get(FISH_ID_HEADER) !== body.data.id) throw new HttpError(403, "You can only redo your own fish");
    if (!(await repo.update(body.data.id, record))) throw new HttpError(404, "No fish with that id");
    return NextResponse.json({ id: body.data.id, updated: true });
  }
  const { id } = await repo.save(record);
  return NextResponse.json({ id, updated: false });
});
