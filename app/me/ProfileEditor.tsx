"use client";

import { useEffect, useMemo, useState } from "react";
import { FISH_ID_HEADER } from "@/lib/meet/identity";
import { ProfileEditSchema, toEdit, formatEditError, type ProfileEdit } from "@/lib/profile/edit";
import { ENERGY, GROUP_SIZE, INTEREST_CATEGORIES, PLANNING, type ProfileView } from "@/lib/profile/schema";

const pretty = (s: string) => s.replace(/_/g, " ");

/**
 * /me "Edit profile": every user-facing field as plain inputs. Save = PATCH (no AI).
 * Cancel discards. Reports dirtiness so the page can warn before leaving.
 */
export function ProfileEditor({
  fishId,
  profile,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  fishId: string;
  profile: ProfileView;
  onSaved: (p: ProfileView) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const initial = useMemo(() => toEdit(profile), [profile]);
  const [draft, setDraft] = useState<ProfileEdit>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = <K extends keyof ProfileEdit>(key: K, value: ProfileEdit[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    setError(null);
    const check = ProfileEditSchema.safeParse(draft);
    if (!check.success) return setError(formatEditError(check.error));
    setSaving(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(fishId)}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", [FISH_ID_HEADER]: fishId },
        body: JSON.stringify(check.data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      onDirtyChange(false);
      onSaved(json.profile as ProfileView);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-editor">
      <section className="card">
        <h2>Basics</h2>
        <label htmlFor="pe-name">Name</label>
        <input id="pe-name" value={draft.displayName} maxLength={60} onChange={(e) => set("displayName", e.target.value)} />
        <label htmlFor="pe-summary">About you</label>
        <textarea id="pe-summary" rows={3} value={draft.summary} maxLength={400} onChange={(e) => set("summary", e.target.value)} />
      </section>

      <section className="card">
        <h2>Interests</h2>
        {draft.interests.map((it, i) => (
          <div key={i} className="pe-row">
            <input
              aria-label={`Interest ${i + 1}`}
              value={it.name}
              maxLength={80}
              onChange={(e) => set("interests", draft.interests.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <select
              aria-label={`Category for interest ${i + 1}`}
              value={it.category}
              onChange={(e) =>
                set("interests", draft.interests.map((x, j) => (j === i ? { ...x, category: e.target.value as ProfileEdit["interests"][number]["category"] } : x)))
              }
            >
              {INTEREST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {pretty(c)}
                </option>
              ))}
            </select>
            <button type="button" className="danger" aria-label={`Delete interest ${it.name || i + 1}`} onClick={() => set("interests", draft.interests.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => set("interests", [...draft.interests, { name: "", category: "other" }])}>
          + Add interest
        </button>
      </section>

      <section className="card">
        <h2>Want to try</h2>
        {draft.wantsToTry.map((it, i) => (
          <div key={i} className="pe-row">
            <input
              aria-label={`Want to try ${i + 1}`}
              value={it.name}
              maxLength={80}
              onChange={(e) => set("wantsToTry", draft.wantsToTry.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
            <button type="button" className="danger" aria-label={`Delete ${it.name || i + 1}`} onClick={() => set("wantsToTry", draft.wantsToTry.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={() => set("wantsToTry", [...draft.wantsToTry, { name: "" }])}>
          + Add something to try
        </button>
      </section>

      <section className="card">
        <h2>Social style</h2>
        {(
          [
            ["energy", "Energy", ENERGY],
            ["groupSize", "Group size", GROUP_SIZE],
            ["planning", "Planning", PLANNING],
          ] as const
        ).map(([key, label, values]) => (
          <div key={key}>
            <label htmlFor={`pe-${key}`}>{label}</label>
            <select
              id={`pe-${key}`}
              value={draft.socialStyle[key] ?? ""}
              onChange={(e) => set("socialStyle", { ...draft.socialStyle, [key]: e.target.value || null })}
            >
              <option value="">Not set</option>
              {values.map((v) => (
                <option key={v} value={v}>
                  {pretty(v)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Vibe</h2>
        <label htmlFor="pe-vibe">Vibe name</label>
        <input id="pe-vibe" value={draft.vibeType.label} maxLength={60} onChange={(e) => set("vibeType", { ...draft.vibeType, label: e.target.value })} />
        <label htmlFor="pe-mbti">MBTI (just for fun)</label>
        <input
          id="pe-mbti"
          value={draft.vibeType.mbti}
          maxLength={4}
          autoCapitalize="characters"
          onChange={(e) => set("vibeType", { ...draft.vibeType, mbti: e.target.value.toUpperCase() })}
        />
      </section>

      <section className="card">
        <h2>Your market stall</h2>
        <label htmlFor="pe-stall">Stall</label>
        <input id="pe-stall" value={draft.residentFlavor.marketStall} maxLength={140} onChange={(e) => set("residentFlavor", { ...draft.residentFlavor, marketStall: e.target.value })} />
        <label htmlFor="pe-catch">Catchphrase</label>
        <input id="pe-catch" value={draft.residentFlavor.catchphrase} maxLength={140} onChange={(e) => set("residentFlavor", { ...draft.residentFlavor, catchphrase: e.target.value })} />
      </section>

      <section className="card">
        <h2>Conversation starters</h2>
        {draft.conversationStarters.map((s, i) => (
          <div key={i} className="pe-row">
            <input
              aria-label={`Starter ${i + 1}`}
              value={s}
              maxLength={200}
              onChange={(e) => set("conversationStarters", draft.conversationStarters.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className="danger"
              aria-label={`Delete starter ${i + 1}`}
              disabled={draft.conversationStarters.length <= 2}
              onClick={() => set("conversationStarters", draft.conversationStarters.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
        {draft.conversationStarters.length < 4 && (
          <button type="button" className="secondary" onClick={() => set("conversationStarters", [...draft.conversationStarters, ""])}>
            + Add starter
          </button>
        )}
        <p className="muted">Keep 2–4 starters.</p>
      </section>

      <div className="pe-bar">
        {error && <p className="error pe-error">{error}</p>}
        <div className="row">
          <button type="button" className="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
