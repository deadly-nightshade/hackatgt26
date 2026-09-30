import { after, NextResponse } from "next/server";
import { z } from "zod";
import { meetConfig } from "@/lib/meet/config";
import { defaultMeetDeps } from "@/lib/meet";
import { runMeet } from "@/lib/meet/pipeline";
import { isValidProfileId } from "@/lib/storage/profileRepo";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";
export const maxDuration = 120; // first meet of a pair: analysis + dialogue (~60s live); pipeline gives up on the AI at 90s

const Id = z.string().refine(isValidProfileId, "invalid id");
const Body = z.object({ initiatorId: Id, targetId: Id });

/** POST { initiatorId, targetId } [?regenerate=1 in dev] → cutscene script + outcome */
export const POST = withRoute("POST /api/meet", async (req) => {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "Expected { initiatorId, targetId }");
  const dev = meetConfig.devTools();
  const regenerate = dev && new URL(req.url).searchParams.get("regenerate") === "1";
  const result = await runMeet({ ...body.data, regenerate, includeDebug: dev }, { ...defaultMeetDeps(), background: (task) => after(task) });
  return NextResponse.json(result);
});
