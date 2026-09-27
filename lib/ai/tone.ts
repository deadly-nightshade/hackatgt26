/**
 * Tone rules shared by every prompt that writes user-facing text (meet dialogue,
 * hangout scenes, bump lines, onboarding summary/labels) + a code-side check,
 * because prompts alone don't guarantee it.
 */

export const TONE_RULES = `Tone (important):
- Friendly and playful, like classmates or friends hanging out. NOT romantic, flirty or dating-like: no "date", "cuddle", "soulmate", "crush", pet names, or compliments on looks.
- Keep every scene in public, social places: the market, stalls, beach, pier, lounge, café, library, arcade. NEVER beds, bedrooms, "in bed", sleepovers or anything intimate — even if someone's answers mention it. Turn it into the actual activity instead (e.g. "bed-rotting" → "lazy days with shows or games").
- Don't force a vibe word. Only call someone cozy, chill, etc. if THEY used that word. Mirror their own words and energy.
- Vary your wording; don't repeat the same adjective across lines.
Examples:
  BAD:  "Up for a cozy bed scrolling sesh together?"
  GOOD: "Wait, you watch crochet videos too? Which creator?"
  BAD:  "You two would make the cutest date at the pier!"
  GOOD: "Race you to the arcade — loser buys skewers!"
  BAD:  "{a} loves bed rotting all weekend."
  GOOD: "{a} is a pro at slow weekends full of shows."`;

/** Words that never belong in generated dialogue (romance/intimacy/bed). */
const BANNED = /\b(beds?|bedrooms?|sleepovers?|dates?|dating|cuddl\w*|soulmates?|flirt\w*|kiss\w*|romantic|romance|crush(?:es|ing)?|babe|darling|sweetheart)\b/i;
const COZY = /\bco[sz]y\b/i;

/** Does this person use "cozy"/"cosy" themselves (in quotes taken from their own answers)? */
export function saysCozy(quotes: readonly (string | null | undefined)[]): boolean {
  return quotes.some((q) => !!q && COZY.test(q));
}

/** Why a generated line breaks the tone rules, or null if it's fine. */
export function toneProblem(text: string, opts: { allowCozy: boolean }): string | null {
  const banned = text.match(BANNED);
  if (banned) return `uses "${banned[0]}" (romantic/bed words are not allowed)`;
  if (!opts.allowCozy && COZY.test(text)) return `says "cozy" but neither person used that word`;
  return null;
}
