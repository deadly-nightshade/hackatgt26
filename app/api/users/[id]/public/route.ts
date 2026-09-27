import { NextResponse } from "next/server";
import { getProfileRepository } from "@/lib/storage";
import { HttpError, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

/** GET → { id, displayName, appearance } (the only public bits of a profile). */
export const GET = withRoute("GET /api/users/:id/public", async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const stored = await getProfileRepository().get(id);
  if (!stored) throw new HttpError(404, "No fish with that id");
  return NextResponse.json({ id: stored.id, displayName: stored.profile.displayName, appearance: stored.appearance });
});
