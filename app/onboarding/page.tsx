import { config } from "@/lib/config";
import { getActiveQuestions } from "@/lib/onboarding/questions";
import OnboardingFlow from "./OnboardingFlow";

// Read feature flags per request (not at build time).
export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  const questions = getActiveQuestions({ wantToTry: config.includeWantToTry() });
  return <OnboardingFlow questions={questions} />;
}
