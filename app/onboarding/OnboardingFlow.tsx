"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { setFishId } from "@/lib/meet/identity";
import type { OnboardingQuestion } from "@/lib/onboarding/questions";
import type { Answer, Profile } from "@/lib/profile/schema";
import AnswerInput from "./AnswerInput";
import ReviewProfile from "./ReviewProfile";

type Step = "name" | "questions" | "building" | "review" | "saved";

type AnswerState = {
  main: string;
  checked: boolean; // answer-quality check already ran (max 1 follow-up per question)
  followUp?: string;
  followUpAnswer: string;
};

const emptyAnswer = (): AnswerState => ({ main: "", checked: false, followUpAnswer: "" });

/** Follow-up answers are appended to that question's transcript. */
function finalTranscript(a: AnswerState): string {
  const main = a.main.trim();
  const extra = a.followUpAnswer.trim();
  if (!a.followUp || !extra) return main;
  return `${main}\n\n(Follow-up: ${a.followUp})\n${extra}`;
}

function useAudioPlayer() {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [available, setAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  const play = (src: string | null) => {
    ref.current?.pause();
    if (!src) return setAvailable(false);
    const audio = new Audio(src);
    ref.current = audio;
    audio.onerror = () => setAvailable(false);
    audio.oncanplay = () => setAvailable(true);
    audio.onplay = () => setPlaying(true);
    audio.onpause = audio.onended = () => setPlaying(false);
    audio.play().catch(() => {}); // autoplay may be blocked; the replay button still works
  };
  const replay = () => {
    if (!ref.current) return;
    ref.current.currentTime = 0;
    ref.current.play().catch(() => {});
  };
  const stop = () => ref.current?.pause();
  useEffect(() => () => ref.current?.pause(), []);
  return { play, replay, stop, available, playing };
}

export default function OnboardingFlow({ questions, returnTo }: { questions: OnboardingQuestion[]; returnTo: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("name");
  const [displayName, setDisplayName] = useState("");
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const questionAudio = useAudioPlayer();
  const followUpAudio = useAudioPlayer();

  const q = questions[qIndex];
  const a = (q && answers[q.id]) || emptyAnswer();
  const update = (patch: Partial<AnswerState>) =>
    setAnswers((prev) => ({ ...prev, [q.id]: { ...(prev[q.id] ?? emptyAnswer()), ...patch } }));

  // Auto-play the pre-generated question audio (static file, no TTS call).
  useEffect(() => {
    if (step !== "questions" || !q) return;
    followUpAudio.stop();
    questionAudio.play(q.audioSrc ?? null);
  }, [step, qIndex]);

  const rawAnswers = (): Answer[] =>
    questions.map((qq) => ({ questionId: qq.id, transcript: finalTranscript(answers[qq.id] ?? emptyAnswer()) }));

  function stopVoices() {
    questionAudio.stop();
    followUpAudio.stop();
  }

  function advance() {
    questionAudio.stop();
    followUpAudio.stop();
    if (qIndex < questions.length - 1) setQIndex(qIndex + 1);
    else buildProfile();
  }

  async function playFollowUp(text: string) {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status !== 200) return; // TTS unavailable → text only
      followUpAudio.play(URL.createObjectURL(await res.blob()));
    } catch {
      // text is always shown
    }
  }

  async function onNext() {
    if (a.checked) return advance();
    setChecking(true);
    let followUp: string | undefined;
    try {
      const res = await fetch("/api/onboarding/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: q.id, transcript: a.main }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) followUp = (await res.json()).followUp;
    } catch {
      // never block progress on the quality check
    } finally {
      setChecking(false);
    }
    update({ checked: true, followUp });
    if (followUp) {
      questionAudio.stop();
      playFollowUp(followUp);
    } else advance();
  }

  async function buildProfile() {
    setStep("building");
    setError(null);
    try {
      const res = await fetch("/api/onboarding/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim(), answers: rawAnswers() }),
        signal: AbortSignal.timeout(75_000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Something went wrong (${res.status})`);
      setProfile(json.profile);
      setStep("review");
    } catch (err) {
      const e = err as Error;
      setError(e.name === "TimeoutError" ? "That took too long — please try again." : e.message);
    }
  }

  async function confirm(edited: Profile) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: edited, rawAnswers: rawAnswers() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Save failed (${res.status})`);
      setSavedId(json.id);
      setFishId(json.id);
      setStep("saved");
      if (returnTo) router.replace(returnTo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (step === "name") {
    return (
      <main>
        <h1>Welcome to the seaside market 🌊</h1>
        <p>Answer a few quick questions out loud (or type) and we&apos;ll turn you into an island resident.</p>
        <label htmlFor="name">What should your friends call you?</label>
        <input id="name" value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
        <div className="row">
          <button disabled={!displayName.trim()} onClick={() => setStep("questions")}>
            Start
          </button>
        </div>
      </main>
    );
  }

  if (step === "questions" && q) {
    return (
      <main>
        <p className="muted">
          Question {qIndex + 1} of {questions.length}
        </p>
        <div className="card">
          <p className="prompt">{q.prompt}</p>
          {questionAudio.available &&
            (questionAudio.playing ? (
              <button className="secondary" onClick={questionAudio.stop}>
                ■ Stop voice
              </button>
            ) : (
              <button className="secondary" onClick={questionAudio.replay}>
                ▶ Replay question
              </button>
            ))}
        </div>

        <AnswerInput key={q.id} questionId={q.id} value={a.main} onChange={(main) => update({ main })} onBusyChange={setBusy} onRecordStart={stopVoices} />

        {a.followUp && (
          <div className="followup">
            <p>
              <strong>{a.followUp}</strong>
            </p>
            {followUpAudio.available &&
              (followUpAudio.playing ? (
                <button className="secondary" onClick={followUpAudio.stop}>
                  ■ Stop voice
                </button>
              ) : (
                <button className="secondary" onClick={followUpAudio.replay}>
                  ▶ Replay
                </button>
              ))}
            <AnswerInput
              key={`${q.id}-followup`}
              questionId={q.id}
              value={a.followUpAnswer}
              onChange={(followUpAnswer) => update({ followUpAnswer })}
              onBusyChange={setBusy}
              onRecordStart={stopVoices}
            />
          </div>
        )}

        <div className="row">
          {qIndex > 0 && (
            <button className="secondary" onClick={() => setQIndex(qIndex - 1)} disabled={busy || checking}>
              Back
            </button>
          )}
          {a.followUp && (
            <button
              className="secondary"
              onClick={() => {
                update({ followUpAnswer: "" });
                advance();
              }}
              disabled={busy}
            >
              Skip
            </button>
          )}
          <button onClick={onNext} disabled={busy || checking || !a.main.trim()}>
            {checking ? "…" : qIndex === questions.length - 1 ? "Build my resident" : "Next"}
          </button>
        </div>
      </main>
    );
  }

  if (step === "building") {
    return (
      <main>
        <h1>Building your resident…</h1>
        {!error ? (
          <p className="muted">Reading your answers and setting up your market stall. This takes a few seconds.</p>
        ) : (
          <>
            <p className="error">{error}</p>
            <div className="row">
              <button onClick={buildProfile}>Try again</button>
              <button className="secondary" onClick={() => setStep("questions")}>
                Edit answers
              </button>
            </div>
          </>
        )}
      </main>
    );
  }

  if (step === "review" && profile) {
    return (
      <main>
        <h1>Is this you, {profile.displayName}?</h1>
        <p className="muted">Remove anything that doesn&apos;t feel right. Nothing is saved until you confirm.</p>
        <ReviewProfile profile={profile} onConfirm={confirm} saving={saving} />
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <main>
      <h1>Welcome to the island, {profile?.displayName} 🏝️</h1>
      <p>Your resident profile is saved.{returnTo ? " Taking you back…" : ""}</p>
      <p className="muted">
        Profile id: <code>{savedId}</code>
      </p>
    </main>
  );
}
