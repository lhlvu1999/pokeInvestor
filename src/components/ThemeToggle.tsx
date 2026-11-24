"use client";

import { useSyncExternalStore } from "react";
import {
  isThemePreference,
  nextPreference,
  resolveTheme,
  THEME_LABELS,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";

const EVENT = "poke-theme-change";

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(v) ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePreference) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", resolveTheme(pref, dark));
}

function subscribe(onChange: () => void) {
  // Re-apply when the OS flips and the choice is "system", and keep other
  // tabs in step.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onOs = () => {
    if (readPreference() === "system") apply("system");
    onChange();
  };
  mq.addEventListener("change", onOs);
  window.addEventListener("storage", onOs);
  window.addEventListener(EVENT, onChange);
  return () => {
    mq.removeEventListener("change", onOs);
    window.removeEventListener("storage", onOs);
    window.removeEventListener(EVENT, onChange);
  };
}

/**
 * One button that cycles Match system → Light → Dark. The saved choice
 * lives in localStorage (read by the inline script in <head> before first
 * paint); a blocked or empty store just means "match system".
 */
export function ThemeToggle() {
  // The server cannot know the saved choice, so it renders "system" and the
  // client corrects it on hydration without a mismatch warning.
  const pref = useSyncExternalStore<ThemePreference>(
    subscribe,
    readPreference,
    () => "system",
  );

  function onClick() {
    const next = nextPreference(pref);
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage blocked: the choice still applies until reload.
    }
    apply(next);
    window.dispatchEvent(new Event(EVENT));
  }

  const label = `Theme: ${THEME_LABELS[pref]}. Switch to ${THEME_LABELS[nextPreference(pref)]}.`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <Icon pref={pref} />
    </button>
  );
}

function Icon({ pref }: { pref: ThemePreference }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (pref === "light")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  if (pref === "dark")
    return (
      <svg {...common}>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
