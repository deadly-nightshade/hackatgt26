import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProfile,
  ExtractedProfileSchema,
  extractedProfileJsonSchema,
  ProfileSchema,
  toTag,
} from "@/lib/profile/schema";

const loadMock = async () =>
  JSON.parse(await readFile(path.join(__dirname, "..", "fixtures", "mock", "profile.json"), "utf8"));

describe("ExtractedProfileSchema", () => {
  it("accepts the mock profile", async () => {
    expect(ExtractedProfileSchema.safeParse(await loadMock()).success).toBe(true);
  });

  it.each([
    ["missing summary", (p: any) => delete p.summary],
    ["bad category", (p: any) => (p.interests[0].category = "sports")],
    ["confidence > 1", (p: any) => (p.interests[0].confidence = 1.5)],
    ["empty evidence", (p: any) => (p.interests[0].evidence = "")],
    ["trait score out of range", (p: any) => (p.traits.openness.score = 7)],
    ["missing trait", (p: any) => delete p.traits.agreeableness],
    ["invalid mbti", (p: any) => (p.vibeType.mbti = "XYZW")],
    ["too few starters", (p: any) => (p.conversationStarters = ["hi"])],
    ["too many starters", (p: any) => (p.conversationStarters = ["a", "b", "c", "d", "e"])],
    ["bad energy enum", (p: any) => (p.socialStyle.energy = "chaotic")],
    ["wrong type", (p: any) => (p.interests = "bouldering")],
  ])("rejects malformed output: %s", async (_name, mutate) => {
    const p = await loadMock();
    mutate(p);
    expect(ExtractedProfileSchema.safeParse(p).success).toBe(false);
  });
});

describe("buildProfile", () => {
  it("adds server-owned fields and normalizes tags", async () => {
    const extracted = ExtractedProfileSchema.parse(await loadMock());
    extracted.interests.push({ ...extracted.interests[0], tag: "Bouldering!" }); // duplicate after normalizing
    const profile = buildProfile(extracted, "Maya");
    expect(ProfileSchema.safeParse(profile).success).toBe(true);
    expect(profile.schemaVersion).toBe("1");
    expect(profile.displayName).toBe("Maya");
    expect(profile.vibeType.disclaimer).toBe("just for fun");
    expect(profile.interests.filter((i) => i.tag === "bouldering")).toHaveLength(1);
  });

  it("ProfileSchema rejects a missing displayName", async () => {
    const profile = buildProfile(ExtractedProfileSchema.parse(await loadMock()), "Maya") as any;
    profile.displayName = "  ";
    expect(ProfileSchema.safeParse(profile).success).toBe(false);
  });
});

describe("toTag", () => {
  it("produces lowercase kebab-case", () => {
    expect(toTag("K-Pop Dance Covers")).toBe("k-pop-dance-covers");
    expect(toTag("  Café & Crêpes ")).toBe("cafe-and-crepes");
  });
});

describe("extractedProfileJsonSchema", () => {
  it("has no $ref and stays within nesting depth 10", () => {
    const text = JSON.stringify(extractedProfileJsonSchema);
    expect(text).not.toContain("$ref");
    const depth = (v: unknown): number =>
      v && typeof v === "object" ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0;
    // Count schema-level nesting (each object/array schema adds properties/items + node = 2 JSON levels).
    expect(Math.ceil(depth(extractedProfileJsonSchema) / 2)).toBeLessThanOrEqual(10);
    expect((extractedProfileJsonSchema as any).type).toBe("object");
  });
});
