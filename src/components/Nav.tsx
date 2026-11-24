"use client";

import Link from "next/link";
import { Fragment } from "react";
import { usePathname } from "next/navigation";

type Section = {
  id: "stock" | "analytics" | "config";
  label: string;
  /** Where clicking the section name takes you when no sub-tab is active. */
  defaultHref: string;
  children: { href: string; label: string; description: string }[];
};

/**
 * Pages that belong to STOCK but are reached by an action button instead of
 * a tab: "Add" is the header button, "Import" lives on the History page.
 * Listed so the STOCK section stays selected while you are on them.
 */
const ACTION_PAGES: Record<string, Section["id"]> = {
  "/transactions": "stock",
  "/import": "stock",
  "/stock-count": "stock",
  "/catalog/links": "stock",
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
      {
        href: "/",
        label: "Dashboard",
        description:
          "What needs attention, how you're doing, and where the money went",
      },
      {
        href: "/items",
        label: "Items",
        description:
          "Every product you track, with stock, cost and market price",
      },
      {
        href: "/watchlist",
        label: "Watchlist",
        description: "Products you want to buy, with creator sentiment",
      },
      {
        href: "/offer",
        label: "Offer",
        description: "Price a block of stock for a buyer and mark it sold",
      },
      {
        href: "/share",
        label: "Share",
        description:
          "Send a read-only snapshot of what you hold, with what you paid kept private",
      },
      {
        href: "/history",
        label: "History",
        description: "Every transaction, newest first",
      },
    ],
  },
  {
    id: "analytics",
    label: "ANALYTICS",
    defaultHref: "/analytics",
    children: [
      {
        href: "/analytics",
        label: "Analytics",
        description: "Open positions, price movers and returns",
      },
      {
        href: "/analytics/returns",
        label: "Returns",
        description: "Yearly return on each position, from a starting point you choose",
      },
      {
        href: "/analytics/vs-market",
        label: "Vs market",
        description: "How much of your result is you and how much is the market",
      },
      {
        href: "/analytics/exposure",
        label: "Exposure",
        description: "What your stock is made of, and how far prices like it have moved",
      },
      {
        href: "/analytics/slabs",
        label: "Slabs",
        description: "Your graded slabs against the same card ungraded",
      },
      {
        href: "/analytics/annual",
        label: "Yearly",
        description: "What you sold each year and earned, with a sales download",
      },
      {
        href: "/catalog",
        label: "Sets",
        description:
          "Every English and Japanese set with its value, top cards and sealed prices",
      },
      {
        href: "/catalog/insights",
        label: "Set insights",
        description:
          "Market indexes for sets and sealed products, and how prices age after release",
      },
      {
        href: "/catalog/calendar",
        label: "Calendar",
        description:
          "Sets coming up and just out, with prices and what earlier launches did",
      },
      {
        href: "/sources",
        label: "Sources",
        description: "YouTube channels the pipeline reads",
      },
      {
        href: "/insights",
        label: "Insights",
        description: "What creators are saying about products you hold",
      },
      {
        href: "/ask",
        label: "Ask",
        description: "Ask questions about your portfolio in plain English",
      },
    ],
  },
  {
    id: "config",
    label: "CONFIG",
    defaultHref: "/settings",
    children: [
      {
        href: "/settings",
        label: "Settings",
        description: "Display currency and price sources",
      },
      {
        href: "/admin",
        label: "Admin",
        description: "Pipeline prompts, mentions and maintenance",
      },
    ],
  },
];

function matches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The tab that best fits the URL: the longest matching href wins, so
 * /catalog/insights lights up "Set insights", not its parent "Sets". */
function bestChild(section: Section, pathname: string) {
  let best: Section["children"][number] | undefined;
  for (const child of section.children) {
    if (
      matches(pathname, child.href) &&
      (!best || child.href.length > best.href.length)
    ) {
      best = child;
    }
  }
  return best;
}

/**
 * Determine which section "owns" the current URL. Falls back to STOCK so the
 * sub-nav row never disappears — keeps the header height stable as the user
 * navigates.
 */
function activeSection(pathname: string): Section {
  for (const [href, id] of Object.entries(ACTION_PAGES)) {
    if (matches(pathname, href)) return SECTIONS.find((s) => s.id === id)!;
  }
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
              <span
                aria-hidden
                className="px-2 sm:px-2.5 text-zinc-300 dark:text-zinc-700"
              >
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
  const current = bestChild(section, pathname);
  return (
    <>
      <nav
        aria-label={`${section.label} pages`}
        // min-w-0 + overflow-x-auto: six pills are wider than a phone, so the
        // row scrolls inside its box instead of widening the whole page.
        className="flex min-w-0 items-center gap-0.5 overflow-x-auto text-sm"
      >
        {section.children.map((link) => {
          const isActive = link === current;
          return (
            <Link
              key={link.href}
              href={link.href}
              title={link.description}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 px-3 py-1.5 rounded-md transition-colors duration-150 ${
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
      {/* One line on what this page is for — the job TCG Quant's menu
        descriptions do, without a second row of chrome. */}
      {current && (
        <p className="ml-auto pl-4 hidden xl:block truncate text-xs text-zinc-500">
          {current.description}
        </p>
      )}
    </>
  );
}

/**
 * The one action you do all day: record a buy or a sale. A header button on
 * every page rather than a tab among the page links. Hidden on the form
 * itself, where it would point at the page you are already on.
 */
export function AddTransactionButton() {
  const pathname = usePathname() ?? "/";
  if (matches(pathname, "/transactions/new")) return null;
  return (
    <Link
      href="/transactions/new"
      aria-label="Add transaction"
      title="Add transaction"
      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 sm:px-3"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span className="hidden sm:inline">Add</span>
    </Link>
  );
}
