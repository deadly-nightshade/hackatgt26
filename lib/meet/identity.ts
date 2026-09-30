/**
 * Browser-side identity: no auth, just the fish id (hackathon).
 * Kept in localStorage AND a long-lived first-party cookie, so it survives if
 * the browser clears one of them (e.g. Safari's storage cleanup). A different
 * browser/app (NFC taps open Safari; home-screen apps and in-app browsers
 * have their own storage) still starts empty: the onboarding page's
 * "I already have a fish" finder recovers it there.
 */
export const FISH_ID_KEY = "fishId";
/** Sent with owner-only requests (PATCH appearance): the hackathon-level "is this you?" check. */
export const FISH_ID_HEADER = "x-fish-id";

const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 400; // browsers cap cookies at ~400 days

function readCookie(): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${FISH_ID_KEY}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function writeCookie(id: string) {
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${FISH_ID_KEY}=${encodeURIComponent(id)}; Max-Age=${COOKIE_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`;
  } catch {
    // ignore
  }
}

export function getFishId(): string | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(FISH_ID_KEY);
  } catch {
    // private mode etc.
  }
  const cookie = readCookie();
  const id = stored || cookie;
  // Heal whichever copy went missing.
  if (id && id !== cookie) writeCookie(id);
  if (id && id !== stored) {
    try {
      localStorage.setItem(FISH_ID_KEY, id);
    } catch {
      // ignore
    }
  }
  return id;
}

export function setFishId(id: string) {
  try {
    localStorage.setItem(FISH_ID_KEY, id);
  } catch {
    // private mode etc. — the cookie may still work
  }
  writeCookie(id);
}

/** Forget this browser's fish (dev "log out"): clears both copies so getFishId() can't heal it back. */
export function clearFishId() {
  try {
    localStorage.removeItem(FISH_ID_KEY);
    localStorage.removeItem("onboarding-draft");
  } catch {
    // ignore
  }
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${FISH_ID_KEY}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  } catch {
    // ignore
  }
}
