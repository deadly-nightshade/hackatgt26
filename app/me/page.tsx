"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getFishId } from "@/lib/meet/identity";
import type { Profile } from "@/lib/profile/schema";
import ReviewProfile from "../onboarding/ReviewProfile";

/** Your own fish profile, read-only (same cards as the onboarding review step). */
export default function MePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const id = getFishId();
    if (!id) return router.replace("/onboarding?returnTo=/me");
    fetch(`/api/users/${encodeURIComponent(id)}/profile`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => setProfile(j.profile))
      .catch(() => router.replace("/onboarding?returnTo=/me"));
  }, [router]);

  if (!profile) return <main className="meet-shell"><p className="muted">Fetching your fish…</p></main>;
  return (
    <main>
      <h1>{profile.displayName} 🐟</h1>
      <ReviewProfile profile={profile} readOnly />
      <p>
        <Link href="/">Back to island</Link> · <Link href="/onboarding">Redo onboarding</Link>
      </p>
    </main>
  );
}
