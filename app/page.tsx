"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getFishId } from "@/lib/meet/identity";

/** The "island" for now: who you are + how to meet people. */
export default function Home() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    const id = getFishId();
    if (!id) return router.replace("/onboarding");
    fetch(`/api/users/${encodeURIComponent(id)}/public`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((u) => setName(u.displayName))
      .catch(() => router.replace("/onboarding"));
  }, [router]);

  if (!name) return <main className="meet-shell"><p className="muted">Swimming to the island…</p></main>;
  return (
    <main className="meet-shell">
      <h1>Welcome back, {name} 🐟</h1>
      <p>Tap a friend&apos;s NFC tag with your phone to meet them at the market.</p>
      <p>
        <Link href="/me">View my profile</Link> · <Link href="/onboarding">Redo onboarding</Link>
      </p>
    </main>
  );
}
