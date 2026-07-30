import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { THEMES, applyTheme } from "../lib/themes";

export default function ThemePicker({
  theme,
  onChange,
}: {
  theme: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function select(id: string) {
    applyTheme(id);
    onChange(id);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="btn btn-ghost !px-3 !py-2"
        title="Change theme"
      >
        <Swatch colors={current.swatch} />
        <span className="hidden text-sm sm:inline">{current.name}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-subtle">
          ▾
        </motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="card absolute right-0 z-50 mt-2 w-64 p-1.5"
          >
            {THEMES.map((option) => {
              const active = option.id === theme;
              return (
                <li key={option.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => select(option.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      active ? "bg-accent-soft" : "hover:bg-surface-3"
                    }`}
                  >
                    <Swatch colors={option.swatch} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">
                        {option.name}
                      </span>
                      <span className="block truncate text-[0.72rem] text-subtle">
                        {option.blurb}
                      </span>
                    </span>
                    {active && <span className="text-accent">✓</span>}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function Swatch({ colors }: { colors: [string, string, string] }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-5 w-5 shrink-0 overflow-hidden rounded-full border border-line"
    >
      {colors.map((c, i) => (
        <span key={i} style={{ background: c, width: "33.34%", height: "100%" }} />
      ))}
    </span>
  );
}
