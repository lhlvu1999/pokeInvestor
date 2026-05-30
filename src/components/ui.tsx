import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({
  className = "",
  children,
  ...rest
}: ComponentProps<"div">) {
  return (
    <div
      className={`rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-card ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard — improved hierarchy                                       */
/* ------------------------------------------------------------------ */

export function StatCard({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-card px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums leading-none tracking-tight">
        {children}
      </div>
      {hint && (
        <div className="text-[11px] text-zinc-500 mt-1.5">{hint}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-10 text-center">
      {icon && (
        <div className="mx-auto mb-3 w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
          {icon}
        </div>
      )}
      <div className="text-base font-medium">{title}</div>
      {description && (
        <p className="text-sm text-zinc-500 mt-1.5 max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 h-10 text-sm font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900";

const buttonVariants = {
  primary:
    "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 focus-visible:ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 dark:focus-visible:ring-zinc-100",
  secondary:
    "border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 focus-visible:ring-zinc-400 shadow-card",
  ghost:
    "hover:bg-zinc-100 dark:hover:bg-zinc-800 focus-visible:ring-zinc-400",
  danger:
    "border border-rose-300 dark:border-rose-800 bg-white dark:bg-zinc-900 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus-visible:ring-rose-500 shadow-card",
} as const;

type Variant = keyof typeof buttonVariants;

export function Button({
  variant = "primary",
  className = "",
  children,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant }) {
  return (
    <button
      className={`${buttonBase} ${buttonVariants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return (
    <Link
      href={href}
      className={`${buttonBase} ${buttonVariants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                          */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  htmlFor,
  hint,
  children,
  error,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-rose-600 dark:text-rose-400">{error}</span>
      ) : hint ? (
        <span className="text-xs text-zinc-500 leading-snug">{hint}</span>
      ) : null}
    </label>
  );
}

const inputBase =
  "h-10 px-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm transition-colors duration-150 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-600 focus:outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10 disabled:opacity-60 disabled:cursor-not-allowed";

export function TextInput(props: ComponentProps<"input">) {
  return <input {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function Select(props: ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={`${inputBase} pr-8 appearance-none bg-no-repeat bg-[length:14px] bg-[position:right_0.625rem_center] bg-[image:url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20fill=%22none%22%20viewBox=%220%200%2020%2020%22%20stroke=%22currentColor%22%20stroke-width=%221.5%22><path%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22%20d=%22m6%208%204%204%204-4%22/></svg>')] ${props.className ?? ""}`}
    />
  );
}

export function Textarea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={`px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm transition-colors duration-150 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 hover:border-zinc-400 dark:hover:border-zinc-600 focus:outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:focus:border-zinc-100 dark:focus:ring-zinc-100/10 resize-y leading-relaxed ${props.className ?? ""}`}
    />
  );
}

/**
 * Styled checkbox replacing the native input's chrome with a square box that
 * picks up the brand color when checked. Use anywhere we'd otherwise use
 * `<input type="checkbox" />`. All native props pass through.
 */
export function Checkbox({
  className = "",
  ...rest
}: ComponentProps<"input">) {
  return (
    <input
      type="checkbox"
      className={`appearance-none w-4 h-4 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-900 transition-colors cursor-pointer
        checked:bg-zinc-900 checked:border-zinc-900 dark:checked:bg-zinc-100 dark:checked:border-zinc-100
        hover:border-zinc-400 dark:hover:border-zinc-500
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900
        relative
        checked:after:content-[''] checked:after:absolute checked:after:left-[3px] checked:after:top-0 checked:after:w-[6px] checked:after:h-[10px] checked:after:border-r-2 checked:after:border-b-2 checked:after:border-white dark:checked:after:border-zinc-900 checked:after:rotate-45
        ${className}`}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Spinner — for inline loading                                        */
/* ------------------------------------------------------------------ */

export function Spinner({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`animate-spin ${className}`}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        opacity="0.2"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
