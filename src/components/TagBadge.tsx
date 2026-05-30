import Link from "next/link";

const TAG_PALETTE = [
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
];

function colorFor(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return TAG_PALETTE[Math.abs(h) % TAG_PALETTE.length];
}

export function TagBadge({
  tag,
  href,
  onRemove,
}: {
  tag: string;
  href?: string;
  onRemove?: () => void;
}) {
  const cls = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${colorFor(
    tag,
  )}`;
  const inner = (
    <>
      <span>{tag}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-60 hover:opacity-100"
          aria-label={`Remove tag ${tag}`}
        >
          ×
        </button>
      )}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`${cls} hover:opacity-80`}>
        {inner}
      </Link>
    );
  }
  return <span className={cls}>{inner}</span>;
}
