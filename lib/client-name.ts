"use client";

const KEY = "t2u:name";

/** Last display name used on this device (a convenience only; the server is the source of truth). */
export function savedName(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // private mode or blocked storage: the form just asks again next time
  }
}
