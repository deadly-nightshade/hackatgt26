import { notFound } from "next/navigation";
import { meetConfig } from "@/lib/meet/config";
import { getProfileRepository } from "@/lib/storage";
import WhoAmI from "./WhoAmI";

export const dynamic = "force-dynamic";

/** Dev-only: pick which fish this browser is, and jump to meet pages. */
export default async function WhoAmIPage() {
  if (!meetConfig.devTools()) notFound();
  const users = await getProfileRepository().list();
  return <WhoAmI users={users.map((u) => ({ id: u.id, displayName: u.displayName, isSeed: u.isSeed }))} />;
}
