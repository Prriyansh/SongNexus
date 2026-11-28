"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** A sideways swipe at least this long, and mostly sideways, moves to the next story. */
export const SWIPE = 60;

type Props = { previous: string | null; next: string | null };

/** Moves between stories with the arrow and page keys, or a swipe on a touch screen. */
export default function StoryKeys({ previous, next }: Props) {
  const router = useRouter();
  useEffect(() => {
    const go = (href: string | null) => {
      if (href) router.push(href, { scroll: false });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if ((event.target as Element).closest?.("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") go(next);
      else if (event.key === "ArrowLeft" || event.key === "PageUp") go(previous);
    };
    let start: { x: number; y: number } | null = null;
    const onDown = (event: PointerEvent) => {
      start = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY };
    };
    const onUp = (event: PointerEvent) => {
      if (!start) return;
      const [dx, dy] = [event.clientX - start.x, event.clientY - start.y];
      start = null;
      if (Math.abs(dx) >= SWIPE && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? next : previous);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  }, [router, previous, next]);
  return null;
}
