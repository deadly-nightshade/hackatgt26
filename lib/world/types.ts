import type { AttemptKind, BumpLine, DialogueLine, PairStatus } from "@/lib/meet/schema";

/** API shapes for /world. Safe for client components. */

export type Resident = {
  id: string;
  displayName: string;
  pairKey: string;
  status: PairStatus;
  level: number;
  /** null for strangers ("Just met"). */
  levelName: string | null;
  hangoutCount: number;
  friendsSince: string | null;
  lastMetAt: string;
};

export type WorldResponse = {
  me: { id: string; displayName: string; catchphrase: string };
  residents: Resident[];
  /** me↔resident and resident↔resident pairs that exist; "a" = the pair's first (sorted) id. */
  bumpLines: Record<string, BumpLine[]>;
};

export type HistoryItem = {
  attemptId: string;
  kind: AttemptKind;
  createdAt: string;
  levelNameAfter: string | null;
  leveledUp: boolean;
  hasScript: boolean;
};

export type ReplayResponse = {
  kind: AttemptKind;
  createdAt: string;
  /** a = who tapped, b = whose tag it was (the script's speaker orientation). */
  names: { a: string; b: string };
  script: DialogueLine[];
};
