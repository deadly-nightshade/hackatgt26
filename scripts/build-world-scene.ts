/**
 * Builds the /world scene sprites from the raw art in public/art/world.
 *
 *   npm run build:scene
 *
 * Every raw asset is a 2048×2048 canvas. Sand, DockUpdate, Ocean and Seashells are
 * pre-positioned layers; the rest are standalone props drawn at arbitrary spots,
 * so each is cropped to its opaque bounds and placed by lib/world/scene.ts.
 * The ice cream stand is cropped twice: the whole stand, and its counter front
 * (drawn over a fish in the serving window). See docs/world-assets.md.
 *
 * Output: public/world/scene/*. Re-run after replacing any raw art.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { BOOTH_COUNTER, ICECREAM_ART, SCENE_PX, SEAGULL_ANIM_ART, SCENE_SEA_FROM, SCENE_SKY_ROWS, SHELLS_LIFT } from "@/lib/world/scene";

const RAW = path.join(process.cwd(), "public", "art", "world");
const OUT = path.join(process.cwd(), "public", "world", "scene");
const SKY = { r: 125, g: 199, b: 235 };
const SEA = { r: 93, g: 135, b: 191 };
/** Straight vertical planks (replaced the perspective Dock.png), so copies of it tile side by side. */
const DOCK = "DockUpdate.png";

type Raw = { data: Buffer; width: number; height: number };

async function raw(file: string): Promise<Raw> {
  const { data, info } = await sharp(path.join(RAW, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Tight opaque bounds (alpha > 8). */
function bounds({ data, width, height }: Raw) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function cropProp(file: string, out: string) {
  const r = await raw(file);
  const b = bounds(r);
  await sharp(path.join(RAW, file)).extract(b).png({ compressionLevel: 9 }).toFile(path.join(OUT, out));
  console.log(`${out.padEnd(22)} ← ${file} bounds`, b);
  return b;
}

/**
 * Sky band above the dock + sand + dock + seashells, flattened (no alpha needed).
 * Below the lowest wave crest it's solid sea, so the (drifting) ocean sprite never shows sand at the bottom edge.
 */
async function buildBase() {
  const width = SCENE_PX, height = SCENE_PX;
  const sky = await sharp({ create: { width, height: SCENE_SKY_ROWS, channels: 4, background: { ...SKY, alpha: 1 } } }).png().toBuffer();
  const sea = await sharp({ create: { width, height: height - SCENE_SEA_FROM, channels: 4, background: { ...SEA, alpha: 1 } } }).png().toBuffer();
  // Lifted so the waves cover less of the shells and starfish.
  const shells = await sharp(path.join(RAW, "Seashells.png"))
    .extract({ left: 0, top: SHELLS_LIFT, width, height: height - SHELLS_LIFT })
    .png()
    .toBuffer();
  const buf = await sharp(path.join(RAW, "Sand.png"))
    .composite([
      { input: sky, top: 0, left: 0 },
      { input: sea, top: SCENE_SEA_FROM, left: 0 },
      { input: path.join(RAW, DOCK) },
      { input: shells, top: 0, left: 0 },
    ])
    .removeAlpha()
    .toBuffer();
  await sharp(buf).jpeg({ quality: 88 }).toFile(path.join(OUT, "base.jpg"));
}

/** The ice cream stand, and its counter front (drawn over a fish in the serving window). */
async function cropStore() {
  const file = path.join(RAW, "Ice cream.png");
  await sharp(file).extract(ICECREAM_ART.bounds).png({ compressionLevel: 9 }).toFile(path.join(OUT, "icecream-store.png"));
  await sharp(file).extract(ICECREAM_ART.counter).png({ compressionLevel: 9 }).toFile(path.join(OUT, "counter-front.png"));
  console.log("icecream-store.png     ← Ice cream.png", ICECREAM_ART.bounds);
  console.log("counter-front.png      ← Ice cream.png", ICECREAM_ART.counter);
}

/** Seagull animation: each frame cropped to the shared bounds, laid out left → right in one strip. */
async function buildSeagullStrip() {
  const { dir, frames, crop } = SEAGULL_ANIM_ART;
  const tiles = await Promise.all(
    Array.from({ length: frames }, (_, i) =>
      sharp(path.join(RAW, dir, `Frame_${i + 1}.png`)).extract(crop).png().toBuffer(),
    ),
  );
  await sharp({ create: { width: crop.width * frames, height: crop.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles.map((input, i) => ({ input, left: i * crop.width, top: 0 })))
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, "seagull-anim.png"));
  console.log(`seagull-anim.png       ← ${dir}/Frame_1..${frames}.png (strip)`, crop);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await buildBase();
  console.log("base.jpg               ← sky band + Sand + Dock + Seashells");
  await cropProp("Ocean.png", "ocean.png");
  await cropProp("Booth1.png", "booth1.png");
  await cropProp("Booth2.png", "booth2.png");
  await cropProp("Pincnic table.png", "picnic-table.png");
  await cropProp("Bucket and shovel.png", "bucket-shovel.png");
  await cropProp("Sandcastle.png", "sandcastle.png");
  await cropProp("Seagull.png", "seagull.png");
  await cropStore();
  // Stall counters (table top + front box): drawn over a fish working the stall.
  for (const id of ["booth1", "booth2"] as const) {
    const file = path.join(OUT, `${id}.png`);
    const { width = 0, height = 0 } = await sharp(file).metadata();
    const { top } = BOOTH_COUNTER[id];
    await sharp(file).extract({ left: 0, top, width, height: height - top }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${id}-counter.png`));
    console.log(`${`${id}-counter.png`.padEnd(22)} ← ${id}.png rows ${top}–${height}`);
  }
  await buildSeagullStrip();
  // Side fill on wide screens, placed unmirrored beside the scene: sky + sand + dock tile as-is,
  // but the wave line differs at the scene's two edges, so only the ocean is flipped (its edges then meet the scene's).
  const flippedOcean = await sharp(path.join(RAW, "Ocean.png")).flop().toBuffer();
  const withOcean = await sharp(path.join(OUT, "base.jpg")).composite([{ input: flippedOcean }]).toBuffer();
  await sharp(withOcean)
    .resize(1024, 1024)
    .jpeg({ quality: 80 })
    .toFile(path.join(OUT, "strip.jpg"));
  console.log("strip.jpg              ← base + flipped Ocean (side fill on wide screens)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
