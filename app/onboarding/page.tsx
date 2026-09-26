import { config } from "@/lib/config";
import { getActiveQuestions } from "@/lib/onboarding/questions";
import OnboardingFlow from "./OnboardingFlow";

// Read feature flags per request (not at build time).
export const dynamic = "force-dynamic";

/** Only same-site paths (e.g. /meet/<id>), never another origin. */
function safeReturnTo(v: string | string[] | undefined): string | null {
  return typeof v === "string" && /^\/(?![/\\])/.test(v) ? v : null;
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const questions = getActiveQuestions({ wantToTry: config.includeWantToTry() });
  const { returnTo } = await searchParams;
  return <OnboardingFlow questions={questions} returnTo={safeReturnTo(returnTo)} />;
}
