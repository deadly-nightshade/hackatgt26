import { NextResponse } from "next/server";
import { z } from "zod";
import { meetConfig } from "@/lib/meet/config";
import { getProfileRepository } from "@/lib/storage";
import { isValidProfileId } from "@/lib/storage/profileRepo";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

/** Dev-only (same gate as /dev/whoami): POST { id, discoverable } flips anyone's "suggest me" toggle. */
export const POST = withRoute("POST /api/dev/discoverable", async (req) => {
  if (!meetConfig.whoamiEnabled()) throw new HttpError(404, "Not found");
  const body = z.object({ id: z.string().refine(isValidProfileId), discoverable: z.boolean() }).safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "Expected { id, discoverable }");
  if (!(await getProfileRepository().setDiscoverable(body.data.id, body.data.discoverable))) throw new HttpError(404, "No fish with that id");
  return NextResponse.json(body.data);
});
