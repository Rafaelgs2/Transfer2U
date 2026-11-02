"use client";
import { useSyncExternalStore } from "react";
import { isSoundOn, subscribeSound, toggleSound } from "@/lib/sound";

export function SoundToggle({ className = "" }: { className?: string }) {
  const on = useSyncExternalStore(subscribeSound, isSoundOn, () => true);
  return (
    <button type="button" className={`act ${className}`} aria-pressed={on} onClick={toggleSound}>
      som: {on ? "ligado" : "desligado"}
    </button>
  );
}
