import { NextResponse } from "next/server";
import { z } from "zod";
import { FISH_ID_HEADER } from "@/lib/meet/identity";
import { getProfileRepository } from "@/lib/storage";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

/**
 * PATCH { discoverable } → { discoverable }. The "suggest me to other fish" consent.
 * Owner only (x-fish-id must be :id). Never touches contentUpdatedAt (no pair AI reset).
 */
export const PATCH = withRoute("PATCH /api/users/:id/discoverable", async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  if (req.headers.get(FISH_ID_HEADER) !== id) throw new HttpError(403, "You can only change your own fish");
  const body = z.object({ discoverable: z.boolean() }).safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "Expected { discoverable: boolean }");
  if (!(await getProfileRepository().setDiscoverable(id, body.data.discoverable))) throw new HttpError(404, "No fish with that id");
  return NextResponse.json({ discoverable: body.data.discoverable });
});
