import { NextResponse } from "next/server";
import { getPairRepository, getProfileRepository } from "@/lib/storage";
import { isValidProfileId } from "@/lib/storage/profileRepo";
import { HttpError, withRoute } from "@/lib/util/log";
import { getHistory } from "@/lib/world/server";

export const runtime = "nodejs";

/** GET ?userId= → this pair's past cutscenes, newest first (403 if userId isn't in the pair). */
export const GET = withRoute("GET /api/pairs/:pairKey/history", async (req, { params }: { params: Promise<{ pairKey: string }> }) => {
  const { pairKey } = await params;
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!isValidProfileId(userId)) throw new HttpError(400, "Expected ?userId=");
  const history = await getHistory(decodeURIComponent(pairKey), userId, { profiles: getProfileRepository(), pairs: getPairRepository() });
  return NextResponse.json({ history });
});
