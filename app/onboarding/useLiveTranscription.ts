"use client";

import { CommitStrategy, RealtimeEvents, useScribe } from "@elevenlabs/react";
import { useCallback, useRef, useState } from "react";
import { STT_REALTIME_MODEL } from "@/lib/config";

export type LiveStartResult = "live" | "unavailable" | "failed";

const SESSION_START_TIMEOUT_MS = 8000;
/** Mid-take drops we silently recover from (fresh token + new session) before giving up. */
const MAX_RECONNECTS = 3;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class TokenUnavailable extends Error {}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "error" in err) return String((err as { error: unknown }).error);
  return "Live transcription error";
}

/**
 * Live transcription: browser mic → ElevenLabs Scribe realtime over WebSocket,
 * authenticated with a single-use token from /api/stt-token (our key never
 * reaches the browser). Manual commit: one take = one committed transcript.
 *
 * start() only reports "live" once the server confirms the session; otherwise
 * "failed", so the caller can fall back to record + upload. If the socket drops
 * mid-take, text so far is kept and a new session is opened automatically.
 */
export function useLiveTranscription() {
  const carriedRef = useRef<string[]>([]); // text from earlier (dropped) sessions in this take
  const committedRef = useRef<string[]>([]);
  const partialRef = useRef("");
  const commitWaiterRef = useRef<(() => void) | null>(null);
  const sessionWaiterRef = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  const activeRef = useRef(false);
  const reconnectingRef = useRef(false);
  const reconnectsRef = useRef(0);
  const sessionStartedAtRef = useRef(0);
  const [liveText, setLiveText] = useState("");
  const [active, setActive] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const takeText = () => [...carriedRef.current, ...committedRef.current, partialRef.current].filter(Boolean).join(" ").trim();
  const refresh = () => setLiveText(takeText());

  const scribe = useScribe({
    modelId: STT_REALTIME_MODEL,
    commitStrategy: CommitStrategy.MANUAL,
    onSessionStarted: () => sessionWaiterRef.current?.resolve(),
    onPartialTranscript: ({ text }) => {
      partialRef.current = text.trim();
      refresh();
    },
    onCommittedTranscript: ({ text }) => {
      if (text.trim()) committedRef.current.push(text.trim());
      partialRef.current = "";
      refresh();
      commitWaiterRef.current?.();
    },
    onError: (err) => {
      const msg = describe(err);
      if (sessionWaiterRef.current) sessionWaiterRef.current.reject(new Error(msg));
      else if (activeRef.current) void recover(msg);
    },
  });

  /** Token → connect → wait for the server's session_started. Throws on failure. */
  async function openSession(): Promise<void> {
    const res = await fetch("/api/stt-token", { method: "POST", signal: AbortSignal.timeout(10_000) });
    if (res.status === 204) throw new TokenUnavailable("mock mode");
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Token request failed (${res.status})`);
    const { token } = (await res.json()) as { token: string };

    const sessionStarted = new Promise<void>((resolve, reject) => {
      sessionWaiterRef.current = { resolve, reject };
      setTimeout(() => reject(new Error("timed out waiting for session")), SESSION_START_TIMEOUT_MS);
    });
    sessionStarted.catch(() => {}); // awaited below; avoid an unhandled-rejection warning meanwhile
    try {
      await scribe.connect({
        token,
        microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      // The browser's WebSocket error event has no details; the close event carries the code/reason.
      scribe.getConnection()?.on(RealtimeEvents.CLOSE, (e: unknown) => {
        const ev = e as CloseEvent;
        const lived = sessionStartedAtRef.current ? ` after ${((Date.now() - sessionStartedAtRef.current) / 1000).toFixed(1)}s` : "";
        console.warn(`[scribe] socket closed${lived} — code ${ev.code}${ev.reason ? `: ${ev.reason}` : ""}`);
        sessionWaiterRef.current?.reject(new Error(`socket closed (${ev.code})`));
      });
      await sessionStarted;
      sessionStartedAtRef.current = Date.now();
    } finally {
      sessionWaiterRef.current = null;
    }
  }

  /** Socket dropped mid-take: keep the text, open a fresh session, keep listening. */
  async function recover(reason: string) {
    if (reconnectingRef.current) return; // error + close both fire for one drop
    reconnectingRef.current = true;
    setReconnecting(true);
    carriedRef.current = [takeText()].filter(Boolean);
    committedRef.current = [];
    partialRef.current = "";
    scribe.disconnect();
    try {
      while (activeRef.current && reconnectsRef.current < MAX_RECONNECTS) {
        reconnectsRef.current++;
        console.warn(`[scribe] reconnecting (${reconnectsRef.current}/${MAX_RECONNECTS}) after: ${reason}`);
        try {
          await openSession();
          return;
        } catch (err) {
          reason = describe(err);
          scribe.disconnect();
          await sleep(500);
        }
      }
      if (activeRef.current) {
        setError("Live captions keep dropping. What you see is kept — press Stop, then type or record more.");
      }
    } finally {
      reconnectingRef.current = false;
      setReconnecting(false);
    }
  }

  const start = useCallback(async (): Promise<LiveStartResult> => {
    setError(null);
    carriedRef.current = [];
    committedRef.current = [];
    partialRef.current = "";
    reconnectsRef.current = 0;
    sessionStartedAtRef.current = 0;
    setLiveText("");
    try {
      await openSession();
      activeRef.current = true;
      setActive(true);
      return "live";
    } catch (err) {
      scribe.disconnect();
      if (err instanceof TokenUnavailable) return "unavailable"; // mock mode → record + upload instead
      await sleep(150); // let a pending close event log its code first
      console.warn(`[scribe] live start failed, falling back to upload: ${describe(err)}`);
      return "failed";
    }
  }, [scribe]); // openSession/recover are per-render helpers; all state lives in refs

  /** Flush the last words, disconnect, and return the full text of this take. */
  const stop = useCallback(async (): Promise<string> => {
    activeRef.current = false; // stops any reconnect loop
    const committed = new Promise<void>((r) => (commitWaiterRef.current = r));
    try {
      if (!reconnectingRef.current) {
        scribe.commit();
        // Wait for the final committed text; shorter if nothing was heard yet.
        await Promise.race([committed, sleep(partialRef.current ? 3000 : 1000)]);
      }
    } catch {
      // not connected any more — keep what we have
    }
    commitWaiterRef.current = null;
    const text = takeText();
    scribe.disconnect();
    setActive(false);
    return text;
  }, [scribe]); // openSession/recover are per-render helpers; all state lives in refs

  return { start, stop, active, reconnecting, liveText, error };
}
