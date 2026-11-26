// Small presentational building blocks. No state beyond what each one needs.
import { cloneElement, isValidElement, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, FlaskConical, Loader2, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX, XCircle } from "lucide-react";
import type { TrustDecision, Urgency } from "@/domain/types";
import type { StepStatus } from "@/state/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Tone = "neutral" | "ok" | "warn" | "critical" | "info" | "navy";

const TONE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-ink-2 border-line",
  ok: "bg-ok-soft text-ok border-green-200",
  warn: "bg-high-soft text-high border-orange-200",
  critical: "bg-critical-soft text-critical border-red-200",
  info: "bg-info-soft text-info border-blue-200",
  navy: "bg-navy-50 text-navy-800 border-navy-100",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", TONE[tone])}>{children}</span>;
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
  if (status === "running" || status === "pending") return <Loader2 size={size} className="animate-spin text-info" aria-label="Running" />;
  if (status === "waiting") return <CircleDashed size={size} className="text-high" aria-label="Waiting for a person" />;
  return <CircleDashed size={size} className="text-slate-400" aria-label="Not started" />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  busy?: boolean;
}

export function Button({ variant = "secondary", size = "md", busy, className, children, disabled, ...rest }: ButtonProps) {
  const variants = {
    primary: "bg-navy-800 text-white border-navy-800 hover:bg-navy-700",
    secondary: "bg-white text-ink-2 border-[#c3cbd9] hover:bg-slate-50",
    ghost: "bg-transparent text-ink-2 border-transparent hover:bg-slate-100",
    danger: "bg-critical text-white border-critical hover:bg-red-800",
  };
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-[12.5px]" : "px-3.5 py-2 text-[13.5px]",
        variants[variant],
        className,
      )}
    >
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cx("rounded-[10px] border border-line bg-white", padded && "p-5", className)}>{children}</section>;
}

export function CardHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">{icon}{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone = "neutral", icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  const accent = { neutral: "text-ink", ok: "text-ok", warn: "text-high", critical: "text-critical", info: "text-info", navy: "text-navy-800" }[tone];
  return (
    <div className="rounded-[10px] border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
        <span>{label}</span>
        {icon && <span className="text-slate-400" aria-hidden>{icon}</span>}
      </div>
      <div className={cx("tabular mt-1.5 text-[26px] font-semibold leading-none", accent)}>{value}</div>
      {hint && <div className="mt-1.5 text-[12.5px] text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[#c3cbd9] bg-slate-50/60 px-5 py-8 text-center">
      <p className="text-[14px] font-semibold text-ink-2">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-xl text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "critical" | "ok"; title?: string; children: ReactNode }) {
  const tones = { info: "border-blue-200 bg-info-soft text-[#1e3a8a]", warn: "border-orange-200 bg-high-soft text-[#7c2d12]", critical: "border-red-200 bg-critical-soft text-[#7a271a]", ok: "border-green-200 bg-ok-soft text-[#05603a]" };
  return (
    <div className={cx("rounded-lg border px-3.5 py-2.5 text-[13px]", tones[tone])} role={tone === "critical" ? "alert" : "note"}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Th({ children, right, className }: { children?: ReactNode; right?: boolean; className?: string }) {
  return <th scope="col" className={cx("whitespace-nowrap border-b border-line bg-slate-50 px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-ink-2", right ? "text-right" : "text-left", className)}>{children}</th>;
}
export function Td({ children, right, className, colSpan }: { children?: ReactNode; right?: boolean; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cx("border-b border-line px-3 py-2 align-top text-[13px]", right && "tabular whitespace-nowrap text-right", className)}>{children}</td>;
}
export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
      <table aria-label={label} className="w-full border-collapse [&_tbody_tr:last-child_td]:border-b-0">{children}</table>
    </div>
  );
}

export function Modal({ title, children, onClose, footer, wide, tone = "navy" }: { title: string; children: ReactNode; onClose?: () => void; footer?: ReactNode; wide?: boolean; tone?: "navy" | "warn" | "critical" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const bar = { navy: "bg-navy-800", warn: "bg-high", critical: "bg-critical" }[tone];
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onCancel={(event) => { event.preventDefault(); onClose?.(); }}
      className={cx("m-auto w-[min(94vw,var(--w))] max-w-none rounded-xl border border-line bg-white p-0 text-ink shadow-2xl backdrop:bg-navy-950/45", "max-h-[90vh]")}
      style={{ ["--w" as string]: wide ? "980px" : "620px" }}
    >
      <div className={cx("h-1 w-full rounded-t-xl", bar)} />
      <div className="flex max-h-[calc(90vh-4px)] flex-col">
        {/* The heading takes focus first. Enter cannot activate a heading, so a stray Enter confirms nothing. */}
        <h2 id={headingId} tabIndex={-1} autoFocus className="px-6 pt-5 text-[17px] font-semibold outline-none">{title}</h2>
        <div className="scroll-thin overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-slate-50 px-6 py-3.5">{footer}</div>}
      </div>
    </dialog>
  );
}

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
      {error && <span id={`${id}-note`} className="font-semibold text-critical" role="alert">{error}</span>}
    </div>
  );
}

export const inputClass = "w-full rounded-md border border-[#c3cbd9] bg-white px-2.5 py-1.5 text-[13.5px] font-normal text-ink placeholder:text-slate-400";

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
          className={cx("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors", value === tab.id ? "border-navy-800 text-navy-800" : "border-transparent text-muted hover:text-ink")}
        >
          {tab.label}
          {tab.count !== undefined && <span className={cx("rounded-full px-1.5 text-[11px]", tab.alert ? "bg-high-soft text-high" : "bg-slate-100 text-ink-2")}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Meter({ value, tone = "navy" }: { value: number; tone?: "navy" | "ok" | "warn" | "critical" }) {
  const color = { navy: "bg-navy-700", ok: "bg-ok", warn: "bg-high", critical: "bg-critical" }[tone];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx("h-full rounded-full transition-[width] duration-300", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function KeyValue({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5 text-[13px]">
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
