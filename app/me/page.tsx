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
  const [tagUrl, setTagUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const id = getFishId();
    if (!id) return router.replace("/onboarding?returnTo=/me");
    setTagUrl(`${window.location.origin}/meet/${encodeURIComponent(id)}`);
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
      <section className="card">
        <h2>Your NFC tag</h2>
        <p className="muted">Write this URL on your tag. Friends tap it to meet you.</p>
        <p className="tag-url">
          <code>{tagUrl}</code>
        </p>
        <button
          className="secondary"
          onClick={() =>
            navigator.clipboard?.writeText(tagUrl).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? "Copied!" : "Copy URL"}
        </button>
      </section>
      <p>
        <Link href="/">Back to island</Link> · <Link href="/onboarding">Redo onboarding</Link>
      </p>
    </main>
  );
}
