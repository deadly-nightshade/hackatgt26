/**
 * Every fish with its id and the URL to write on its NFC tag (respects STORAGE).
 *
 *   npm run list:fish                                  # uses PUBLIC_BASE_URL, else http://localhost:3000
 *   npm run list:fish -- https://hackatgt26.vercel.app
 */
import "./loadEnv";
import { getProfileRepository } from "@/lib/storage";
import { closeMongo } from "@/lib/storage/mongoRepo";

async function main() {
  const base = (process.argv[2] || process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const users = await getProfileRepository().list();
  if (!users.length) return console.log("No fish yet.");
  console.table(
    users.map((u) => ({
      name: u.displayName,
      id: u.id,
      seed: u.isSeed ? "yes" : "",
      tagUrl: `${base}/meet/${encodeURIComponent(u.id)}`,
    })),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
