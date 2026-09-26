import { config } from "@/lib/config";
import { MongoProfileRepository } from "@/lib/storage/mongoRepo";
import { ConsoleFileRepository, type ProfileRepository } from "@/lib/storage/profileRepo";

/** The one place that picks a repository implementation (env STORAGE=console|mongo). */
export function getProfileRepository(): ProfileRepository {
  if (config.storage() === "mongo") return new MongoProfileRepository();
  if (!config.writableFs()) {
    throw new Error("STORAGE=console needs WRITABLE_FS=true; on read-only hosts (Vercel) use STORAGE=mongo");
  }
  return new ConsoleFileRepository();
}
