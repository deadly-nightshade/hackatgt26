"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FishCreator } from "@/app/_components/FishCreator";
import { DEFAULT_APPEARANCE, getAppearance, sameAppearance, type Appearance } from "@/lib/fish/appearance";
import { FISH_ID_HEADER, getFishId } from "@/lib/meet/identity";
import type { Profile } from "@/lib/profile/schema";
import ReviewProfile from "../onboarding/ReviewProfile";

type Save = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string };

/** Your own fish: edit its look (the same creator as onboarding), profile read-only below. */
export default function MePage() {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [look, setLook] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [save, setSave] = useState<Save>({ kind: "idle" });
  const [tagUrl, setTagUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fishId = getFishId();
    if (!fishId) return router.replace("/onboarding?returnTo=/me");
    setId(fishId);
    setTagUrl(`${window.location.origin}/meet/${encodeURIComponent(fishId)}`);
    fetch(`/api/users/${encodeURIComponent(fishId)}/profile`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        const appearance = getAppearance(j.appearance);
        setProfile(j.profile);
        setSaved(appearance);
        setLook(appearance);
      })
      .catch(() => router.replace("/onboarding?returnTo=/me"));
  }, [router]);

  async function saveLook() {
    if (!id) return;
    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(id)}/appearance`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", [FISH_ID_HEADER]: id },
        body: JSON.stringify({ head: look.head, feet: look.feet }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      const appearance = getAppearance(json.appearance);
      setSaved(appearance);
      setLook(appearance);
      setSave({ kind: "saved" });
    } catch (err) {
      setSave({ kind: "error", message: (err as Error).message });
    }
  }

  if (!profile) return <main className="meet-shell"><p className="muted">Fetching your fish…</p></main>;
  const changed = !sameAppearance(look, saved);
  return (
    <main className="creator-page">
      <p className="me-back">
        <Link href="/world">← Back to island</Link>
      </p>
      <h1>{profile.displayName} 🐟</h1>
      <section className="card me-look">
        <h2>Edit my fish</h2>
        <FishCreator
          appearance={look}
          onChange={(a) => {
            setLook(a);
            if (save.kind !== "saving") setSave({ kind: "idle" });
          }}
          name={profile.displayName}
        />
        <div className="row creator-actions">
          {changed && (
            <button className="secondary" onClick={() => setLook(saved)} disabled={save.kind === "saving"}>
              Undo
            </button>
          )}
          <button onClick={saveLook} disabled={!changed || save.kind === "saving"}>
            {save.kind === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="creator-status" aria-live="polite">
          {save.kind === "saved" && !changed && "Saved! Your fish is showing off its new look on the island. ✨"}
          {save.kind === "error" && <span className="error">{save.message}</span>}
        </p>
      </section>

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
        <Link href="/world">Back to island</Link> · <Link href="/onboarding">Redo onboarding</Link>
      </p>
    </main>
  );
}
