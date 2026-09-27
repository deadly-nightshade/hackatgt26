import { NextResponse } from "next/server";
import { FISH_ID_HEADER } from "@/lib/meet/identity";
import { applyProfileEdit, formatEditError, ProfileEditError, ProfileEditSchema } from "@/lib/profile/edit";
import { withoutTraits } from "@/lib/profile/schema";
import { getPairRepository, getProfileRepository } from "@/lib/storage";
import { getResidentsFor } from "@/lib/world/server";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

/** GET → { id, profile (never the personality traits), appearance } for the owner's /me page (no auth: knowing the id is the key, like the meet flow). */
export const GET = withRoute("GET /api/users/:id/profile", async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const profiles = getProfileRepository();
  const stored = await profiles.get(id);
  if (!stored) throw new HttpError(404, "No fish with that id");
  const { residents } = await getResidentsFor(id, { profiles, pairs: getPairRepository() });
  return NextResponse.json({
    id: stored.id,
    profile: withoutTraits(stored.profile),
    appearance: stored.appearance,
    onboardingMode: stored.onboardingMode,
    discoverable: stored.discoverable,
    // Own profile page only ("🐟 N fish friends · M just met").
    counts: { friends: residents.filter((r) => r.status === "friends").length, strangers: residents.filter((r) => r.status !== "friends").length },
  });
});

/**
 * PATCH { displayName, summary, interests, wantsToTry, socialStyle, vibeType, residentFlavor,
 * conversationStarters } → { profile, contentChanged }. Owner only (x-fish-id must be :id).
 * No AI call. Only matching fields (interests, wantsToTry, socialStyle) bump contentUpdatedAt,
 * i.e. the pair AI regenerates lazily on the next meet; cosmetic edits never do.
 */
export const PATCH = withRoute("PATCH /api/users/:id/profile", async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (req.headers.get(FISH_ID_HEADER) !== id) throw new HttpError(403, "You can only edit your own fish");
  const body = ProfileEditSchema.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, formatEditError(body.error));
  const repo = getProfileRepository();
  const stored = await repo.get(id);
  if (!stored) throw new HttpError(404, "No fish with that id");
  let result;
  try {
    result = applyProfileEdit(stored.profile, body.data);
  } catch (err) {
    if (err instanceof ProfileEditError) throw new HttpError(400, err.message);
    throw err;
  }
  await repo.update(id, { profile: result.profile }, { contentChanged: result.contentChanged });
  return NextResponse.json({ profile: withoutTraits(result.profile), contentChanged: result.contentChanged });
});
