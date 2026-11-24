"use client";

import { usePathname } from "next/navigation";

/** Hides the app header on the login page, where none of it can work yet. */
export function HideOnLogin({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return pathname === "/login" ? null : <>{children}</>;
}
