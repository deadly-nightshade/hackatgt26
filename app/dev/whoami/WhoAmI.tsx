"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getFishId, setFishId } from "@/lib/meet/identity";

type User = { id: string; displayName: string; isSeed: boolean };

export default function WhoAmI({ users }: { users: User[] }) {
  const [me, setMe] = useState<string | null>(null);
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
