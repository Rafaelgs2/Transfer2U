"use client";
import { useEffect } from "react";
import { sound, unlockAudio } from "@/lib/sound";

const TYPING_KEYS = new Set(["Backspace", "Enter", "Delete"]);

/** Page-wide paper feel: typing and button sounds, plus the rollers that turn as you scroll. */
export function PaperFx() {
  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;
    let lastRustle = 0;

    const onKey = (e: KeyboardEvent) => {
      unlockAudio();
      const t = e.target;
      const typing = t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type !== "radio");
      if (typing && !e.repeat && (e.key.length === 1 || TYPING_KEYS.has(e.key))) sound.key();
    };
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest(".btn, .act, .choices label")) sound.press();
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        document.documentElement.style.setProperty("--roll", `${Math.round(y)}px`);
        const now = performance.now();
        if (Math.abs(y - lastY) > 24 && now - lastRustle > 450) {
          lastRustle = now;
          sound.rustle();
        }
        lastY = y;
      });
    };

    window.addEventListener("pointerdown", unlockAudio, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("click", onClick, { capture: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", unlockAudio, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
