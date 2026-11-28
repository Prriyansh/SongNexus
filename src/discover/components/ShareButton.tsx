"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

const SHOWN_MS = 2500;

type Props = {
  label: string;
  /** Text to copy; without it, the page's address is shared. */
  text?: string;
  title?: string;
};

/** Shares the page's address (the system's share sheet where there is one), or copies a text. */
export default function ShareButton({ label, text, title }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const share = async () => {
    try {
      const url = window.location.href;
      if (!text && navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: title ?? document.title, url });
        return;
      }
      await navigator.clipboard.writeText(text ?? url);
      setState("copied");
    } catch (error) {
      // Closing the share sheet isn't a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) setState("failed");
    }
  };

  const Icon = state === "copied" ? Check : text ? Copy : Share2;
  const said = state === "copied" ? "Copied" : state === "failed" ? "Couldn’t copy" : label;
  return (
    <button type="button" className="dx-button dx-quiet" onClick={() => void share()}>
      <Icon size={16} aria-hidden="true" />
      <span aria-live="polite">{said}</span>
    </button>
  );
}
