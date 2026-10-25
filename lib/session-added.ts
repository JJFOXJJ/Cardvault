"use client";

// Cards added in the current "adding session". Kept in sessionStorage so the list survives
// opening a card's details and coming back, and is cleared on Back / going to the main screen.

const KEY = "cv_just_added";
const EVENT = "cv-just-added";

export function getAdded(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable — list just won't persist */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Add a card to the top of the list (newest first). */
export function pushAdded(id: string) {
  write([id, ...getAdded().filter((x) => x !== id)].slice(0, 200));
}

export function setAdded(ids: string[]) {
  write(ids);
}

export function clearAdded() {
  write([]);
}

export function onAddedChange(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
