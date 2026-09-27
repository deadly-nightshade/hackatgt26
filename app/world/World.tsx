"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { CutscenePlayer } from "@/app/_components/Cutscene";
import { FishArtPreloader, FishSprite } from "@/app/_components/FishSprite";
import { LEVELS } from "@/lib/meet/config";
import { getFishId } from "@/lib/meet/identity";
import type { AttemptKind } from "@/lib/meet/schema";
import { FRAMING, WORLD, WORLD_COLORS } from "@/lib/world/config";
import { SCENE_BASE, SPRITES } from "@/lib/world/scene";
import type { HistoryItem, ReplayResponse, Resident, WorldResponse } from "@/lib/world/types";
import { useWorldSim } from "@/lib/world/useWorldSim";
import { DebugOverlay, DebugPanel } from "./Debug";
import { SceneSprite } from "./SceneSprite";

/** Every world fish sprite uses this hint, so the preloader fetches the same image candidates. */
const WORLD_FISH_SIZES = "(max-width: 600px) 80px, 130px";

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
  // ?debug=1 draws the walk/activity geometry + a control panel; ?demo=1 (or NEXT_PUBLIC_WORLD_DEMO=1) speeds everything up.
  const [flags] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return { debug: q.get("debug") === "1", demo: q.get("demo") === "1" || process.env.NEXT_PUBLIC_WORLD_DEMO === "1" };
  });
  const sim = useWorldSim(ids, world.bumpLines, me.id, flags);
  const { worldRef, register, registerTag, registerItem, registerTarget, swimTo } = sim;
  const [card, setCard] = useState<Resident | "me" | null>(null);
  // The dashed walk/zone overlay: on for plain ?debug=1, off when recording a demo.
  const [geometry, setGeometry] = useState(!flags.demo);
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
  const vars = { "--sky": WORLD_COLORS.sky, "--sea": WORLD_COLORS.sea, "--sky-share": FRAMING.SKY_SHARE, "--strip": `url(${SCENE_BASE.strip})` } as CSSProperties;
  return (
    <div className="world-page" style={vars}>
      <header className="world-header">
        <span className="world-title">🏝️ {me.displayName}&apos;s island</span>
        <Link className="world-profile-btn" href="/me" aria-label="My profile">
          🐟 Me
        </Link>
      </header>
      <FishArtPreloader sizes={WORLD_FISH_SIZES} />

      {/* Sky block above, ocean block below; the scene fits the width (height on landscape). */}
      <div className="world-sky" />
      <div className="world-row">
        {/* Copies of the base beside the scene on wide screens (dock planks tile; the strip's ocean is pre-flipped to meet the edges). */}
        <div className="world-strip left" aria-hidden />
        <div className="world-strip right" aria-hidden />
        <div className="world" ref={worldRef}>
          <Image className="world-bg" src={SCENE_BASE.src} alt="The seaside market" fill sizes="(max-aspect-ratio: 1/1) 100vw, 100vh" priority />
          {SPRITES.map((s) => (
            <SceneSprite key={s.id} sprite={s} ref={s.item || s.hops ? registerItem(s.id) : undefined} />
          ))}
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
                <span className="wfish-body">
                  <FishSprite appearance={isMe ? me.appearance : r?.appearance} sizes={WORLD_FISH_SIZES} />
                </span>
              </button>
            );
          })}
          {ids.map((id) => (
            <div key={id} ref={registerTag(id)} className={`wtag${id === me.id ? " me" : ""}`} aria-hidden>
              <span className="wfish-bubble" hidden />
              <span className="wfish-name">{id === me.id ? "You" : byId.get(id)?.displayName}</span>
            </div>
          ))}
          {flags.debug && geometry && <DebugOverlay ids={ids} registerTarget={registerTarget} />}
          {residents.length === 0 && (
            <div className="world-empty">No fish here yet — tap a friend&apos;s NFC tag to meet them! 🌊</div>
          )}
        </div>
      </div>
      <div className="world-sea" />

      <p className="world-hint">Tap a fish to see your story together</p>
      {flags.debug && <DebugPanel sim={sim} geometry={geometry} onGeometry={setGeometry} />}

      {card === "me" && (
        <Sheet onClose={() => setCard(null)} className="fish-card">
          <div className="fish-card-head">
            <div className="fish-card-sprite">
              <FishSprite appearance={me.appearance} sizes="72px" />
            </div>
            <div>
              <h2>{me.displayName}</h2>
              <p className="muted">
                <em>“{me.catchphrase}”</em>
              </p>
            </div>
          </div>
          <Link className="button swim-btn" href="/me">
            Edit my fish ✨
          </Link>
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
          <FishSprite appearance={r.appearance} sizes="72px" />
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
            appearances={replay.appearances}
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
