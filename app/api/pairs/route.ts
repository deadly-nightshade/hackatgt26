import { NextResponse } from "next/server";
import { levelName } from "@/lib/meet/config";
import { getPairRepository } from "@/lib/storage";
import { isValidProfileId } from "@/lib/storage/profileRepo";
import { HttpError, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

/** GET ?userId= → that fish's pairs + status (minimal; for a future friends list). */
export const GET = withRoute("GET /api/pairs", async (req) => {
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!isValidProfileId(userId)) throw new HttpError(400, "Expected ?userId=");
  const pairs = await getPairRepository().listPairsForUser(userId);
  return NextResponse.json({
    pairs: pairs.map((p) => ({
      pairKey: p.pairKey,
      otherId: p.userIds[0] === userId ? p.userIds[1] : p.userIds[0],
      status: p.status,
      friendsSince: p.friendsSince ?? null,
      similarity: p.similarity ?? null,
      level: p.level,
      levelName: p.status === "friends" ? levelName(p.level) : null,
      hangoutCount: p.hangoutCount,
    })),
  });
});
