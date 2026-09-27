"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getFishId, setFishId } from "@/lib/meet/identity";

type User = { id: string; displayName: string; isSeed: boolean };

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
            · <Link href="/world">Go to my island →</Link>
          </>
        )}
      </p>
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
