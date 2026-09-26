"use client";

import Image, { getImageProps } from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CutscenePlayer, FishSprite } from "@/app/_components/Cutscene";
import { LEVELS } from "@/lib/meet/config";
import { getFishId } from "@/lib/meet/identity";
import type { AttemptKind } from "@/lib/meet/schema";
import { WORLD, WORLD_BG, WORLD_COLORS } from "@/lib/world/config";
import type { HistoryItem, ReplayResponse, Resident, WorldResponse } from "@/lib/world/types";
import { useWorldSim } from "@/lib/world/useWorldSim";

// Optimized (resized) URL for the side copies; CSS backgrounds can't use <Image>.
const STRIP_SRC = getImageProps({ src: WORLD_BG.src, width: 1080, height: 1080, alt: "" }).props.src;

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; world: WorldResponse };

/** Home screen: my fish + every fish I've met, wandering the seaside market. */
export default function World() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    const id = getFishId();
    const toOnboarding = () => router.replace("/onboarding?returnTo=/world");
    if (!id) return toOnboarding();
    fetch(`/api/world?userId=${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) return toOnboarding(); // stale id in localStorage
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Couldn't load the island (${res.status})`);
        setLoad({ kind: "ready", world: json as WorldResponse });
      })
      .catch((err: Error) => setLoad({ kind: "error", message: err.message }));
  }, [router]);

  if (load.kind === "loading") return <main className="meet-shell"><p className="muted">Swimming to the island…</p></main>;
  if (load.kind === "error")
    return (
      <main className="meet-shell">
        <p className="error">{load.message}</p>
        <button onClick={() => window.location.reload()}>Try again</button>
      </main>
    );
  return <Island world={load.world} />;
}

function Island({ world }: { world: WorldResponse }) {
  const { me, residents } = world;
  const ids = useMemo(() => [me.id, ...residents.map((r) => r.id)], [me.id, residents]);
  const { worldRef, register, swimTo } = useWorldSim(ids, world.bumpLines, me.id);
  const [card, setCard] = useState<Resident | "me" | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);

  // Esc closes the topmost layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (replayId) setReplayId(null);
      else setCard(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [replayId]);

  const byId = new Map(residents.map((r) => [r.id, r]));
  return (
    <div className="world-page" style={{ "--sky": WORLD_COLORS.sky, "--sea": WORLD_COLORS.sea } as React.CSSProperties}>
      {/* Blurred copy fills the letterbox around the fitted (square) world. */}
      <Image className="world-backdrop" src={WORLD_BG.src} alt="" fill sizes="200px" />
      <header className="world-header">
        <span className="world-title">🏝️ {me.displayName}&apos;s island</span>
        <Link href="/me">My profile</Link>
      </header>

      <div className="world-row">
        {/* Copies of the market to either side, aligned with the island, so wide screens look endless. */}
        <div className="world-strip" style={{ backgroundImage: `url(${STRIP_SRC})` }} aria-hidden />
        <div className="world" ref={worldRef}>
          <Image className="world-bg" src={WORLD_BG.src} alt="The seaside market" fill sizes="(max-width: 900px) 100vw, 900px" priority />
          {ids.map((id) => {
            const r = byId.get(id);
            const isMe = id === me.id;
            return (
              <button
                key={id}
                ref={register(id)}
                type="button"
                className={`wfish${isMe ? " me" : ""}${r?.status === "strangers" ? " stranger" : ""}`}
                style={{ width: `${WORLD.FISH_WIDTH * 100}%` }}
                onClick={() => setCard(r ?? "me")}
                aria-label={isMe ? `You (${me.displayName})` : r?.displayName}
              >
                <span className="wfish-bubble" hidden />
                <span className="wfish-name">{isMe ? "You" : r?.displayName}</span>
                <span className="wfish-body">
                  <FishSprite facing="left" sizes="(max-width: 600px) 80px, 130px" />
                </span>
              </button>
            );
          })}
          {residents.length === 0 && (
            <div className="world-empty">No fish here yet — tap a friend&apos;s NFC tag to meet them! 🌊</div>
          )}
        </div>
      </div>

      <p className="world-hint">Tap a fish to see your story together</p>

      {card === "me" && (
        <Sheet onClose={() => setCard(null)}>
          <h2>{me.displayName} 🐟</h2>
          <p>
            <em>“{me.catchphrase}”</em>
          </p>
          <Link href="/me">View my profile →</Link>
        </Sheet>
      )}
      {card && card !== "me" && (
        <FishCard
          resident={card}
          meId={me.id}
          onClose={() => setCard(null)}
          onSwim={() => {
            setCard(null);
            swimTo(card.id);
          }}
          onReplay={setReplayId}
        />
      )}
      {replayId && <ReplayModal attemptId={replayId} meId={me.id} onClose={() => setReplayId(null)} />}
    </div>
  );
}

// ── popup card ──────────────────────────────────────────────────────────────

function Sheet({ onClose, children, className = "" }: { onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<AttemptKind, string> = {
  first_meet: "✨ First meet",
  hangout: "🎮 Hangout",
  clammed_up: "🐚 Clammed up",
  already_friends: "👋 Waved hi",
  cooldown: "🌊 Just hung out",
};

function historyLabel(h: HistoryItem): string {
  const base = KIND_LABEL[h.kind];
  return h.kind === "hangout" && h.leveledUp && h.levelNameAfter ? `${base} · Level up to ${h.levelNameAfter}` : base;
}

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;
export function relativeDate(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) if (Math.abs(diff) >= secs) return rtf?.format(Math.round(diff / secs), unit) ?? iso;
  return "just now";
}

function levelShells(level: number): string {
  return "🐚".repeat(level) + "⚪".repeat(Math.max(0, LEVELS.length - level));
}

function FishCard({
  resident: r,
  meId,
  onClose,
  onSwim,
  onReplay,
}: {
  resident: Resident;
  meId: string;
  onClose: () => void;
  onSwim: () => void;
  onReplay: (attemptId: string) => void;
}) {
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/pairs/${encodeURIComponent(r.pairKey)}/history?userId=${encodeURIComponent(meId)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Couldn't load history (${res.status})`);
        setHistory(json.history);
      })
      .catch((err: Error) => setError(err.message));
  }, [r.pairKey, meId]);

  const friends = r.status === "friends";
  return (
    <Sheet onClose={onClose} className="fish-card">
      <div className="fish-card-head">
        <div className={`fish-card-sprite${friends ? "" : " stranger"}`}>
          <FishSprite facing="left" sizes="72px" />
        </div>
        <div>
          <h2>{r.displayName}</h2>
          {friends ? (
            <>
              <div className="level" aria-label={`Level ${r.level} of ${LEVELS.length}`}>
                <span>{levelShells(r.level)}</span> <strong>{r.levelName}</strong>
              </div>
              <div className="muted">
                {r.friendsSince && `Friends since ${new Date(r.friendsSince).toLocaleDateString()}`}
                {r.hangoutCount > 0 && ` · ${r.hangoutCount} hangout${r.hangoutCount === 1 ? "" : "s"}`}
              </div>
            </>
          ) : (
            <div className="muted">Just met</div>
          )}
        </div>
      </div>

      {!friends && <p className="hint">Tap their tag next time you see them to try again 🌊</p>}

      <button type="button" className="swim-btn" onClick={onSwim}>
        Swim over 🐟
      </button>

      <h3>Your story</h3>
      {error && <p className="error">{error}</p>}
      {!history && !error && <p className="muted">Loading…</p>}
      {history?.length === 0 && <p className="muted">Nothing here yet.</p>}
      <ul className="history">
        {history?.map((h) => (
          <li key={h.attemptId}>
            <button type="button" disabled={!h.hasScript} onClick={() => onReplay(h.attemptId)}>
              <span>{historyLabel(h)}</span>
              <span className="muted">{h.hasScript ? relativeDate(h.createdAt) : "replay unavailable"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ── replay (read-only: never calls /api/meet) ───────────────────────────────

function ReplayModal({ attemptId, meId, onClose }: { attemptId: string; meId: string; onClose: () => void }) {
  const [replay, setReplay] = useState<ReplayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/attempts/${encodeURIComponent(attemptId)}?userId=${encodeURIComponent(meId)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Couldn't load that cutscene (${res.status})`);
        setReplay(json as ReplayResponse);
      })
      .catch((err: Error) => setError(err.message));
  }, [attemptId, meId]);

  return (
    <div className="replay-backdrop" role="dialog" aria-modal="true">
      <div className="meet replay">
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Close replay">
          ✕
        </button>
        {error && <p className="error">{error}</p>}
        {!replay && !error && <p className="muted">Rewinding the tide…</p>}
        {replay && (
          <CutscenePlayer
            script={replay.script}
            names={replay.names}
            renderEnd={(again) => (
              <div className="dialogue end">
                <span className="text">{KIND_LABEL[replay.kind]}</span>
                <span className="muted">{new Date(replay.createdAt).toLocaleString()}</span>
                <div className="meet-actions">
                  <button onClick={again}>Replay</button>
                  <button className="secondary" onClick={onClose}>
                    Close
                  </button>
                </div>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
