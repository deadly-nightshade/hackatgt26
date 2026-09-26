import { log } from "@/lib/util/log";

type Totals = { calls: number; inputTokens: number; outputTokens: number; audioMs: number };

// Stored on globalThis so the running total survives Next.js dev hot-reloads.
const g = globalThis as unknown as { __aiUsage?: Totals };
const totals: Totals = (g.__aiUsage ??= { calls: 0, inputTokens: 0, outputTokens: 0, audioMs: 0 });

/** Log one live (billed) API call and print the running session total. */
export function recordUsage(entry: {
  route: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Subset of outputTokens spent on hidden reasoning. */
  reasoningTokens?: number;
  audioMs?: number;
}) {
  totals.calls += 1;
  totals.inputTokens += entry.inputTokens ?? 0;
  totals.outputTokens += entry.outputTokens ?? 0;
  totals.audioMs += entry.audioMs ?? 0;
  log("ai-usage", `LIVE ${entry.route} ${entry.model}`, {
    latencyMs: entry.latencyMs,
    in: entry.inputTokens,
    out: entry.outputTokens,
    reasoning: entry.reasoningTokens,
    audioMs: entry.audioMs,
  });
  log(
    "ai-usage",
    `session total: ${totals.calls} calls, ${totals.inputTokens} in / ${totals.outputTokens} out tokens, ` +
      `${(totals.audioMs / 1000).toFixed(1)}s audio`,
  );
}

export function getUsageTotals(): Readonly<Totals> {
  return { ...totals };
}
