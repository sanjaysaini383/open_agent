// The design system's building blocks. Every colour is a semantic token from index.css,
// so each component follows the dark and light themes. No state beyond what each one
// needs; motion is short and optional.
import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, FlaskConical, Loader2, Search, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX, X, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import type { TrustDecision, Urgency } from "@/domain/types";
import type { StepStatus } from "@/state/types";
import { AnimatedNumber, AnimatePresence, motion, useMotionOff, EASE } from "./motion";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "neutral" | "ok" | "warn" | "critical" | "info" | "navy" | "accent";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2 border-line-strong",
  ok: "bg-ok-soft text-ok-text border-ok/30",
  warn: "bg-high-soft text-high-text border-high/30",
  critical: "bg-critical-soft text-critical-text border-critical/30",
  info: "bg-info-soft text-info-text border-info/30",
  navy: "bg-accent-2-soft text-accent-2-text border-accent-2/30",
  accent: "bg-accent-soft text-accent-text border-accent/30",
};

export function Badge({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold leading-[18px]", TONE[tone], className)}>{children}</span>;
}

export function SimBadge({ label = "Simulated data" }: { label?: string }) {
  return <Badge tone="neutral" title="Demonstration data. No real incident, people, organisations or transactions."><FlaskConical size={12} aria-hidden />{label}</Badge>;
}

export function LiveBadge({ label = "Live cross-origin call" }: { label?: string }) {
  return <Badge tone="info" title="A real network interaction with another origin, made in this browser."><span className="h-1.5 w-1.5 rounded-full bg-info" aria-hidden />{label}</Badge>;
}

const URGENCY_TONE: Record<Urgency, Tone> = { critical: "critical", high: "warn", medium: "neutral", low: "ok" };
export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return <Badge tone={URGENCY_TONE[urgency]}><span className="capitalize">{urgency}</span></Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone: Tone = severity === "critical" ? "critical" : severity === "high" ? "warn" : severity === "moderate" || severity === "medium" ? "neutral" : "ok";
  return <Badge tone={tone}><span className="capitalize">{severity}</span></Badge>;
}

export function TrustBadge({ decision, score }: { decision: TrustDecision | null | undefined; score?: number }) {
  if (!decision) return <Badge tone="neutral"><ShieldQuestion size={12} aria-hidden />Not checked</Badge>;
  const map = {
    verified: { tone: "ok" as Tone, icon: <ShieldCheck size={12} aria-hidden />, label: "Verified" },
    caution: { tone: "warn" as Tone, icon: <ShieldAlert size={12} aria-hidden />, label: "Caution" },
    unverified: { tone: "neutral" as Tone, icon: <ShieldQuestion size={12} aria-hidden />, label: "Unverified" },
    blocked: { tone: "critical" as Tone, icon: <ShieldX size={12} aria-hidden />, label: "Blocked" },
  }[decision];
  return <Badge tone={map.tone}>{map.icon}{map.label}{typeof score === "number" ? ` · ${score}` : ""}</Badge>;
}

export function StatusIcon({ status, size = 16 }: { status: StepStatus | "pending" | "ok" | "declined" | "refused"; size?: number }) {
  if (status === "done" || status === "ok") return <CheckCircle2 size={size} className="text-ok" aria-label="Done" />;
  if (status === "warning") return <AlertTriangle size={size} className="text-high" aria-label="Done with warnings" />;
  if (status === "failed" || status === "declined" || status === "refused") return <XCircle size={size} className="text-critical" aria-label="Failed" />;
  if (status === "running" || status === "pending") return <Loader2 size={size} className="animate-spin text-accent" aria-label="Running" />;
  if (status === "waiting") return <CircleDashed size={size} className="text-high" aria-label="Waiting for a person" />;
  return <CircleDashed size={size} className="text-faint" aria-label="Not started" />;
}

// ---- buttons ---------------------------------------------------------------------

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "xs" | "sm" | "md";
  busy?: boolean;
  /** Brief success or error feedback after an action, shown instead of the children. */
  feedback?: "success" | "error" | null;
}

export function Button({ variant = "secondary", size = "md", busy, feedback, className, children, disabled, ...rest }: ButtonProps) {
  const variants = {
    primary: "btn-primary rm-shine text-accent-ink hover:shadow-glow",
    secondary: "rm-shine bg-surface-3 text-ink border-line-strong hover:bg-surface-4 hover:border-faint",
    outline: "bg-transparent text-ink-2 border-line-strong hover:bg-surface-3",
    ghost: "bg-transparent text-ink-2 border-transparent hover:bg-surface-3 hover:text-ink",
    danger: "rm-shine bg-critical text-white border-critical hover:brightness-110",
  };
  const sizes = { xs: "px-2 py-0.5 text-[11.5px] gap-1", sm: "px-2.5 py-1 text-[12.5px]", md: "px-3.5 py-2 text-[13.5px]" };
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      data-feedback={feedback || undefined}
      className={cx(
        "rm-lift inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-semibold disabled:cursor-not-allowed disabled:opacity-50",
        sizes[size],
        feedback === "success" ? "border-ok/40 bg-ok-soft text-ok-text" : feedback === "error" ? "border-critical/40 bg-critical-soft text-critical-text" : variants[variant],
        className,
      )}
    >
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {feedback === "success" && <Check size={14} aria-hidden />}
      {feedback === "error" && <X size={14} aria-hidden />}
      {children}
    </button>
  );
}

/** Runs an async action from a button and shows loading, then success or error, feedback. */
export function useActionFeedback(): [feedback: "success" | "error" | null, busy: boolean, run: (work: () => Promise<boolean>) => Promise<void>] {
  const [feedback, setFeedback] = useState<"success" | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<boolean>) => {
    setBusy(true);
    let ok = false;
    try { ok = await work(); } catch { ok = false; } finally { setBusy(false); }
    setFeedback(ok ? "success" : "error");
    window.setTimeout(() => setFeedback(null), 1600);
  };
  return [feedback, busy, run];
}

export function IconButton({ label, children, className, size = 32, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; size?: number; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      style={{ width: size, height: size }}
      className={cx("inline-grid shrink-0 place-items-center rounded-md border text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink active:scale-95 disabled:opacity-50", active ? "border-accent/40 bg-accent-soft text-accent-text" : "border-transparent", className)}
    >
      {children}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-mono text-[10.5px] font-semibold text-muted">{children}</kbd>;
}

// ---- tooltip ------------------------------------------------------------------------

/** A description shown on hover and on keyboard focus, and read by screen readers. */
export function Tooltip({ text, children, side = "top", className }: { text: ReactNode; children: ReactNode; side?: "top" | "bottom"; className?: string }) {
  const id = useId();
  const control = isValidElement<Record<string, unknown>>(children) ? cloneElement(children, { "aria-describedby": id }) : children;
  return (
    <span className={cx("group/tip relative inline-flex", className)}>
      {control}
      <span
        role="tooltip"
        id={id}
        className={cx(
          "pointer-events-none absolute left-1/2 z-40 w-max max-w-[260px] -translate-x-1/2 rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[12px] font-medium leading-snug text-ink opacity-0 shadow-pop transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {text}
      </span>
    </span>
  );
}

// ---- surfaces --------------------------------------------------------------------

/** A glass card. It reveals itself as it scrolls into view (once), unless motion is reduced. */
export function Card({ children, className, padded = true, tone, reveal = true }: { children: ReactNode; className?: string; padded?: boolean; tone?: "critical" | "accent" | "warn"; reveal?: boolean }) {
  const off = useMotionOff();
  const edge = tone === "critical" ? "border-critical/40" : tone === "accent" ? "border-accent/40" : tone === "warn" ? "border-high/40" : "border-line";
  const classes = cx("glass glass-hover rounded-[14px] border", edge, padded && "p-5", className);
  if (off || !reveal) return <section className={classes}>{children}</section>;
  return (
    <motion.section className={classes} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px 0px" }} transition={{ duration: 0.45, ease: EASE }}>
      {children}
    </motion.section>
  );
}

export function CardHeader({ title, subtitle, actions, icon, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cx("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">{icon && <span className="text-accent-text" aria-hidden>{icon}</span>}{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-accent-text">{eyebrow}</div>}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-muted">
      {items.map((item, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 && <ChevronRight size={12} aria-hidden className="text-faint" />}
          {item.to ? <Link to={item.to} className="font-semibold hover:text-ink">{item.label}</Link> : <span className="font-semibold text-ink-2" aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  );
}

const STAT_ACCENT: Record<Tone, string> = { neutral: "text-ink", ok: "text-ok-text", warn: "text-high-text", critical: "text-critical-text", info: "text-info-text", navy: "text-accent-2-text", accent: "text-accent-text" };

/**
 * A metric. Pass `number` for an animated counter (the text always ends on the real
 * value); `delta` is a real comparison from state, such as "+3 since assessment".
 */
export function Stat({ label, value, number, format, hint, tone = "neutral", icon, delta, deltaTone = "neutral", className }: {
  label: string; value?: ReactNode; number?: number; format?: (value: number) => string; hint?: ReactNode; tone?: Tone; icon?: ReactNode; delta?: ReactNode; deltaTone?: Tone; className?: string;
}) {
  const deltaColor = { neutral: "text-muted", ok: "text-ok-text", warn: "text-high-text", critical: "text-critical-text", info: "text-info-text", navy: "text-accent-2-text", accent: "text-accent-text" }[deltaTone];
  return (
    <div className={cx("glass glass-hover relative overflow-hidden rounded-[14px] border border-line p-4", className)}>
      {tone !== "neutral" && <span aria-hidden className={cx("absolute inset-x-0 top-0 h-0.5", { ok: "bg-ok", warn: "bg-high", critical: "bg-critical", info: "bg-info", navy: "bg-accent-2", accent: "bg-accent" }[tone])} />}
      <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
        <span>{label}</span>
        {icon && <span className="text-faint" aria-hidden>{icon}</span>}
      </div>
      <div className={cx("tabular mt-1.5 text-[26px] font-semibold leading-none", STAT_ACCENT[tone])}>
        {typeof number === "number" ? <AnimatedNumber value={number} format={format} /> : value}
      </div>
      {(hint || delta) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
          {delta && <span className={cx("font-semibold", deltaColor)}>{delta}</span>}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}

export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface-2/60 px-5 py-8 text-center">
      {icon && <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-surface-3 text-muted" aria-hidden>{icon}</div>}
      <p className="text-[14px] font-semibold text-ink-2">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-xl text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "critical" | "ok"; title?: string; children: ReactNode; className?: string }) {
  const tones = { info: "border-info/30 bg-info-soft text-info-text", warn: "border-high/30 bg-high-soft text-high-text", critical: "border-critical/30 bg-critical-soft text-critical-text", ok: "border-ok/30 bg-ok-soft text-ok-text" };
  return (
    <div className={cx("rounded-lg border px-3.5 py-2.5 text-[13px]", tones[tone], className)} role={tone === "critical" ? "alert" : "note"}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cx(title && "mt-0.5")}>{children}</div>
    </div>
  );
}

export function Skeleton({ className, lines = 1 }: { className?: string; lines?: number }) {
  return (
    <div className={cx("grid gap-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, index) => <div key={index} className="rm-skeleton h-3.5" style={{ width: `${100 - (index % 3) * 18}%` }} />)}
    </div>
  );
}

// ---- tables ------------------------------------------------------------------------

export function Th({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <th scope="col" className={cx("whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-2", right ? "text-right" : "text-left", className)}>{children}</th>;
}
export function Td({ children, right, className, colSpan }: { children?: ReactNode; right?: boolean; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("border-b border-line px-3 py-2 align-top text-[13px]", right && "tabular whitespace-nowrap text-right", className)}>{children}</td>;
}
export function Table({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <div className={cx("scroll-thin overflow-x-auto rounded-lg border border-line", className)}>
      <table aria-label={label} className="w-full border-collapse [&_tbody_tr:hover]:bg-surface-2/70 [&_tbody_tr:last-child_td]:border-b-0">{children}</table>
    </div>
  );
}

export type SortState<K extends string> = { key: K; dir: "asc" | "desc" } | null;

/** Column header that sorts. Click toggles the direction. */
export function SortableTh<K extends string>({ children, sortKey, sort, onSort, right }: { children: ReactNode; sortKey: K; sort: SortState<K>; onSort: (sort: SortState<K>) => void; right?: boolean }) {
  const active = sort?.key === sortKey;
  const next = () => onSort(!active ? { key: sortKey, dir: "asc" } : sort!.dir === "asc" ? { key: sortKey, dir: "desc" } : null);
  return (
    <th scope="col" aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} className={cx("whitespace-nowrap border-b border-line bg-surface-2 px-1 py-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-2", right ? "text-right" : "text-left")}>
      <button type="button" onClick={next} className={cx("inline-flex w-full items-center gap-1 rounded px-2 py-1 hover:bg-surface-3", right && "justify-end", active && "text-accent-text")}>
        {children}
        {active ? (sort!.dir === "asc" ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />) : <ArrowUpDown size={11} aria-hidden className="text-faint" />}
      </button>
    </th>
  );
}

export function useSort<T, K extends string>(rows: T[], accessors: Record<K, (row: T) => string | number | null | undefined>, initial: SortState<K> = null): [T[], SortState<K>, (sort: SortState<K>) => void] {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const get = accessors[sort.key];
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = get(a); const right = get(b);
      if (left === right) return 0;
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;
      return (typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right))) * factor;
    });
  }, [rows, sort, accessors]);
  return [sorted, sort, setSort];
}

export function Pagination({ page, pages, onChange, total, pageSize }: { page: number; pages: number; onChange: (page: number) => void; total?: number; pageSize?: number }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-muted">
      <span>{total !== undefined && pageSize ? `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}` : `Page ${page} of ${pages}`}</span>
      <span className="inline-flex items-center gap-1">
        <IconButton label="Previous page" size={28} disabled={page <= 1} onClick={() => onChange(page - 1)}><ChevronLeft size={15} /></IconButton>
        <span className="tabular px-1 font-semibold text-ink-2">{page} / {pages}</span>
        <IconButton label="Next page" size={28} disabled={page >= pages} onClick={() => onChange(page + 1)}><ChevronRight size={15} /></IconButton>
      </span>
    </nav>
  );
}

export function usePagination<T>(rows: T[], pageSize: number): { rows: T[]; page: number; pages: number; setPage: (page: number) => void } {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  return { rows: rows.slice((current - 1) * pageSize, current * pageSize), page: current, pages, setPage };
}

export function SearchInput({ value, onChange, placeholder = "Search", label = "Search", className }: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string; className?: string }) {
  return (
    <label className={cx("relative block", className)}>
      <span className="sr-only">{label}</span>
      <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
      <input className={cx(inputClass, "pl-8 pr-7")} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value && <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-ink"><X size={13} /></button>}
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label, size = "sm" }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void; label: string; size?: "xs" | "sm" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-0.5 rounded-md border border-line-strong bg-surface-2 p-0.5">
      {options.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={value === option.id} onClick={() => onChange(option.id)} className={cx("rounded px-2.5 font-semibold transition-colors", size === "xs" ? "py-0.5 text-[11.5px]" : "py-1 text-[12.5px]", value === option.id ? "bg-surface-4 text-ink shadow-card" : "text-muted hover:text-ink")}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---- modal and drawer ----------------------------------------------------------------

export function Modal({ title, children, onClose, footer, wide, tone = "navy" }: { title: string; children: ReactNode; onClose?: () => void; footer?: ReactNode; wide?: boolean; tone?: "navy" | "warn" | "critical" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const off = useMotionOff();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const bar = { navy: "bg-accent", warn: "bg-high", critical: "bg-critical" }[tone];
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onCancel={(event) => { event.preventDefault(); onClose?.(); }}
      className={cx("glass-strong m-auto w-[min(94vw,var(--w))] max-w-none rounded-xl border border-line-strong p-0 text-ink shadow-pop backdrop:bg-[var(--backdrop)] backdrop:backdrop-blur-sm", "max-h-[90vh]")}
      style={{ ["--w" as string]: wide ? "980px" : "620px" }}
    >
      <motion.div initial={off ? false : { opacity: 0, scale: 0.975, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE }}>
        <div className={cx("h-1 w-full rounded-t-xl", bar)} />
        <div className="flex max-h-[calc(90vh-4px)] flex-col">
          <div className="flex items-start justify-between gap-3 px-6 pt-5">
            {/* The heading takes focus first. Enter cannot activate a heading, so a stray Enter confirms nothing. */}
            <h2 id={headingId} tabIndex={-1} autoFocus className="text-[17px] font-semibold outline-none">{title}</h2>
            {onClose && <IconButton label="Close" size={28} onClick={onClose} className="-mr-2 -mt-1"><X size={16} /></IconButton>}
          </div>
          <div className="scroll-thin overflow-y-auto px-6 py-4">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-6 py-3.5">{footer}</div>}
        </div>
      </motion.div>
    </dialog>
  );
}

/** A side panel that slides in from the right. Escape and the backdrop close it. */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  const off = useMotionOff();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) { event.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => headingRef.current?.focus(), 30);
    return () => { document.removeEventListener("keydown", onKey); window.clearTimeout(timer); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button type="button" aria-label="Close panel" onClick={onClose} className="fixed inset-0 z-40 bg-[var(--backdrop)] backdrop-blur-[2px]" initial={off ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="glass-strong fixed inset-y-0 right-0 z-50 flex w-[min(100vw,var(--w))] flex-col border-l border-line-strong text-ink shadow-pop"
            style={{ ["--w" as string]: `${width}px` }}
            initial={off ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={off ? undefined : { x: "100%" }}
            transition={{ duration: 0.26, ease: EASE }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-[16px] font-semibold outline-none">{title}</h2>
                {subtitle && <div className="mt-0.5 text-[12.5px] text-muted">{subtitle}</div>}
              </div>
              <IconButton label="Close panel" onClick={onClose}><X size={16} /></IconButton>
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ---- forms --------------------------------------------------------------------------

/**
 * A labelled form control. The label names the control and nothing else; the hint or the
 * error is attached as its description, so a screen reader hears "Location, edit text,
 * Enter a location" rather than one run-on name.
 */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const id = useId();
  const note = error || hint;
  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, { id, "aria-describedby": note ? `${id}-note` : undefined, "aria-invalid": error ? true : undefined })
    : children;
  return (
    <div className="grid content-start gap-1 text-[12.5px] font-semibold text-ink-2">
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && !error && <span id={`${id}-note`} className="font-normal text-muted">{hint}</span>}
      {error && <span id={`${id}-note`} className="font-semibold text-critical-text" role="alert">{error}</span>}
    </div>
  );
}

export const inputClass = "w-full rounded-md border border-line-strong bg-surface-2 px-2.5 py-1.5 text-[13.5px] font-normal text-ink placeholder:text-faint transition-colors focus:border-accent/60 focus:bg-surface";

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number | string; alert?: boolean }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="scroll-thin flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cx("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors", value === tab.id ? "border-accent text-accent-text" : "border-transparent text-muted hover:text-ink")}
        >
          {tab.label}
          {tab.count !== undefined && <span className={cx("rounded-full px-1.5 text-[11px]", tab.alert ? "bg-high-soft text-high-text" : "bg-surface-3 text-ink-2")}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Meter({ value, tone = "navy", height = 6 }: { value: number; tone?: "navy" | "ok" | "warn" | "critical" | "accent"; height?: number }) {
  const color = { navy: "bg-accent-2", accent: "bg-accent", ok: "bg-ok", warn: "bg-high", critical: "bg-critical" }[tone];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="w-full overflow-hidden rounded-full bg-surface-4" style={{ height }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-[width] duration-500 ease-out", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KeyValue({ items, className }: { items: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5 text-[13px]", className)}>
      {items.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="font-semibold text-muted">{key}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const time = (iso: string | undefined | null): string => {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export const clock = (iso: string): string => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const relative = (iso: string | undefined | null, now = Date.now()): string => {
  if (!iso) return "—";
  const delta = Math.max(0, now - Date.parse(iso));
  if (!Number.isFinite(delta)) return "—";
  if (delta < 45_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} h ago`;
  return time(iso);
};
