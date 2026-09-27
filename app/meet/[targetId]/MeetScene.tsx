"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CutscenePlayer, CutsceneStage, type CutsceneAppearances } from "@/app/_components/Cutscene";
import { FishArtPreloader } from "@/app/_components/FishSprite";
import { LoadingDots } from "@/app/_components/LoadingDots";
import type { Appearance } from "@/lib/fish/appearance";
import { getFishId } from "@/lib/meet/identity";
import type { MeetResponse } from "@/lib/meet/schema";

type Phase =
  | { kind: "resolving" }
  | { kind: "self" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "meeting" } // fish on screen, waiting for POST /api/meet
  | { kind: "playing"; meet: MeetResponse };

type Names = { a: string; b: string };

type PublicFish = { displayName: string; appearance: Appearance };

async function fetchFish(id: string): Promise<PublicFish | null> {
  const res = await fetch(`/api/users/${encodeURIComponent(id)}/public`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't load fish (${res.status})`);
  return (await res.json()) as PublicFish;
}

const END_TEXT: Record<MeetResponse["outcome"], string> = {
  friends: "You made a new friend! 🐟",
  clammed_up: "They clammed up this time… Tap their tag again in a while to try again 🐚",
  already_friends: "Already reel friends! 🐟",
  hangout: "What a fin-tastic hangout! 🌊",
  cooldown: "You two just hung out. Sea you later! 🌊", // friends; strangers get STILL_SHY
};

export default function MeetScene({ targetId }: { targetId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "resolving" });
  const [names, setNames] = useState<Names | null>(null);
  const [looks, setLooks] = useState<CutsceneAppearances>({});
  // Strict Mode runs effects twice in dev; a second POST would log a second attempt.
  const started = useRef<string | null>(null);

  const meet = useCallback(
    async (initiatorId: string) => {
      setPhase({ kind: "meeting" });
      try {
        const regenerate = new URLSearchParams(window.location.search).get("regenerate") === "1" ? "?regenerate=1" : "";
        const res = await fetch(`/api/meet${regenerate}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initiatorId, targetId }),
          signal: AbortSignal.timeout(90_000),
        });
        const json = await res.json().catch(() => ({}));
        if (res.status === 404) return setPhase({ kind: "not_found" });
        if (!res.ok) throw new Error(json.error || `Something went wrong (${res.status})`);
        const result = json as MeetResponse;
        if (result.debug) console.log("[meet debug]", result.debug);
        setPhase({ kind: "playing", meet: result });
      } catch (err) {
        const e = err as Error;
        setPhase({ kind: "error", message: e.name === "TimeoutError" ? "The tide was too slow — try again?" : e.message });
      }
    },
    [targetId],
  );

  // 1. Resolve identity → 2. show both fish → start the meet.
  useEffect(() => {
    if (started.current === targetId) return;
    started.current = targetId;
    const fishId = getFishId();
    const toOnboarding = () => router.replace(`/onboarding?returnTo=${encodeURIComponent(`/meet/${targetId}`)}`);
    if (!fishId) return toOnboarding();
    if (fishId === targetId) return setPhase({ kind: "self" });
    (async () => {
      try {
        const [a, b] = await Promise.all([fetchFish(fishId), fetchFish(targetId)]);
        if (!b) return setPhase({ kind: "not_found" });
        if (!a) return toOnboarding(); // stale id in localStorage
        setNames({ a: a.displayName, b: b.displayName });
        setLooks({ a: a.appearance, b: b.appearance });
        await meet(fishId);
      } catch (err) {
        setPhase({ kind: "error", message: (err as Error).message });
      }
    })();
  }, [targetId, router, meet]);

  if (phase.kind === "resolving") return <Shell><p className="muted">Finding your fish…</p></Shell>;
  if (phase.kind === "self")
    return (
      <Shell>
        <h1>That&apos;s your own tag, silly fish! 🐟</h1>
        <p>Tap a friend&apos;s tag to meet them.</p>
        <Link href="/world">Back to island</Link>
      </Shell>
    );
  if (phase.kind === "not_found")
    return (
      <Shell>
        <h1>Hmm, no fish here 🫧</h1>
        <p>This tag doesn&apos;t belong to any resident (yet). Maybe they haven&apos;t finished onboarding?</p>
        <Link href="/world">Back to island</Link>
      </Shell>
    );

  const n = names ?? { a: "…", b: "…" };
  // The meet response carries both looks too (fresh at play time).
  const playingLooks = phase.kind === "playing" ? { a: phase.meet.fish.a.appearance, b: phase.meet.fish.b.appearance } : looks;

  return (
    <div className="meet">
      <FishArtPreloader sizes="(max-width: 520px) 40vw, 190px" />
      {phase.kind === "playing" ? (
        <CutscenePlayer
          key={phase.meet.attemptNumber}
          script={phase.meet.script}
          names={n}
          appearances={playingLooks}
          renderEnd={(replay) => <EndScreen meet={phase.meet} onReplay={replay} />}
        />
      ) : (
        <>
          <CutsceneStage names={n} appearances={looks} speaking={null} />
          <div className="dialogue" aria-live="polite">
            {phase.kind === "meeting" && (
              // Keeps "typing" until the AI's script arrives.
              <span className="text" aria-label={`${n.b} is swimming over…`}>
                {n.b} is swimming over
                <LoadingDots />
              </span>
            )}
            {phase.kind === "error" && <span className="text error">{phase.message}</span>}
          </div>
        </>
      )}
      {phase.kind === "error" && (
        <div className="meet-actions">
          <p className="muted">Tap their tag again to try again 🌊</p>
          <Link className="button secondary" href="/world">
            Back to island
          </Link>
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="meet-shell">{children}</main>;
}

/** Strangers re-tapping too soon after a clammed-up meet (the server didn't roll again). */
const STILL_SHY = "Still a bit shy… Tap their tag again in a while 🐚";

function EndScreen({ meet, onReplay }: { meet: MeetResponse; onReplay: () => void }) {
  const text = meet.outcome === "cooldown" && !meet.levelName ? STILL_SHY : END_TEXT[meet.outcome];
  return (
    <div className="dialogue end">
      <span className="text">{text}</span>
      {meet.levelName && (
        <span className="muted">
          {meet.leveledUp && <strong>Level up! </strong>}
          Level {meet.level}: {meet.levelName}
          {meet.hangoutCount > 0 && ` · ${meet.hangoutCount} hangout${meet.hangoutCount === 1 ? "" : "s"}`}
        </span>
      )}
      <div className="meet-actions">
        {/* No "try again": a new meet only happens by tapping their tag again (after a while). */}
        <button onClick={onReplay}>Replay</button>
        <Link className="button secondary" href="/world">
          Back to island
        </Link>
      </div>
    </div>
  );
}
