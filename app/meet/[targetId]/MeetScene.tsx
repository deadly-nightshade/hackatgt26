"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getFishId } from "@/lib/meet/identity";
import type { DialogueLine, MeetResponse } from "@/lib/meet/schema";

type Phase =
  | { kind: "resolving" }
  | { kind: "self" }
  | { kind: "not_found" }
  | { kind: "error"; message: string }
  | { kind: "meeting" } // fish on screen, waiting for POST /api/meet
  | { kind: "playing"; meet: MeetResponse; index: number }
  | { kind: "ended"; meet: MeetResponse };

type Names = { a: string; b: string };

async function fetchName(id: string): Promise<string | null> {
  const res = await fetch(`/api/users/${encodeURIComponent(id)}/public`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't load fish (${res.status})`);
  return (await res.json()).displayName as string;
}

const END_TEXT: Record<MeetResponse["outcome"], string> = {
  friends: "You made a new friend! 🐟",
  clammed_up: "They clammed up this time… 🐚",
  already_friends: "Already reel friends! 🐟",
  hangout: "What a fin-tastic hangout! 🌊",
  cooldown: "You two just hung out. Sea you later! 🌊",
};

export default function MeetScene({ targetId }: { targetId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "resolving" });
  const [me, setMe] = useState<string | null>(null);
  const [names, setNames] = useState<Names | null>(null);
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
        setPhase({ kind: "playing", meet: result, index: 0 });
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
    setMe(fishId);
    (async () => {
      try {
        const [a, b] = await Promise.all([fetchName(fishId), fetchName(targetId)]);
        if (!b) return setPhase({ kind: "not_found" });
        if (!a) return toOnboarding(); // stale id in localStorage
        setNames({ a, b });
        await meet(fishId);
      } catch (err) {
        setPhase({ kind: "error", message: (err as Error).message });
      }
    })();
  }, [targetId, router, meet]);

  const advance = useCallback(() => {
    setPhase((p) => {
      if (p.kind !== "playing") return p;
      return p.index + 1 < p.meet.script.length ? { ...p, index: p.index + 1 } : { kind: "ended", meet: p.meet };
    });
  }, []);

  useEffect(() => {
    if (phase.kind !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.kind, advance]);

  if (phase.kind === "resolving") return <Shell><p className="muted">Finding your fish…</p></Shell>;
  if (phase.kind === "self")
    return (
      <Shell>
        <h1>That&apos;s your own tag, silly fish! 🐟</h1>
        <p>Tap a friend&apos;s tag to meet them.</p>
        <Link href="/">Back to island</Link>
      </Shell>
    );
  if (phase.kind === "not_found")
    return (
      <Shell>
        <h1>Hmm, no fish here 🫧</h1>
        <p>This tag doesn&apos;t belong to any resident (yet). Maybe they haven&apos;t finished onboarding?</p>
        <Link href="/">Back to island</Link>
      </Shell>
    );

  const line: DialogueLine | null = phase.kind === "playing" ? phase.meet.script[phase.index] : null;
  const speaking = line?.speaker ?? null;
  const n = names ?? { a: "…", b: "…" };

  return (
    <div className="meet">
      <div className="stage">
        <Fish name={n.a} side="left" active={speaking === "a"} />
        <Fish name={n.b} side="right" active={speaking === "b"} />
      </div>

      {phase.kind === "ended" ? (
        <EndScreen
          meet={phase.meet}
          onReplay={() => setPhase({ kind: "playing", meet: phase.meet, index: 0 })}
          onRetry={() => me && meet(me)}
        />
      ) : (
        <button
          type="button"
          className="dialogue"
          onClick={advance}
          disabled={phase.kind !== "playing"}
          aria-live="polite"
        >
          {phase.kind === "meeting" && <span className="text">{n.b} is swimming over…</span>}
          {phase.kind === "error" && <span className="text error">{phase.message}</span>}
          {line && (
            <>
              {line.speaker !== "narrator" && <span className="speaker">{line.speaker === "a" ? n.a : n.b}</span>}
              <span className={line.speaker === "narrator" ? "text narrator" : "text"}>{line.text}</span>
              <span className="next" aria-hidden>
                ▼
              </span>
            </>
          )}
        </button>
      )}
      {phase.kind === "error" && me && (
        <div className="meet-actions">
          <button onClick={() => meet(me)}>Try again</button>
        </div>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="meet-shell">{children}</main>;
}

function Fish({ name, side, active }: { name: string; side: "left" | "right"; active: boolean }) {
  return (
    <div className={`fish ${side}${active ? " active" : ""}`}>
      <div className="fish-name">{name}</div>
      <div className="fish-body">
        <span className="eye" />
      </div>
    </div>
  );
}

function EndScreen({ meet, onReplay, onRetry }: { meet: MeetResponse; onReplay: () => void; onRetry: () => void }) {
  return (
    <div className="dialogue end">
      <span className="text">{END_TEXT[meet.outcome]}</span>
      {meet.levelName && (
        <span className="muted">
          {meet.leveledUp && <strong>Level up! </strong>}
          Level {meet.level}: {meet.levelName}
          {meet.hangoutCount > 0 && ` · ${meet.hangoutCount} hangout${meet.hangoutCount === 1 ? "" : "s"}`}
        </span>
      )}
      <div className="meet-actions">
        {meet.outcome === "clammed_up" ? (
          <button onClick={onRetry}>Try again</button>
        ) : (
          <button onClick={onReplay}>Replay</button>
        )}
        <Link className="button secondary" href="/">
          Back to island
        </Link>
      </div>
    </div>
  );
}
