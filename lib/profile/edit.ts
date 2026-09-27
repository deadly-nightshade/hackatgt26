import { z } from "zod";
import {
  ENERGY,
  GROUP_SIZE,
  INTEREST_CATEGORIES,
  normalizeProfile,
  PLANNING,
  ProfileSchema,
  toTag,
  type Profile,
  type ProfileView,
  type SocialStyle,
} from "@/lib/profile/schema";

/**
 * /me "Edit profile": what the user can change, and how it merges into the stored
 * profile. No AI — tags come from slugify(name). Safe to import in client components. Internal fields (traits, confidence,
 * evidence, rawAnswers, lowSignalAreas) are never edited directly.
 */

const text = (max: number) => z.string().trim().min(1).max(max);

export const ProfileEditSchema = z.object({
  displayName: text(60),
  summary: text(400),
  /** origTag = the item's tag before editing (kept evidence if the name didn't change). */
  interests: z.array(z.object({ name: text(80), category: z.enum(INTEREST_CATEGORIES), origTag: z.string().optional() })).max(30),
  wantsToTry: z.array(z.object({ name: text(80), origTag: z.string().optional() })).max(20),
  socialStyle: z.object({
    energy: z.enum(ENERGY).nullable(),
    groupSize: z.enum(GROUP_SIZE).nullable(),
    planning: z.enum(PLANNING).nullable(),
  }),
  vibeType: z.object({ label: text(60), mbti: z.string().trim().toUpperCase().regex(/^[EI][NS][TF][JP]$/, "MBTI must be 4 letters like ENFP") }),
  residentFlavor: z.object({ marketStall: text(140), catchphrase: text(140) }),
  conversationStarters: z.array(text(200)).min(2).max(4),
});
export type ProfileEdit = z.infer<typeof ProfileEditSchema>;

export const ADDED_BY_YOU = "added by you";

export class ProfileEditError extends Error {}

/** Client-safe (no server imports): readable "field: problem" lines. */
export function formatEditError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "profile"}: ${i.message}`).join("\n");
}

/** What a profile's editable fields look like to the editor (the inverse of applyProfileEdit). */
export function toEdit(p: ProfileView): ProfileEdit {
  return {
    displayName: p.displayName,
    summary: p.summary,
    interests: p.interests.map((i) => ({ name: i.name, category: i.category, origTag: i.tag })),
    wantsToTry: p.wantsToTry.map((w) => ({ name: w.name, origTag: w.tag })),
    socialStyle: { energy: p.socialStyle.energy, groupSize: p.socialStyle.groupSize, planning: p.socialStyle.planning },
    vibeType: { label: p.vibeType.label, mbti: p.vibeType.mbti },
    residentFlavor: { ...p.residentFlavor },
    conversationStarters: [...p.conversationStarters],
  };
}

/** The fields matching uses (pair AI cache): interests, wantsToTry, socialStyle values. */
function matchingKey(p: Profile): string {
  return JSON.stringify({
    interests: p.interests.map((i) => [i.tag, i.name, i.category]),
    wantsToTry: p.wantsToTry.map((w) => [w.tag, w.name]),
    style: [p.socialStyle.energy, p.socialStyle.groupSize, p.socialStyle.planning],
  });
}

/**
 * Merge an edit into the stored profile. Unchanged items keep their evidence/confidence;
 * added or renamed ones get evidence "added by you", confidence 1. Throws ProfileEditError
 * if the result doesn't validate. `contentChanged` = a matching field changed.
 */
export function applyProfileEdit(current: Profile, edit: ProfileEdit): { profile: Profile; contentChanged: boolean } {
  const interests = edit.interests.map((e) => {
    const orig = current.interests.find((i) => i.tag === e.origTag);
    if (orig && orig.name === e.name) return { ...orig, category: e.category };
    return { name: e.name, category: e.category, tag: toTag(e.name), evidence: ADDED_BY_YOU, confidence: 1 };
  });
  const wantsToTry = edit.wantsToTry.map((e) => {
    const orig = current.wantsToTry.find((w) => w.tag === e.origTag);
    if (orig && orig.name === e.name) return orig;
    return { name: e.name, tag: toTag(e.name), evidence: ADDED_BY_YOU };
  });
  const style = (field: "energy" | "groupSize" | "planning"): Partial<SocialStyle> => {
    const value = edit.socialStyle[field];
    const evidenceKey = `${field}Evidence` as const;
    if (value === current.socialStyle[field]) return { [field]: value, [evidenceKey]: current.socialStyle[evidenceKey] };
    return { [field]: value, [evidenceKey]: value === null ? null : "set by you" };
  };

  const merged = {
    ...current,
    displayName: edit.displayName,
    summary: edit.summary,
    interests,
    wantsToTry,
    socialStyle: { ...current.socialStyle, ...style("energy"), ...style("groupSize"), ...style("planning") },
    vibeType: { ...current.vibeType, label: edit.vibeType.label, mbti: edit.vibeType.mbti },
    residentFlavor: edit.residentFlavor,
    conversationStarters: edit.conversationStarters,
  };
  const parsed = ProfileSchema.safeParse(merged);
  if (!parsed.success) throw new ProfileEditError(formatEditError(parsed.error));
  const profile = normalizeProfile(parsed.data); // tags slugified + deduped
  return { profile, contentChanged: matchingKey(profile) !== matchingKey(current) };
}
