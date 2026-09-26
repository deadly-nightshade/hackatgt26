import { NextResponse } from "next/server";
import { getPairRepository, getProfileRepository } from "@/lib/storage";
import { isValidProfileId } from "@/lib/storage/profileRepo";
import { HttpError, withRoute } from "@/lib/util/log";
import { getReplay } from "@/lib/world/server";

export const runtime = "nodejs";

/** GET ?userId= → the exact saved cutscene for a replay (403 if userId isn't in the pair). Read-only. */
export const GET = withRoute("GET /api/attempts/:id", async (req, { params }: { params: Promise<{ attemptId: string }> }) => {
  const { attemptId } = await params;
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!isValidProfileId(userId)) throw new HttpError(400, "Expected ?userId=");
  return NextResponse.json(await getReplay(attemptId, userId, { profiles: getProfileRepository(), pairs: getPairRepository() }));
});
