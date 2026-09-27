import { NextResponse } from "next/server";
import { defaultRecDeps } from "@/lib/recs";
import { getRecommendations } from "@/lib/recs/service";
import { isValidProfileId } from "@/lib/storage/profileRepo";
import { HttpError, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET ?userId=<me>[&refresh=1] → { enabled, fish: [{ id, displayName, appearance, sharedInterests: [{label}], bridges: [{label}], teaser }] }
 * Max 3, best first. No scores. Only what's SHARED — never anyone's full profile.
 * Served from cache unless something changed and the refresh window passed.
 * refresh=1 (the sheet's ↻ button) skips the window — but still only calls the AI if something
 * actually changed, and still counts toward the daily budget.
 */
export const GET = withRoute("GET /api/recommendations", async (req) => {
  const params = new URL(req.url).searchParams;
  const userId = params.get("userId") ?? "";
  if (!isValidProfileId(userId)) throw new HttpError(400, "Expected ?userId=");
  const { response } = await getRecommendations(userId, defaultRecDeps(), { force: params.get("refresh") === "1" });
  return NextResponse.json(response);
});
