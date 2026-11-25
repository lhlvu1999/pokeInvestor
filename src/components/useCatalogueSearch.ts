"use client";

import { useEffect, useState } from "react";
import { searchWords } from "@/lib/calc/catalog_search";
import { searchCatalogue, type CatalogHit } from "@/lib/server/catalog_search";

/**
 * Catalogue matches for what is being typed: waits for a pause in typing and drops
 * an answer that arrives after the text has moved on. Empty when the text is too
 * short, `enabled` is false, or the lookup fails (the form still works without it).
 */
export function useCatalogueSearch(query: string, enabled = true): CatalogHit[] {
  const [state, setState] = useState<{ q: string; hits: CatalogHit[] }>({ q: "", hits: [] });
  const active = enabled && searchWords(query).length > 0;
  const q = query.trim();

  useEffect(() => {
    if (!active) return;
    let stale = false;
    const t = setTimeout(() => {
      searchCatalogue(q)
        .then((hits) => {
          if (!stale) setState({ q, hits });
        })
        .catch(() => {
          if (!stale) setState({ q, hits: [] });
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, active]);

  return active && state.q === q ? state.hits : [];
}
