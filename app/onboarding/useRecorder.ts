"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Chrome/Firefox → webm/opus, Safari → mp4/aac. The server converts either to WAV.
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/** Peak (0–1) below this for the whole take = the mic delivered silence. Matches the server check. */
export const SILENCE_PEAK = 0.002;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
}

export type RecorderError = "denied" | "unsupported" | "failed";
export type Recording = { blob: Blob; peak: number };

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<RecorderError | null>(null);
  /** Live input level 0–1 while recording, for the meter. */
  const [level, setLevel] = useState(0);
  /** Which input device the browser actually opened (e.g. "Microphone Array (Intel…)"). */
  const [deviceLabel, setDeviceLabel] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopResolveRef = useRef<((r: Recording) => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef(0);

  const release = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  };

  useEffect(() => release, []);

  /** Level meter via an AnalyserNode tapped off the same stream (doesn't affect the recording). */
  function startMeter(stream: MediaStream) {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const s of buf) peak = Math.max(peak, Math.abs(s));
        peakRef.current = Math.max(peakRef.current, peak);
        setLevel(peak);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      peakRef.current = 1; // meter unavailable — don't block uploads on it
    }
  }

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("unsupported");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setDeviceLabel(stream.getAudioTracks()[0]?.label ?? "");
      peakRef.current = 0;
      startMeter(stream);
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mimeType || "audio/webm" });
        const peak = peakRef.current;
        release();
        setRecording(false);
        stopResolveRef.current?.({ blob, peak });
        stopResolveRef.current = null;
      };
      recorderRef.current = rec;
      rec.start(250);
      setRecording(true);
      return true;
    } catch (err) {
      release();
      const name = (err as DOMException)?.name;
      setError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
      return false;
    }
  }, []);

  const stop = useCallback((): Promise<Recording> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === "inactive") return resolve({ blob: new Blob(), peak: 0 });
      stopResolveRef.current = resolve;
      rec.stop();
    });
  }, []);

  return { recording, error, level, deviceLabel, start, stop };
}
