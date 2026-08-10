/**
 * Item thumbnail — renders `imageUrl` at the requested pixel size or a
 * placeholder tile when the image is missing. Using a plain <img> (not
 * next/image) because item images come from arbitrary user-supplied URLs
 * we haven't declared in next.config.
 */
type Props = {
  imageUrl: string | null;
  name: string;
  size?: number;
  className?: string;
};

export function ItemThumb({ imageUrl, name, size = 40, className }: Props) {
  const base =
    "flex-none rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 overflow-hidden";
  const style = { width: size, height: size };
  if (!imageUrl) {
    return (
      <div
        className={`${base} ${className ?? ""} flex items-center justify-center text-zinc-400 text-[10px] uppercase tracking-wide`}
        style={style}
        aria-hidden="true"
      >
        {name.slice(0, 2)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`${base} object-cover ${className ?? ""}`}
      style={style}
    />
  );
}
