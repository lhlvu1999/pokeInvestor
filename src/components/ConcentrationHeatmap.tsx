import Link from "next/link";
import { formatCompactAmount } from "@/lib/currency";
import type { TagRollup } from "@/lib/server/portfolio";

/**
 * Squarified treemap of inventory-cost allocation by tag. Answers
 * "where's my money?" in one glance. Uses the classic squarify
 * algorithm — each rectangle's area is proportional to its share of
 * total invested cost.
 */
export function ConcentrationHeatmap({
  rollup,
  currency,
}: {
  rollup: TagRollup[];
  currency: string;
}) {
  const data = rollup
    .filter((r) => r.inventoryCost > 0)
    .sort((a, b) => b.inventoryCost - a.inventoryCost);

  if (data.length === 0) {
    return (
      <div className="text-sm text-zinc-500">
        No tagged inventory to visualize. Tag some items to see allocation.
      </div>
    );
  }

  const total = data.reduce((s, r) => s + r.inventoryCost, 0);
  const w = 900;
  const h = 300;
  const rects = squarify(
    data.map((r) => ({ value: r.inventoryCost, item: r })),
    { x: 0, y: 0, w, h },
  );

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height="auto"
        preserveAspectRatio="xMidYMid meet"
        className="block"
        style={{ maxHeight: "360px" }}
        role="img"
        aria-label="Portfolio concentration by tag"
      >
        {rects.map((r, i) => {
          const share = r.value / total;
          // Color scale: hotter (more red) as share grows. Log-ish curve so
          // even the smaller ones aren't invisible-blue.
          const intensity = Math.min(1, Math.pow(share * data.length, 0.5));
          const hue = 210 - 160 * intensity; // 210 blue → 50 warm yellow
          const showLabel = r.rect.w > 60 && r.rect.h > 30;
          const showValue = r.rect.w > 80 && r.rect.h > 46;
          const pct = (share * 100).toFixed(0);
          return (
            <Link
              key={r.item.tag}
              href={`/items?tags=${encodeURIComponent(r.item.tag)}`}
            >
              <g>
                <rect
                  x={r.rect.x}
                  y={r.rect.y}
                  width={r.rect.w}
                  height={r.rect.h}
                  fill={`hsl(${hue} 55% 42%)`}
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth={1}
                  className="hover:opacity-90"
                >
                  <title>{`${r.item.tag} — ${formatCompactAmount(r.item.inventoryCost, currency)} (${pct}%) · ${r.item.itemsHeld} held`}</title>
                </rect>
                {showLabel && (
                  <text
                    x={r.rect.x + 6}
                    y={r.rect.y + 16}
                    fill="white"
                    className="text-[12px] font-medium"
                  >
                    {r.item.tag}
                  </text>
                )}
                {showValue && (
                  <>
                    <text
                      x={r.rect.x + 6}
                      y={r.rect.y + 32}
                      fill="rgba(255,255,255,0.85)"
                      className="text-[11px] tabular-nums"
                    >
                      {formatCompactAmount(r.item.inventoryCost, currency)}
                    </text>
                    <text
                      x={r.rect.x + 6}
                      y={r.rect.y + 44}
                      fill="rgba(255,255,255,0.65)"
                      className="text-[10px] tabular-nums"
                    >
                      {pct}%
                    </text>
                  </>
                )}
              </g>
            </Link>
          );
        })}
      </svg>
      <div className="mt-2 text-[11px] text-zinc-500">
        Click a tile to see the items in that tag. Tile area = share of
        inventory value; color intensity emphasizes the biggest positions.
      </div>
    </div>
  );
}

// ─── Squarify algorithm ──────────────────────────────────────────────────

type Rect = { x: number; y: number; w: number; h: number };
type Node<T> = { value: number; item: T };
type Placed<T> = { rect: Rect; value: number; item: T };

/**
 * Bruls et al. "Squarified Treemaps" (2000). Packs nodes into `container`
 * such that rectangle area = value / totalValue * containerArea and the
 * aspect ratios stay close to 1.
 */
function squarify<T>(
  nodes: ReadonlyArray<Node<T>>,
  container: Rect,
): Placed<T>[] {
  if (nodes.length === 0) return [];
  const total = nodes.reduce((s, n) => s + n.value, 0);
  if (total <= 0) return [];
  const scale = (container.w * container.h) / total;
  const scaled = nodes.map((n) => ({ ...n, area: n.value * scale }));
  const out: Placed<T>[] = [];
  layout(scaled, [], container, out);
  return out;
}

type ScaledNode<T> = { value: number; item: T; area: number };

function layout<T>(
  remaining: ScaledNode<T>[],
  current: ScaledNode<T>[],
  free: Rect,
  out: Placed<T>[],
) {
  if (remaining.length === 0 && current.length === 0) return;

  const shortSide = Math.min(free.w, free.h);
  if (remaining.length === 0) {
    placeRow(current, free, out);
    return;
  }

  const [next, ...rest] = remaining;
  const withNext = [...current, next];
  if (
    current.length === 0 ||
    worst(withNext, shortSide) <= worst(current, shortSide)
  ) {
    layout(rest, withNext, free, out);
  } else {
    const consumed = placeRow(current, free, out);
    layout(remaining, [], consumed.rest, out);
  }
}

function worst<T>(row: ScaledNode<T>[], shortSide: number): number {
  const rowArea = row.reduce((s, n) => s + n.area, 0);
  const min = Math.min(...row.map((n) => n.area));
  const max = Math.max(...row.map((n) => n.area));
  const s2 = shortSide * shortSide;
  const w2 = rowArea * rowArea;
  return Math.max((s2 * max) / w2, w2 / (s2 * min));
}

function placeRow<T>(
  row: ScaledNode<T>[],
  free: Rect,
  out: Placed<T>[],
): { rest: Rect } {
  if (row.length === 0) return { rest: free };
  const rowArea = row.reduce((s, n) => s + n.area, 0);
  const horizontal = free.w >= free.h;
  if (horizontal) {
    const rowH = rowArea / free.w;
    let cursor = free.x;
    for (const n of row) {
      const rectW = n.area / rowH;
      out.push({
        rect: { x: cursor, y: free.y, w: rectW, h: rowH },
        value: n.value,
        item: n.item,
      });
      cursor += rectW;
    }
    return {
      rest: { x: free.x, y: free.y + rowH, w: free.w, h: free.h - rowH },
    };
  }
  const rowW = rowArea / free.h;
  let cursor = free.y;
  for (const n of row) {
    const rectH = n.area / rowW;
    out.push({
      rect: { x: free.x, y: cursor, w: rowW, h: rectH },
      value: n.value,
      item: n.item,
    });
    cursor += rectH;
  }
  return {
    rest: { x: free.x + rowW, y: free.y, w: free.w - rowW, h: free.h },
  };
}
