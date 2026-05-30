"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";

type Section = {
  id: "stock" | "analytics" | "config";
  label: string;
  /** Where clicking the section name takes you when no sub-tab is active. */
  defaultHref: string;
  children: { href: string; label: string }[];
};

/**
 * Two-level navigation. Top row is the three feature areas; bottom row is the
 * children of whichever area the current URL belongs to.
 *
 * Order within each section reflects the most common user flow (look → act →
 * review). Section order goes left-to-right by frequency of use: stock work
 * is daily, analytics is weekly, config is occasional.
 */
const SECTIONS: Section[] = [
  {
    id: "stock",
    label: "STOCK",
    defaultHref: "/",
    children: [
      { href: "/", label: "Dashboard" },
      { href: "/items", label: "Items" },
      { href: "/transactions/new", label: "Add" },
      { href: "/history", label: "History" },
      { href: "/import", label: "Import" },
    ],
  },
  {
    id: "analytics",
    label: "ANALYTICS",
    defaultHref: "/analytics",
    children: [
      { href: "/analytics", label: "Analytics" },
      { href: "/sources", label: "Sources" },
      { href: "/insights", label: "Insights" },
    ],
  },
  {
    id: "config",
    label: "CONFIG",
    defaultHref: "/settings",
    children: [
      { href: "/settings", label: "Settings" },
      { href: "/admin", label: "Admin" },
    ],
  },
];

function matches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Determine which section "owns" the current URL. Falls back to STOCK so the
 * sub-nav row never disappears — keeps the header height stable as the user
 * navigates.
 */
function activeSection(pathname: string): Section {
  for (const section of SECTIONS) {
    for (const child of section.children) {
      if (matches(pathname, child.href)) return section;
    }
  }
  return SECTIONS[0];
}

/**
 * Top-row nav — three feature sections with dot separators. Clicking a
 * section name takes you to its default page (Dashboard, Analytics, Settings).
 * The active section picks up the foreground color; inactive ones are muted.
 */
export function SectionNav() {
  const pathname = usePathname() ?? "/";
  const active = activeSection(pathname);
  return (
    <nav
      aria-label="Sections"
      className="flex items-center gap-0 text-xs tracking-[0.14em] font-medium"
    >
      {SECTIONS.map((section, i) => {
        const isActive = section.id === active.id;
        return (
          <Fragment key={section.id}>
            {i > 0 && (
              <span aria-hidden className="px-2.5 text-zinc-300 dark:text-zinc-700">
                ·
              </span>
            )}
            <Link
              href={section.defaultHref}
              aria-current={isActive ? "true" : undefined}
              className={
                isActive
                  ? "text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
              }
            >
              {section.label}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

/**
 * Sub-row nav — pills for the children of whichever section "owns" the
 * current URL. Stays visible even on Dashboard so the header height doesn't
 * jump as you navigate.
 */
export function SubNav() {
  const pathname = usePathname() ?? "/";
  const section = activeSection(pathname);
  return (
    <nav
      aria-label={`${section.label} pages`}
      className="flex items-center gap-0.5 text-sm"
    >
      {section.children.map((link) => {
        const isActive = matches(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={`px-3 py-1.5 rounded-md transition-colors duration-150 ${
              isActive
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-medium"
                : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
