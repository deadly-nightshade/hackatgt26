import { NextResponse } from "next/server";
import { AppearanceInput, getAppearance } from "@/lib/fish/appearance";
import { FISH_ID_HEADER } from "@/lib/meet/identity";
import { getProfileRepository } from "@/lib/storage";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

/**
 * PATCH { head, feet } → { appearance } (validated; unknown ids → none).
 * Hackathon-level check: the caller's localStorage fishId (sent as a header) must be :id.
 * Only appearance changes — the profile's updatedAt (pair AI cache key) is untouched.
 */
export const PATCH = withRoute("PATCH /api/users/:id/appearance", async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (req.headers.get(FISH_ID_HEADER) !== id) throw new HttpError(403, "You can only change your own fish");
  const body = AppearanceInput.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "Expected { head, feet }");
  const appearance = getAppearance(body.data);
  if (!(await getProfileRepository().setAppearance(id, appearance))) throw new HttpError(404, "No fish with that id");
  return NextResponse.json({ appearance });
});
