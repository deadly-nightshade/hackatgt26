import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RecommendationDoc } from "@/lib/recs/schema";
import { isValidProfileId } from "@/lib/storage/profileRepo";

/** Cached "Find fish" results, one doc per user (collection `recommendations`). */
export interface RecommendationRepository {
  get(userId: string): Promise<RecommendationDoc | null>;
  save(doc: RecommendationDoc): Promise<void>;
}

/** STORAGE=console: data/recommendations/<userId>.json */
export class FileRecommendationRepository implements RecommendationRepository {
  constructor(private dir = path.join(process.cwd(), "data", "recommendations")) {}

  async get(userId: string): Promise<RecommendationDoc | null> {
    if (!isValidProfileId(userId)) return null;
    return readFile(path.join(this.dir, `${userId}.json`), "utf8").then(JSON.parse, () => null);
  }

  async save(doc: RecommendationDoc): Promise<void> {
    if (!isValidProfileId(doc.userId)) return;
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, `${doc.userId}.json`), JSON.stringify(doc, null, 2));
  }
}
