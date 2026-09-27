import { NextResponse } from "next/server";
import { getProfileRepository } from "@/lib/storage";
import { HttpError, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

const MAX_RESULTS = 8;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * GET ?name=<display name> → { fish: [{ id, displayName, appearance, createdAt }] }
 * Exact (case-insensitive) name matches, newest first. Lets someone who is on a
 * different browser/app than where they onboarded (NFC taps open Safari) pick
 * their own fish again instead of re-onboarding. Hackathon-level: like the tag
 * URLs, knowing a fish's name is enough.
 */
export const GET = withRoute("GET /api/users/find", async (req) => {
  const name = norm(new URL(req.url).searchParams.get("name") ?? "");
  if (!name || name.length > 60) throw new HttpError(400, "Expected ?name=");
  const repo = getProfileRepository();
  const matches = (await repo.list()).filter((u) => !u.isSeed && norm(u.displayName) === name);
  const fish = (await Promise.all(matches.map((u) => repo.get(u.id))))
    .filter((p) => p !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, MAX_RESULTS)
    .map((p) => ({ id: p.id, displayName: p.profile.displayName, appearance: p.appearance, createdAt: p.createdAt.toISOString() }));
  return NextResponse.json({ fish });
});
