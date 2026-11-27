// Motion primitives. Every animation here is short, eased and optional: with
// prefers-reduced-motion the same components render instantly. Nothing animates a number
// that is not the real value at the end of the animation.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, AnimatePresence, motion, useReducedMotion, type Transition, type Variants } from "framer-motion";

export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const QUICK: Transition = { duration: 0.22, ease: EASE };
export { AnimatePresence, motion };

export function useMotionOff(): boolean {
  return !!useReducedMotion();
}

/** A page: fades and slides in a few pixels, and out again on navigation. */
export function PageTransition({ id, children }: { id: string; children: ReactNode }) {
  const off = useMotionOff();
  return (
    <motion.div
      key={id}
      initial={off ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={off ? undefined : { opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={QUICK}
      className="min-w-0"
    >
      {children}
    </motion.div>
  );
}

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.02 } } };
const item: Variants = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } } };

/** Children enter one after another. Use with <Item>. */
export function Stagger({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "ul" | "ol" }) {
  const off = useMotionOff();
  const Component = motion[as];
  return <Component className={className} variants={off ? undefined : container} initial={off ? false : "hidden"} animate="show">{children}</Component>;
}

export function Item({ children, className, as = "div" }: { children: ReactNode; className?: string; as?: "div" | "li" }) {
  const off = useMotionOff();
  const Component = motion[as];
  return <Component className={className} variants={off ? undefined : item}>{children}</Component>;
}

/** Fades a block in when it mounts and out when it unmounts (inside an AnimatePresence). */
export function Fade({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const off = useMotionOff();
  return (
    <motion.div className={className} initial={off ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={off ? undefined : { opacity: 0, y: -4 }} transition={{ ...QUICK, delay }}>
      {children}
    </motion.div>
  );
}

/** Height animation for expandable rows and panels. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  const off = useMotionOff();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className={className}
          initial={off ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={off ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE }}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A number that counts from its previous value to the new one. The rendered text is
 * always the formatter applied to a real number, and it settles on the exact value.
 */
export function AnimatedNumber({ value, format = (n: number) => String(Math.round(n)), className, duration = 0.8 }: { value: number; format?: (value: number) => string; className?: string; duration?: number }) {
  const off = useMotionOff();
  // Counts up from zero on first mount, then from the previous value on each change.
  const previous = useRef(0);
  const [shown, setShown] = useState(off ? value : 0);
  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (off || from === value || !Number.isFinite(from) || !Number.isFinite(value)) { setShown(value); return; }
    const controls = animate(from, value, { duration, ease: EASE, onUpdate: (latest) => setShown(latest), onComplete: () => setShown(value) });
    return () => controls.stop();
  }, [value, off, duration]);
  // An integer target counts in whole numbers; a fractional one keeps one decimal.
  const display = Number.isInteger(value) ? Math.round(shown) : Math.round(shown * 10) / 10;
  return <span className={className}>{format(display)}</span>;
}

/** A small pulsing dot: something is happening right now. */
export function LiveDot({ tone = "accent", active = true, label }: { tone?: "accent" | "ok" | "critical" | "high" | "info" | "muted"; active?: boolean; label?: string }) {
  const color = { accent: "text-accent", ok: "text-ok", critical: "text-critical", high: "text-high", info: "text-info", muted: "text-faint" }[tone];
  return <span className={`${active ? "rm-pulse" : "inline-block h-2 w-2 rounded-full bg-current"} ${color}`} aria-label={label} role={label ? "img" : undefined} />;
}

/** Scale-and-fade for a popover or panel that appears in place. */
export function Pop({ children, className, origin = "top" }: { children: ReactNode; className?: string; origin?: "top" | "right" | "center" }) {
  const off = useMotionOff();
  const transformOrigin = origin === "top" ? "top center" : origin === "right" ? "top right" : "center";
  return (
    <motion.div
      className={className}
      style={{ transformOrigin }}
      initial={off ? false : { opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={off ? undefined : { opacity: 0, scale: 0.98, y: -2, transition: { duration: 0.1 } }}
      transition={{ duration: 0.18, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
