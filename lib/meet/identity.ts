/** Browser-side identity: no auth, just the fish id in localStorage (hackathon). */
export const FISH_ID_KEY = "fishId";

export function getFishId(): string | null {
  try {
    return localStorage.getItem(FISH_ID_KEY);
  } catch {
    return null;
  }
}

export function setFishId(id: string) {
  try {
    localStorage.setItem(FISH_ID_KEY, id);
  } catch {
    // private mode etc. — the user will just be asked to onboard again
  }
}
