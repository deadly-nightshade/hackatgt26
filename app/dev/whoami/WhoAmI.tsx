"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { clearFishId, getFishId, setFishId } from "@/lib/meet/identity";

type User = { id: string; displayName: string; isSeed: boolean; discoverable: boolean };

/** The URL to write on a fish's NFC tag (same as /me shows). */
const tagUrl = (id: string) => `${window.location.origin}/meet/${encodeURIComponent(id)}`;

/** Clipboard API needs https/localhost; on a plain-http LAN address fall back to execCommand. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}

export default function WhoAmI({ users }: { users: User[] }) {
  const [me, setMe] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
  /** "Shown in suggestions" per fish (dev: flip anyone's). */
  const [recs, setRecs] = useState<Record<string, boolean>>(() => Object.fromEntries(users.map((u) => [u.id, u.discoverable])));
  const [recsError, setRecsError] = useState<string | null>(null);
  const toggleRecs = async (id: string, discoverable: boolean) => {
    setRecs((r) => ({ ...r, [id]: discoverable }));
    setRecsError(null);
    const res = await fetch("/api/dev/discoverable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, discoverable }),
    }).catch(() => null);
    if (!res?.ok) {
      setRecs((r) => ({ ...r, [id]: !discoverable }));
      setRecsError(`Couldn't update ${id}`);
    }
  };
  const copy = async (id: string) => {
    const ok = await copyText(tagUrl(id));
    setCopied({ id, ok });
    setTimeout(() => setCopied((c) => (c?.id === id ? null : c)), 1500);
  };
  useEffect(() => setMe(getFishId()), []);

  const choose = (id: string) => {
    setFishId(id);
    setMe(id);
  };

  return (
    <main>
      <h1>Who am I? (dev)</h1>
      <p className="muted">
        Current fishId: <code>{me ?? "(none)"}</code>
        {me && (
          <>
            {" "}
            · <Link href="/world">Go to my beach →</Link> ·{" "}
            <button
              className="secondary"
              onClick={() => {
                clearFishId();
                setMe(null);
              }}
            >
              Log out
            </button>
          </>
        )}
        {!me && (
          <>
            {" "}
            · <Link href="/onboarding">Make a new fish →</Link>
          </>
        )}
      </p>
      {recsError && <p className="error">{recsError}</p>}
      {users.length === 0 && <p>No profiles yet. Run onboarding or <code>npm run seed:fish</code>.</p>}
      <ul className="items dev-list">
        {users.map((u) => (
          <li key={u.id}>
            <div>
              <strong>{u.displayName}</strong>
              {u.isSeed && <span className="chip">seed</span>}
              {u.id === me && <span className="chip">you</span>}
              <div className="muted">
                <code>{u.id}</code>
              </div>
            </div>
            <label className="dev-recs">
              <input type="checkbox" checked={!!recs[u.id]} onChange={(e) => toggleRecs(u.id, e.target.checked)} /> Shown in suggestions
            </label>
            <div className="row">
              <button className="secondary" onClick={() => copy(u.id)} title="Copy the NFC tag URL for this fish">
                {copied?.id === u.id ? (copied.ok ? "Copied!" : "Couldn't copy") : "Copy link"}
              </button>
              {u.id !== me && (
                <button className="secondary" onClick={() => choose(u.id)}>
                  Be this fish
                </button>
              )}
              {me && u.id !== me && <Link href={`/meet/${u.id}`}>Meet →</Link>}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
