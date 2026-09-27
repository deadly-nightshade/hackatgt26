import type { Collection } from "mongodb";
import type { RecommendationDoc } from "@/lib/recs/schema";
import { getMongoDb } from "@/lib/storage/mongoRepo";
import type { RecommendationRepository } from "@/lib/storage/recRepo";

type Doc = RecommendationDoc & { _id: string };

export class MongoRecommendationRepository implements RecommendationRepository {
  private async col(): Promise<Collection<Doc>> {
    return (await getMongoDb()).collection<Doc>("recommendations");
  }

  async get(userId: string): Promise<RecommendationDoc | null> {
    const doc = await (await this.col()).findOne({ _id: userId });
    if (!doc) return null;
    const { _id: _ignored, ...rest } = doc;
    return rest;
  }

  async save(doc: RecommendationDoc): Promise<void> {
    await (await this.col()).replaceOne({ _id: doc.userId }, { ...doc }, { upsert: true });
  }
}
