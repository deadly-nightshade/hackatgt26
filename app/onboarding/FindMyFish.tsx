"use client";

import { useState } from "react";
import { FishSprite } from "@/app/_components/FishSprite";
import type { Appearance } from "@/lib/fish/appearance";
import { setFishId } from "@/lib/meet/identity";

type Found = { id: string; displayName: string; appearance: Appearance; createdAt: string };

/**
 * "I already have a fish": for people on a different browser/app than where they
 * onboarded (NFC taps open the phone's default browser). Find by name → tap your
 * fish → identity restored here, then continue to `onFound`.
 */
export default function FindMyFish({ initialName, onFound }: { initialName: string; onFound: () => void }) {
  const [name, setName] = useState(initialName);
  const [results, setResults] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/find?name=${encodeURIComponent(name.trim())}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Search failed (${res.status})`);
      setResults(json.fish);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card find-fish">
      <h2>Already made your fish?</h2>
      <p className="muted">On another browser or app? Type your fish&apos;s name to pick it up here.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void search();
        }}
      >
        <input aria-label="Your fish's name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Your fish's name" />
        <button type="submit" className="secondary" disabled={busy || !name.trim()}>
          {busy ? "…" : "Find my fish"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {results?.length === 0 && <p className="muted">No fish with that name yet. Check the spelling, or make a new one above.</p>}
      {!!results?.length && (
        <ul className="find-results">
          {results.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setFishId(f.id);
                  onFound();
                }}
              >
                <span className="find-sprite">
                  <FishSprite appearance={f.appearance} sizes="48px" />
                </span>
                <span>
                  That&apos;s me: <strong>{f.displayName}</strong>
                  <span className="muted"> · joined {new Date(f.createdAt).toLocaleDateString()}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
