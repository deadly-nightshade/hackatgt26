import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saysCozy, toneProblem, TONE_RULES } from "@/lib/ai/tone";
import { MockMeetAI, MuseMeetAI, toneFor, type MeetAI } from "@/lib/meet/ai";
import { runMeet, type MeetDeps } from "@/lib/meet/pipeline";
import { DIALOGUE_SYSTEM_PROMPT, SCENES_SYSTEM_PROMPT } from "@/lib/meet/prompt";
import { energyMatches } from "@/lib/meet/score";
import { validFollowUp } from "@/lib/profile/answerQuality";
import { ADDED_BY_YOU, applyProfileEdit, toEdit } from "@/lib/profile/edit";
import { EXTRACTION_SYSTEM_PROMPT } from "@/lib/profile/prompt";
import { buildProfile, ExtractedProfileSchema, ProfileSchema, styleChips, type Profile } from "@/lib/profile/schema";
import { MemoryPairs, MemoryProfiles } from "./helpers";

vi.mock("@/lib/ai/chat", () => ({ chatJson: vi.fn() }));
const { chatJson } = await import("@/lib/ai/chat");

let base: Profile;
beforeEach(async () => {
  const raw = JSON.parse(await readFile(path.join(__dirname, "..", "fixtures", "mock", "profile.json"), "utf8"));
  base = buildProfile(ExtractedProfileSchema.parse(raw), "Base");
  vi.mocked(chatJson).mockReset();
});

/** A fish whose own answers mention bed rotting (and never "cozy"). */
const bedRotter = (p: Profile): Profile => ({
  ...p,
  displayName: "Rotter",
  interests: [{ name: "lazy days with shows", category: "media_entertainment", tag: "lazy-days", evidence: "honestly just bed rotting and watching shows", confidence: 0.8 }],
  wantsToTry: [],
});

// ── 1. tone ──────────────────────────────────────────────────────────────────

describe("dialogue tone", () => {
  it("flags bed/romance words, and 'cozy' unless the user said it", () => {
    for (const bad of ["Up for a bed scrolling sesh?", "Is this a date?", "soulmates!!", "cuddle up by the pier", "Sleepover at my stall?"])
      expect(toneProblem(bad, { allowCozy: true })).not.toBeNull();
    expect(toneProblem("A cozy morning at the market!", { allowCozy: false })).toMatch(/cozy/);
    expect(toneProblem("A cozy morning at the market!", { allowCozy: true })).toBeNull();
    expect(toneProblem("Wait, you watch crochet videos too? Which creator?", { allowCozy: false })).toBeNull();
    expect(saysCozy(["I love a cosy night in"])).toBe(true);
    expect(saysCozy(["bed rotting all day"])).toBe(false);
  });

  it("every generating prompt carries the tone rules and the {a}/{b} placeholder rule; none calls the app cozy", () => {
    for (const p of [DIALOGUE_SYSTEM_PROMPT, SCENES_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT]) expect(p).toContain(TONE_RULES);
    for (const p of [DIALOGUE_SYSTEM_PROMPT, SCENES_SYSTEM_PROMPT]) expect(p).toContain("{a}");
    for (const p of [DIALOGUE_SYSTEM_PROMPT, SCENES_SYSTEM_PROMPT, EXTRACTION_SYSTEM_PROMPT]) expect(p.replace(TONE_RULES, "")).not.toMatch(/\bcozy\b/i);
  });

  it("live dialogue with bed/'cozy' lines (fixture mentions bed rotting) is sent back and rewritten; bad bump lines dropped", async () => {
    const a = bedRotter(base);
    const b = { ...base, displayName: "Friend" };
    expect(toneFor(a, b).allowCozy).toBe(false);
    const line = (speaker: "a" | "b", text: string) => ({ speaker, text, mood: "happy" as const });
    const bad = {
      friendsLines: [line("a", "Up for a cozy bed scrolling sesh together?"), line("b", "Always!"), line("a", "Yay")],
      clammedUpLines: [line("a", "um hi"), line("b", "hi…"), line("a", "shows sometime?")],
      bumpLines: [{ a: "bed day?", b: "yes" }],
    };
    const good = {
      friendsLines: [line("a", "Wait, you watch crochet videos too? Which creator?"), line("b", "Too many, {a}!"), line("a", "Arcade later?")],
      clammedUpLines: [line("a", "um hi {b}"), line("b", "hi…"), line("a", "shows sometime?")],
      bumpLines: [{ a: "shows later?", b: "yesss" }, { a: "date night?", b: "no" }],
    };
    vi.mocked(chatJson).mockResolvedValueOnce(JSON.stringify(bad)).mockResolvedValueOnce(JSON.stringify(good));
    const analysis = { sharedInterests: [], bridges: [], styleNotes: { energyMatch: false, note: "" }, spotlight: "love shows" };
    const out = await new MuseMeetAI().dialogue(a, b, analysis);
    expect(chatJson).toHaveBeenCalledTimes(2);
    const retryPrompt = vi.mocked(chatJson).mock.calls[1][0].messages.at(-1)!.content;
    expect(retryPrompt).toMatch(/Tone problems/);
    expect(retryPrompt).toMatch(/bed/);
    const all = [...out.friendsLines, ...out.clammedUpLines].map((l) => l.text).join(" ");
    expect(all).not.toMatch(/\bbed\b|\bcozy\b/i);
    expect(out.bumpLines).toEqual([{ a: "shows later?", b: "yesss" }]); // "date night?" dropped
  });
});

// ── names: {a}/{b} placeholders, filled at play time ─────────────────────────

function world() {
  const profiles = new MemoryProfiles();
  profiles.add("ann", { ...base, displayName: "Ann" });
  profiles.add("ben", { ...base, displayName: "Ben" });
  const pairs = new MemoryPairs();
  let aiCalls = 0;
  const mock = new MockMeetAI();
  const ai: MeetAI = {
    model: mock.model,
    analyze: (...x) => (aiCalls++, mock.analyze(...x)),
    dialogue: (...x) => (aiCalls++, mock.dialogue(...x)),
    scenes: (...x) => (aiCalls++, mock.scenes(...x)),
  };
  let clock = new Date("2026-09-20T12:00:00Z").getTime();
  const tap = (from = "ann", to = "ben", forced: "friends" | "clammed_up" = "friends", hangouts = false) => {
    clock += 2 * 3600_000;
    const deps: MeetDeps = { profiles, pairs, ai, random: () => 0.5, now: () => new Date(clock), forcedOutcome: forced, hangoutsEnabled: hangouts, cooldownMs: 0 };
    return runMeet({ initiatorId: from, targetId: to }, deps);
  };
  return { profiles, pairs, tap, calls: () => aiCalls };
}
const text = (r: { script: { text: string }[] }) => r.script.map((l) => l.text).join(" | ");

describe("names are placeholders in cached dialogue", () => {
  it("scripts show real names (never {a}/{b}), from either tapper's side", async () => {
    const w = world();
    const r1 = await w.tap("ann", "ben", "clammed_up");
    expect(text(r1)).not.toMatch(/\{[ab]\}/);
    expect(text(r1)).toMatch(/Ben/);
    const r2 = await w.tap("ben", "ann", "clammed_up");
    expect(text(r2)).toMatch(/Ann/);
    expect(text(r2)).not.toMatch(/\{[ab]\}/);
  });

  it("renaming (cosmetic) → no regeneration, and the cached lines show the new name", async () => {
    const w = world();
    await w.tap("ann", "ben", "clammed_up");
    const calls = w.calls();
    const ben = (await w.profiles.get("ben"))!;
    const { profile, contentChanged } = applyProfileEdit(ben.profile, { ...toEdit(ben.profile), displayName: "Benny", residentFlavor: { marketStall: "a kite stand", catchphrase: "Wheee!" } });
    expect(contentChanged).toBe(false);
    await w.profiles.update("ben", { profile }, { contentChanged });
    const r = await w.tap("ann", "ben", "clammed_up");
    expect(w.calls()).toBe(calls);
    expect(text(r)).toMatch(/Benny/);
  });

  it("editing interests → the next meet regenerates (friends too: on their next hangout)", async () => {
    const w = world();
    await w.tap("ann", "ben", "friends"); // friends now, content cached
    const ben = (await w.profiles.get("ben"))!;
    const edit = toEdit(ben.profile);
    const { profile, contentChanged } = applyProfileEdit(ben.profile, { ...edit, interests: [...edit.interests, { name: "Kite surfing", category: "outdoors" }] });
    expect(contentChanged).toBe(true);
    await w.profiles.update("ben", { profile }, { contentChanged });
    const before = w.calls();
    const r = await w.tap("ann", "ben", "friends", true); // a hangout
    expect(r.outcome).toBe("hangout");
    expect(w.calls()).toBeGreaterThan(before); // analysis + dialogue refreshed (+ fresh scenes)
    const pair = (await w.pairs.getPair("ann__ben"))!;
    expect(pair.status).toBe("friends"); // kept
  });
});

// ── 2. editable profile ─────────────────────────────────────────────────────

describe("profile edits (no AI)", () => {
  it("added/renamed items are 'added by you' at confidence 1; untouched keep evidence; tags slugified + deduped", () => {
    const edit = toEdit(base);
    const first = base.interests[0];
    const { profile } = applyProfileEdit(base, {
      ...edit,
      interests: [
        edit.interests[0], // untouched
        { ...edit.interests[1], name: "Night Markets!" }, // renamed
        { name: "K-pop Dance", category: "music" }, // added
        { name: "k-pop dance", category: "music" }, // duplicate → deduped
      ],
    });
    expect(profile.interests[0]).toEqual(first);
    expect(profile.interests[1]).toMatchObject({ name: "Night Markets!", tag: "night-markets", evidence: ADDED_BY_YOU, confidence: 1 });
    expect(profile.interests.map((i) => i.tag)).toEqual([first.tag, "night-markets", "k-pop-dance"]);
  });

  it("rejects invalid input via the existing schema (e.g. bad MBTI, <2 starters)", () => {
    expect(() => applyProfileEdit(base, { ...toEdit(base), vibeType: { label: "x", mbti: "ABCD" } })).toThrow();
    expect(() => applyProfileEdit(base, { ...toEdit(base), conversationStarters: ["only one"] })).toThrow();
  });

  it("socialStyle edits are matching changes; 'Not set' is null", () => {
    const { profile, contentChanged } = applyProfileEdit(base, { ...toEdit(base), socialStyle: { energy: null, groupSize: "big_group", planning: null } });
    expect(contentChanged).toBe(true);
    expect(profile.socialStyle).toMatchObject({ energy: null, energyEvidence: null, groupSize: "big_group", groupSizeEvidence: "set by you" });
  });
});

// ── social style ─────────────────────────────────────────────────────────────

describe("social style", () => {
  it("older stored profiles (one shared evidence, no per-field) still load", () => {
    const old = { ...base, socialStyle: { energy: "balanced", groupSize: "flexible", planning: "planner", evidence: "old quote" } };
    const parsed = ProfileSchema.parse(old);
    expect(parsed.socialStyle).toEqual({ energy: "balanced", energyEvidence: null, groupSize: "flexible", groupSizeEvidence: null, planning: "planner", planningEvidence: null });
  });

  it("the mock fixture says nothing about plans → planning is null", () => {
    expect(base.socialStyle.planning).toBeNull();
  });

  it("chips hide null and the hedging middle values", () => {
    expect(styleChips({ energy: "balanced", groupSize: "flexible", planning: null })).toEqual([]);
    expect(styleChips({ energy: "homebody", groupSize: "small_group", planning: "flexible" })).toEqual(["🏠 Homebody", "🐟 Small groups"]);
  });

  it("energy matches only when both are known, equal, and not 'balanced'", () => {
    expect(energyMatches({ energy: "homebody" }, { energy: "homebody" })).toBe(true);
    expect(energyMatches({ energy: "balanced" }, { energy: "balanced" })).toBe(false);
    expect(energyMatches({ energy: null }, { energy: null })).toBe(false);
    expect(energyMatches({ energy: "homebody" }, { energy: "out_and_about" })).toBe(false);
  });
});

// ── 4. follow-ups ────────────────────────────────────────────────────────────

describe("follow-up validation", () => {
  const q = "It's a totally free Saturday — no work, no plans, nobody needs you. Walk me through your perfect day, from waking up to crashing.";
  it("keeps short, concrete questions; drops long ones, non-questions and rephrases", () => {
    expect(validFollowUp("Which games are you playing right now?", q)).toBe(true);
    expect(validFollowUp("Night in or night out — which wins, and what are you usually doing?", q)).toBe(true);
    expect(validFollowUp("Tell me more about the games", q)).toBe(false); // no "?"
    expect(validFollowUp("So what would you do on your totally free Saturday perfect day from waking up to crashing and then what else would happen?", q)).toBe(false);
    expect(validFollowUp("Walk me through your perfect free Saturday?", q)).toBe(false); // a rephrase
  });
});
