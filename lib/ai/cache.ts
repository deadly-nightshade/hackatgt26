import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { log } from "@/lib/util/log";

const CACHE_DIR = path.join(process.cwd(), "data", "cache");

export function cacheKey(...parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    if (Buffer.isBuffer(p)) h.update(p);
    else h.update(typeof p === "string" ? p : (JSON.stringify(p) ?? "null"));
    h.update("|");
  }
  return h.digest("hex");
}

/**
 * Dev-only response cache keyed by hash(model + prompt + input).
 * No-op unless AI_CACHE=true and WRITABLE_FS=true.
 */
export async function withCache<T>(
  key: string,
  label: string,
  fn: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true,
): Promise<T> {
  if (!config.aiCache()) return fn();
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as T;
    log("ai-cache", `HIT ${label} ${key.slice(0, 12)}`);
    return hit;
  } catch {
    // cache miss
  }
  const value = await fn();
  if (!shouldCache(value)) return value;
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(value, null, 2));
  return value;
}
