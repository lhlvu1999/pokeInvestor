import { describe, expect, it } from "vitest";
import {
  isThemePreference,
  nextPreference,
  resolveTheme,
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
} from "./theme";

describe("theme", () => {
  it("follows the OS only when set to system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("cycles system → light → dark → system", () => {
    expect(nextPreference("system")).toBe("light");
    expect(nextPreference("light")).toBe("dark");
    expect(nextPreference("dark")).toBe("system");
  });

  it("only accepts the three known preferences", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("sepia")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});

/** Run the real inline script against a fake page. */
function runInit(stored: string | null, systemDark: boolean, throws = false) {
  const attrs: Record<string, string> = {};
  const fakeWindow = {
    matchMedia: () => ({ matches: systemDark }),
  };
  const fakeLocalStorage = {
    getItem: (k: string) => {
      if (throws) throw new Error("blocked");
      return k === THEME_STORAGE_KEY ? stored : null;
    },
  };
  const fakeDocument = {
    documentElement: {
      setAttribute: (k: string, v: string) => {
        attrs[k] = v;
      },
    },
  };
  new Function("localStorage", "window", "document", THEME_INIT_SCRIPT)(
    fakeLocalStorage,
    fakeWindow,
    fakeDocument,
  );
  return attrs["data-theme"];
}

describe("THEME_INIT_SCRIPT", () => {
  it("agrees with resolveTheme for every preference and OS setting", () => {
    for (const stored of [null, "system", "light", "dark"] as const) {
      for (const systemDark of [true, false]) {
        const pref = stored ?? "system";
        expect(runInit(stored, systemDark)).toBe(
          resolveTheme(pref, systemDark),
        );
      }
    }
  });

  it("treats a garbage stored value as system", () => {
    expect(runInit("neon", true)).toBe("dark");
    expect(runInit("neon", false)).toBe("light");
  });

  it("falls back to light when storage is blocked", () => {
    expect(runInit(null, true, true)).toBe("light");
  });
});
