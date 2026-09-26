"use client";

import { useRef, useState } from "react";
import { useLiveTranscription } from "./useLiveTranscription";
import { SILENCE_PEAK, useRecorder } from "./useRecorder";

type Props = {
  questionId: string;
  value: string;
  onChange: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
  /** Called right before the mic opens (e.g. to stop question audio playing). */
  onRecordStart?: () => void;
};

const append = (base: string, more: string) => (base.trim() && more ? `${base.trim()} ${more}` : base.trim() || more);

function extFor(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

/**
 * Live transcription (ElevenLabs realtime) → editable transcript. Falls back to
 * record → upload (batch STT) if live is unavailable, and to typing at every step.
 */
export default function AnswerInput({ questionId, value, onChange, onBusyChange, onRecordStart }: Props) {
  const { recording, error: micError, level, deviceLabel, start, stop } = useRecorder();
  const [typing, setTyping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const live = useLiveTranscription();
  const lastBlob = useRef<Blob | null>(null); // kept for "retry" after a failed upload
  const textRef = useRef<HTMLTextAreaElement>(null);

  const setBusy = (b: boolean) => {
    setUploading(b);
    onBusyChange?.(b);
  };

  async function upload(blob: Blob) {
    setUploadError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("audio", blob, `answer.${extFor(blob.type)}`);
      form.append("questionId", questionId);
      const res = await fetch("/api/transcribe", { method: "POST", body: form, signal: AbortSignal.timeout(70_000) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
      const text = String(json.transcript ?? "").trim();
      if (!text) throw new Error("We couldn't hear anything — try again or type it.");
      // Re-recording appends, so earlier parts of an answer aren't lost.
      onChange(append(value, text));
      lastBlob.current = null;
    } catch (err) {
      const e = err as Error;
      setUploadError(e.name === "TimeoutError" ? "Transcription timed out." : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    setUploadError(null);
    if (live.active) {
      setFinishing(true);
      onBusyChange?.(true);
      const text = await live.stop();
      setFinishing(false);
      onBusyChange?.(false);
      if (text) onChange(append(value, text));
      else setUploadError("We didn't catch anything — check your mic isn't muted, or type instead.");
      return;
    }
    if (recording) {
      const { blob, peak } = await stop();
      if (blob.size === 0) return setUploadError("Recording was empty — try again.");
      if (peak < SILENCE_PEAK) {
        // Don't spend an API call on silence — it's a mic/device problem.
        return setUploadError(
          `Your mic sent only silence${deviceLabel ? ` (${deviceLabel})` : ""}. Check it isn't muted (mute key / Windows input volume), or type instead.`,
        );
      }
      lastBlob.current = blob;
      await upload(blob);
    } else {
      setNotice(null);
      onRecordStart?.();
      setStarting(true);
      const result = await live.start();
      setStarting(false);
      if (result === "live") return;
      if (result === "failed") setNotice("Live captions aren't available right now — we'll transcribe when you stop.");
      const ok = await start();
      if (!ok) switchToTyping();
    }
  }

  function switchToTyping() {
    setTyping(true);
    setTimeout(() => textRef.current?.focus(), 0);
  }

  const isRecording = recording || live.active;
  const showTextarea = typing || value.length > 0 || !!uploadError || !!micError;

  return (
    <div>
      {!typing && (
        <div className="row">
          <button onClick={toggleRecording} disabled={uploading || starting || finishing}>
            {starting ? (
              "Starting…"
            ) : finishing ? (
              "Finishing…"
            ) : isRecording ? (
              <>
                <span className="rec" />
                Stop
              </>
            ) : value ? (
              "Record more"
            ) : (
              "Record answer"
            )}
          </button>
          <button className="secondary" onClick={switchToTyping} disabled={isRecording || uploading || starting}>
            Type instead
          </button>
          {uploading && <span className="muted">Transcribing…</span>}
        </div>
      )}
      {live.active && (
        <div className="live" aria-live="polite">
          {append(value, live.liveText) || <span className="muted">Listening… start talking</span>}
        </div>
      )}
      {live.reconnecting && <p className="muted">Connection blipped — reconnecting, keep talking…</p>}
      {live.error && <p className="error">{live.error}</p>}
      {notice && <p className="muted">{notice}</p>}
      {recording && (
        <div className="meter-wrap">
          <div className="meter" aria-label="Mic level">
            <div className="meter-fill" style={{ width: `${Math.min(100, Math.sqrt(level) * 100)}%` }} />
          </div>
          <span className="muted">{deviceLabel || "Microphone"}</span>
        </div>
      )}

      {micError === "denied" && <p className="error">Mic access was blocked — no worries, just type your answer.</p>}
      {micError === "unsupported" && <p className="error">Recording isn&apos;t supported in this browser — type instead.</p>}
      {micError === "failed" && <p className="error">Couldn&apos;t start the mic — type your answer instead.</p>}
      {uploadError && (
        <div className="row">
          <span className="error">{uploadError}</span>
          {lastBlob.current && (
            <button className="secondary" onClick={() => lastBlob.current && upload(lastBlob.current)} disabled={uploading}>
              Retry
            </button>
          )}
        </div>
      )}

      {showTextarea && !live.active && (
        <>
          <textarea
            ref={textRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your answer…"
            aria-label="Your answer"
          />
          {!typing && value && <p className="muted">Fix anything we misheard.</p>}
        </>
      )}
      {typing && (
        <button className="secondary" onClick={() => setTyping(false)} style={{ marginTop: 8 }}>
          Use mic instead
        </button>
      )}
    </div>
  );
}
