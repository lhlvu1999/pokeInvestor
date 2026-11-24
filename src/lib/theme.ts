/**
 * Light / dark theme with a manual override.
 *
 * Three preferences: follow the OS ("system", the default), or force
 * "light" / "dark". The page always carries a RESOLVED `data-theme` of
 * "light" or "dark" on <html>; CSS only ever looks at that attribute, so
 * there is one source of truth instead of a media query plus an override.
 *
 * `THEME_INIT_SCRIPT` runs before first paint (inline in <head>) so a saved
 * choice never flashes the wrong colours.
 */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "poke-theme";

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === "system" || v === "light" || v === "dark";
}

export function resolveTheme(
  pref: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (pref === "system") return systemPrefersDark ? "dark" : "light";
  return pref;
}

/** The click order: system → light → dark → system. */
export function nextPreference(pref: ThemePreference): ThemePreference {
  return pref === "system" ? "light" : pref === "light" ? "dark" : "system";
}

export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
};

/**
 * Inline script for <head>. Kept as a string so it can run before React
 * hydrates. It must stay in step with `resolveTheme` above (the tests run
 * this very string against it).
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}})();`;
