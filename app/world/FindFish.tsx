"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FishSprite } from "@/app/_components/FishSprite";
import type { RecommendationsResponse } from "@/lib/recs/schema";
import { Sheet } from "./Sheet";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: RecommendationsResponse };

/**
 * "Find fish": up to 3 people you haven't met who share interests, so you go find them
 * IN PERSON and tap their tag. Only a button on the island (suggested fish are never
 * rendered in the world). No numbers, no percentages, no contact buttons.
 */
export function FindFish({ meId }: { meId: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /** refresh = the ↻ button: skip the server's refresh window (AI only runs if something changed). */
  const fetchRecs = useCallback(
    (refresh: boolean) =>
      fetch(`/api/recommendations?userId=${encodeURIComponent(meId)}${refresh ? "&refresh=1" : ""}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((data: RecommendationsResponse) => setLoad({ kind: "ready", data }))
        .catch(() => setLoad({ kind: "error" })),
    [meId],
  );
  useEffect(() => {
    void fetchRecs(false);
  }, [fetchRecs]);
  const refresh = async () => {
    setRefreshing(true);
    await fetchRecs(true);
    setRefreshing(false);
  };

  const count = load.kind === "ready" && load.data.enabled ? load.data.fish.length : 0;
  return (
    <>
      <button type="button" className="find-fish-btn" onClick={() => setOpen(true)} aria-label={count ? `Find fish (${count} to meet)` : "Find fish"}>
        <span className="find-fish-icon" aria-hidden>
          <FishSprite sizes="32px" />
        </span>
        <span>Find fish</span>
        {count > 0 && <span className="find-fish-badge">{count}</span>}
      </button>
      {open && (
        <Sheet onClose={() => setOpen(false)} className="find-fish-sheet">
          <div className="rec-title">
            <h2>Sea-cret fish to meet 🌊</h2>
            {load.kind !== "loading" && !(load.kind === "ready" && !load.data.enabled) && (
              <button type="button" className="secondary rec-refresh" onClick={refresh} disabled={refreshing} aria-label="Refresh suggestions">
                {refreshing ? "…" : "↻"}
              </button>
            )}
          </div>
          <RecList load={load} />
        </Sheet>
      )}
    </>
  );
}

function RecList({ load }: { load: Load }) {
  if (load.kind === "loading") return <p className="muted">Looking around the market…</p>;
  if (load.kind === "error") return <p className="error">Couldn&apos;t load suggestions right now.</p>;
  const { enabled, fish } = load.data;
  if (!enabled)
    return (
      <p>
        Turn on suggestions in your profile to see fish to meet. <Link href="/me">Go to my profile →</Link>
      </p>
    );
  if (!fish.length) return <p className="muted">No new fish to suggest right now — check back later 🐟</p>;
  return (
    <ul className="rec-list">
      {fish.map((f) => (
        <li key={f.id} className="rec-card">
          <div className="rec-head">
            <span className="rec-sprite">
              <FishSprite appearance={f.appearance} sizes="64px" />
            </span>
            <strong className="rec-name">{f.displayName}</strong>
          </div>
          {f.sharedInterests.length > 0 && (
            <p className="rec-shared">
              You both like:{" "}
              {f.sharedInterests.map((s) => (
                <span key={s.label} className="chip">
                  {s.label}
                </span>
              ))}
            </p>
          )}
          {f.bridges.map((b) => (
            <p key={b.label} className="rec-bridge">
              ✨ {b.label}
            </p>
          ))}
          <p className="rec-teaser">“{f.teaser}”</p>
          <p className="rec-go">Find {f.displayName} and tap their tag 🌊</p>
        </li>
      ))}
    </ul>
  );
}
