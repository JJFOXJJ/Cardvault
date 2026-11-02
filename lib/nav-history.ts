"use client";

// In-app history of screens visited in this tab, so the back button returns to the previous screen.
const KEY = "cv_nav";

function read(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function write(stack: string[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-50))); } catch { /* ignore */ }
}

/** Record that we're now on `url`. Going back to the previous entry pops instead of pushing. */
export function recordVisit(url: string) {
  const stack = read();
  if (stack[stack.length - 1] === url) return;
  if (stack[stack.length - 2] === url) stack.pop(); // browser/OS back gesture
  else stack.push(url);
  write(stack);
}

/** The screen before this one in this tab, if any. Removes the current entry. */
export function popPrevious(): string | null {
  const stack = read();
  stack.pop();
  const prev = stack[stack.length - 1] ?? null;
  write(stack);
  return prev;
}
