import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { suggestLocations } from "../lib/api";
import type { LocationSuggestion } from "../types";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  icon?: string;
}

export default function LocationInput({
  label,
  value,
  onChange,
  placeholder,
  error,
  hint,
  icon,
}: Props) {
  const id = useId();
  const [options, setOptions] = useState<LocationSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  // Suppresses the lookup that would otherwise fire right after a pick.
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }
    const query = value.trim();
    if (query.length < 2) {
      setOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setOptions(await suggestLocations(query, controller.signal));
      } catch {
        setOptions([]); // typeahead is a convenience; free text still works
      }
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function pick(option: LocationSuggestion) {
    justPicked.current = true;
    onChange(option.label);
    setOpen(false);
    setHighlight(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || options.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + options.length) % options.length);
    } else if (event.key === "Enter" && highlight >= 0) {
      event.preventDefault();
      pick(options[highlight]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && options.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        {icon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle"
          >
            {icon}
          </span>
        )}
        <input
          id={id}
          className="field"
          style={icon ? { paddingLeft: "2.1rem" } : undefined}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          aria-expanded={showList}
          aria-controls={showList ? `${id}-list` : undefined}
          role="combobox"
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>

      <AnimatePresence>
        {showList && (
          <motion.ul
            id={`${id}-list`}
            role="listbox"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="card absolute z-30 mt-1.5 max-h-64 w-full overflow-auto p-1"
          >
            {options.map((option, i) => (
              <li key={`${option.label}-${i}`} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(option)}
                  className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    i === highlight ? "bg-surface-3 text-ink" : "text-muted"
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  <span className="num shrink-0 text-[0.68rem] text-subtle">
                    {option.lat.toFixed(2)}, {option.lon.toFixed(2)}
                  </span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-[0.76rem] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[0.76rem] text-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
