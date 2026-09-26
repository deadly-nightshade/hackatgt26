/**
 * Run the meet pipeline for two fish from the terminal (respects AI_MODE,
 * STORAGE and the pair cache — it writes attempts/status like a real tap).
 *
 *   npm run meet:pair -- <idA> <idB> [--attempts N] [--hangouts N] [--ignore-cooldown]
 *                                    [--reset] [--regenerate] [--force friends|clammed_up]
 *
 * --reset       delete this pair (cache, status, attempts) first
 * --attempts N  tap N times as A (default 1)
 * --hangouts N  after that, N more taps with the cooldown skipped
 */
import "./loadEnv";
import { getUsageTotals } from "@/lib/ai/usage";
import { defaultMeetDeps } from "@/lib/meet";
import { runMeet } from "@/lib/meet/pipeline";
import { pairKeyOf, type MeetResponse } from "@/lib/meet/schema";
import { closeMongo } from "@/lib/storage/mongoRepo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

function printResult(r: MeetResponse, label: string) {
  const d = r.debug;
  console.log(`\n── ${label}: ${r.outcome.toUpperCase()}  (attempt #${r.attemptNumber}) ──`);
  console.log(
    `similarity ${r.similarity.toFixed(2)}` +
      (d?.pFail != null ? `  pFail ${d.pFail.toFixed(3)}  roll ${d.roll?.toFixed(3)}` : "") +
      (r.levelName ? `  level ${r.level} ${r.levelName}${r.leveledUp ? " (level up!)" : ""}  hangouts ${r.hangoutCount}` : "") +
      (d?.usedFallback ? "  [FALLBACK]" : "") +
      `  model calls ${d?.modelCalls ?? "?"}`,
  );
  for (const l of r.script) {
    const who = l.speaker === "narrator" ? "   ~" : l.speaker === "a" ? r.fish.a.displayName : r.fish.b.displayName;
    console.log(`  ${who.padEnd(14).slice(0, 14)} ${l.text}`);
  }
}

async function main() {
  const valueFlags = ["--attempts", "--hangouts", "--force"];
  const [idA, idB] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !valueFlags.includes(all[i - 1]));
  if (!idA || !idB) throw new Error("Usage: npm run meet:pair -- <idA> <idB> [--attempts N] [--hangouts N] [--ignore-cooldown] [--reset] [--regenerate] [--force friends|clammed_up]");
  const attempts = Number(arg("--attempts") ?? 1);
  const hangouts = Number(arg("--hangouts") ?? 0);
  const force = arg("--force");

  const deps = defaultMeetDeps();
  if (force === "friends" || force === "clammed_up") deps.forcedOutcome = force;
  if (has("--reset")) {
    await deps.pairs.deletePair(pairKeyOf(idA, idB));
    console.log("Reset pair (cache, status, attempts).");
  }

  let analysisShown = false;
  const run = async (label: string, opts: { regenerate?: boolean; ignoreCooldown?: boolean }) => {
    const r = await runMeet({ initiatorId: idA, targetId: idB, includeDebug: true, ...opts }, deps);
    if (!analysisShown && r.debug) {
      console.log(`\nAnalysis (${r.pairKey}):\n${JSON.stringify(r.debug.analysis, null, 2)}`);
      analysisShown = true;
    }
    printResult(r, label);
  };

  for (let i = 0; i < attempts; i++) await run(`tap ${i + 1}`, { regenerate: i === 0 && has("--regenerate"), ignoreCooldown: has("--ignore-cooldown") });
  for (let i = 0; i < hangouts; i++) await run(`hangout tap ${i + 1}`, { ignoreCooldown: true });

  const t = getUsageTotals();
  console.log(`\nLive model calls this run: ${t.calls} (${t.inputTokens} in / ${t.outputTokens} out tokens)`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closeMongo);
