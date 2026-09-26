/**
 * Onboarding questions — the single source of truth. Add, remove or reorder
 * entries here; the UI, API routes and prompt builder all read from this list.
 * Safe to import from client components (no server-only deps).
 */

export type OnboardingQuestion = {
  id: string;
  prompt: string;
  /** What the extractor should look for in the answer. */
  purpose: string;
  /** Guidance for the answer-quality follow-up generator. */
  followUpHint: string;
  /** Pre-generated TTS of `prompt` (scripts/generate-question-audio.ts). */
  audioSrc?: string;
  /** If set, only included when this feature flag is on (see getActiveQuestions). */
  flag?: "wantToTry";
};

const audio = (id: string) => `/audio/questions/${id}.mp3`;

export const QUESTIONS: OnboardingQuestion[] = [
  {
    id: "free_day",
    prompt:
      "It's a totally free Saturday — no work, no plans, nobody needs you. Walk me through your perfect day, from waking up to crashing.",
    purpose: "hobbies, energy level, homebody vs going out, solo vs social",
    followUpHint: "Ask about the specific activity they mentioned, or what an ideal version of it looks like.",
    audioSrc: audio("free_day"),
  },
  {
    id: "feed",
    prompt:
      "Open whatever app you scroll most. What's actually on your feed right now? Be honest — the 2am stuff counts.",
    purpose: "current interests, niche obsessions, humor/aesthetic",
    followUpHint: "Ask for a specific creator, niche, or the last thing that made them laugh or rabbit-hole.",
    audioSrc: audio("feed"),
  },
  {
    id: "want_to_try",
    prompt:
      "What's something you've been wanting to try but haven't, because you've got no one to do it with?",
    purpose: "direct matching signal for IRL plans (wantsToTry)",
    followUpHint: "Ask what's appealing about it or what a first try would look like.",
    audioSrc: audio("want_to_try"),
    flag: "wantToTry",
  },
];

export function getActiveQuestions(flags: { wantToTry: boolean }): OnboardingQuestion[] {
  return QUESTIONS.filter((q) => !q.flag || flags[q.flag]);
}

export function getQuestion(id: string): OnboardingQuestion | undefined {
  return QUESTIONS.find((q) => q.id === id);
}
