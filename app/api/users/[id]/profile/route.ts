import { NextResponse } from "next/server";
import { getProfileRepository } from "@/lib/storage";
import { HttpError, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

/** GET → { id, profile } for the owner's /me page (no auth: knowing the id is the key, like the meet flow). */
export const GET = withRoute("GET /api/users/:id/profile", async (_req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const stored = await getProfileRepository().get(id);
  if (!stored) throw new HttpError(404, "No fish with that id");
  return NextResponse.json({ id: stored.id, profile: stored.profile });
});
