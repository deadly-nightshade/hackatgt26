"use client";

import { useState } from "react";
import type { Profile } from "@/lib/profile/schema";

const TRAIT_LABELS: Record<keyof Profile["traits"], string> = {
  openness: "Openness",
  conscientiousness: "Conscientiousness",
  extraversion: "Extraversion",
  agreeableness: "Agreeableness",
  emotionalStability: "Emotional stability",
};

const pretty = (s: string) => s.replace(/_/g, " ");

/** Consent step: user can delete interests / wantsToTry and edit the summary. */
export default function ReviewProfile({
  profile,
  onConfirm,
  saving,
}: {
  profile: Profile;
  onConfirm: (p: Profile) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Profile>(profile);
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <>
      <section className="card">
        <h2>About you</h2>
        <textarea value={draft.summary} onChange={(e) => set({ summary: e.target.value })} aria-label="Summary" />
      </section>

      <section className="card">
        <h2>Interests</h2>
        {draft.interests.length === 0 && <p className="muted">Nothing yet — we&apos;ll learn more over time.</p>}
        <ul className="items">
          {draft.interests.map((i) => (
            <li key={i.tag}>
              <div>
                <strong>{i.name}</strong>
                <span className="chip">{pretty(i.category)}</span>
                <div className="muted">“{i.evidence}”</div>
              </div>
              <button className="danger" onClick={() => set({ interests: draft.interests.filter((x) => x.tag !== i.tag) })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>

      {draft.wantsToTry.length > 0 && (
        <section className="card">
          <h2>Wants to try</h2>
          <ul className="items">
            {draft.wantsToTry.map((w) => (
              <li key={w.tag}>
                <div>
                  <strong>{w.name}</strong>
                  <div className="muted">“{w.evidence}”</div>
                </div>
                <button
                  className="danger"
                  onClick={() => set({ wantsToTry: draft.wantsToTry.filter((x) => x.tag !== w.tag) })}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Social style</h2>
        <p>
          {pretty(draft.socialStyle.energy)} · {pretty(draft.socialStyle.groupSize)} · {pretty(draft.socialStyle.planning)}
        </p>
      </section>

      <section className="card">
        <h2>Personality snapshot</h2>
        <ul className="items">
          {(Object.keys(TRAIT_LABELS) as (keyof Profile["traits"])[]).map((k) => (
            <li key={k}>
              <span>{TRAIT_LABELS[k]}</span>
              <span className="muted">
                {"●".repeat(Math.round(draft.traits[k].score))}
                {"○".repeat(5 - Math.round(draft.traits[k].score))}
                {draft.traits[k].confidence < 0.4 && " (unsure)"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>
          Vibe: {draft.vibeType.label} <span className="chip">{draft.vibeType.mbti}</span>
        </h2>
        <p className="muted">{draft.vibeType.disclaimer} ✨</p>
      </section>

      <section className="card">
        <h2>Your market stall</h2>
        <p>{draft.residentFlavor.marketStall}</p>
        <p>
          <em>“{draft.residentFlavor.catchphrase}”</em>
        </p>
      </section>

      <section className="card">
        <h2>Friends might ask you…</h2>
        <ul>
          {draft.conversationStarters.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <div className="row">
        <button onClick={() => onConfirm(draft)} disabled={saving || !draft.summary.trim()}>
          {saving ? "Saving…" : "Looks like me → Confirm"}
        </button>
      </div>
    </>
  );
}
