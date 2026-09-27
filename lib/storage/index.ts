import { config } from "@/lib/config";
import { MongoPairRepository } from "@/lib/storage/mongoPairRepo";
import { MongoProfileRepository } from "@/lib/storage/mongoRepo";
import { FilePairRepository, type PairRepository } from "@/lib/storage/pairRepo";
import { ConsoleFileRepository, type ProfileRepository } from "@/lib/storage/profileRepo";
import { MongoRecommendationRepository } from "@/lib/storage/mongoRecRepo";
import { FileRecommendationRepository, type RecommendationRepository } from "@/lib/storage/recRepo";

function assertWritableFs() {
  if (!config.writableFs()) {
    throw new Error("STORAGE=console needs WRITABLE_FS=true; on read-only hosts (Vercel) use STORAGE=mongo");
  }
}

/** The one place that picks a repository implementation (env STORAGE=console|mongo). */
export function getProfileRepository(): ProfileRepository {
  if (config.storage() === "mongo") return new MongoProfileRepository();
  assertWritableFs();
  return new ConsoleFileRepository();
}

/** Same STORAGE switch for meet-up pairs + attempts. */
export function getPairRepository(): PairRepository {
  if (config.storage() === "mongo") return new MongoPairRepository();
  assertWritableFs();
  return new FilePairRepository();
}

/** Same STORAGE switch for cached "Find fish" recommendations. */
export function getRecommendationRepository(): RecommendationRepository {
  if (config.storage() === "mongo") return new MongoRecommendationRepository();
  assertWritableFs();
  return new FileRecommendationRepository();
}
