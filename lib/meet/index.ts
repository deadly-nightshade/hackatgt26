import { getMeetAI } from "@/lib/meet/ai";
import type { MeetDeps } from "@/lib/meet/pipeline";
import { getPairRepository, getProfileRepository } from "@/lib/storage";

/** Real dependencies for the meet pipeline (env-selected storage + AI_MODE). */
export function defaultMeetDeps(): MeetDeps {
  return { profiles: getProfileRepository(), pairs: getPairRepository(), ai: getMeetAI() };
}
