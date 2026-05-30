import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SectionNav, SubNav } from "@/components/Nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Poke Investor",
  description: "Simple profit tracker for Pokemon card inventory",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200/80 dark:border-zinc-800 bg-white/85 dark:bg-zinc-950/85 backdrop-blur sticky top-0 z-10">
          {/* Row 1 — brand + top-level sections */}
          <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold tracking-tight"
            >
              <Logo />
              <span>Poke Investor</span>
            </Link>
            <SectionNav />
          </div>
          {/* Row 2 — sub-tabs for the active section */}
          <div className="border-t border-zinc-200/60 dark:border-zinc-800/60">
            <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 h-11 flex items-center">
              <SubNav />
            </div>
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-screen-2xl px-4 sm:px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}

/**
 * Inline SVG glyph. Sized to sit inline with the brand text in the header.
 * Uses currentColor so it picks up dark-mode appropriately.
 */
function Logo() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-zinc-900 dark:text-zinc-100"
    >
      <rect
        x="2.5"
        y="2.5"
        width="19"
        height="19"
        rx="5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7 16 11 10 14 13 17 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
