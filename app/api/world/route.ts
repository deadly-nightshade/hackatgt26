import { NextResponse } from "next/server";
import { getPairRepository, getProfileRepository } from "@/lib/storage";
import { isValidProfileId } from "@/lib/storage/profileRepo";
import { HttpError, withRoute } from "@/lib/util/log";
import { getWorld } from "@/lib/world/server";

export const runtime = "nodejs";

/** GET ?userId= → me + every fish I've met + their bump lines. Reads stored data only (no AI). */
export const GET = withRoute("GET /api/world", async (req) => {
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!isValidProfileId(userId)) throw new HttpError(400, "Expected ?userId=");
  return NextResponse.json(await getWorld(userId, { profiles: getProfileRepository(), pairs: getPairRepository() }));
});
