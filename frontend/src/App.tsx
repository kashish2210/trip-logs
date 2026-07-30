import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import TripForm from "./components/TripForm";
import ResultsView from "./components/ResultsView";
import ThemePicker from "./components/ThemePicker";
import { ApiError, planTrip } from "./lib/api";
import { applyTheme, loadTheme } from "./lib/themes";
import { EMPTY_FORM } from "./lib/tripDefaults";
import type { TripFormValues, TripPlan } from "./types";

export default function App() {
  const [theme, setTheme] = useState(loadTheme);
  const [values, setValues] = useState<TripFormValues>(EMPTY_FORM);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [replayKey, setReplayKey] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await planTrip(values, controller.signal);
      setPlan(response.plan);
      setReplayKey((k) => k + 1);
      window.requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldErrors(e.fields);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [values]);

  return (
    <div className="app-canvas relative min-h-screen">
      <div className="relative z-10">
        <TopBar theme={theme} onTheme={setTheme} />

        <main className="mx-auto w-full max-w-[86rem] px-4 pb-24 sm:px-6">
          <Hero hasPlan={plan !== null} />

          <div className="grid gap-6 lg:grid-cols-[23rem_1fr] xl:grid-cols-[25rem_1fr]">
            <div className="no-print lg:sticky lg:top-20 lg:self-start">
              <TripForm
                values={values}
                onChange={setValues}
                onSubmit={submit}
                loading={loading}
                fieldErrors={fieldErrors}
              />

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: -6, height: 0 }}
                    role="alert"
                    className="mt-3 overflow-hidden"
                  >
                    <p
                      className="rounded-[var(--radius-sm)] border px-3.5 py-2.5 text-[0.82rem]"
                      style={{
                        borderColor:
                          "color-mix(in oklab, var(--danger) 45%, transparent)",
                        background:
                          "color-mix(in oklab, var(--danger) 10%, transparent)",
                        color: "var(--danger)",
                      }}
                    >
                      {error}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div ref={resultsRef} className="min-w-0 scroll-mt-20">
              <AnimatePresence mode="wait">
                {loading && !plan ? (
                  <PlanningSkeleton key="loading" />
                ) : plan ? (
                  <motion.div
                    key="plan"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    {loading && <RefreshingBar />}
                    <ResultsView plan={plan} replayKey={replayKey} />
                  </motion.div>
                ) : (
                  <EmptyState key="empty" />
                )}
              </AnimatePresence>
            </div>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TopBar({ theme, onTheme }: { theme: string; onTheme: (id: string) => void }) {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-line bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[86rem] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-[10px]"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
              color: "var(--accent-ink)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M3 15h4l2.5-6h4l2.5 4.5H21"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="7.5" cy="18" r="1.6" fill="currentColor" />
              <circle cx="17" cy="18" r="1.6" fill="currentColor" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="text-[0.95rem] font-extrabold tracking-tight text-ink">
              ELD Trip Planner
            </p>
            <p className="text-[0.68rem] text-subtle">
              Route &amp; hours-of-service logs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="chip hidden md:inline-flex">
            <span style={{ color: "var(--accent)" }}>●</span>
            70 hr / 8 day · property-carrying
          </span>
          <ThemePicker theme={theme} onChange={onTheme} />
        </div>
      </div>
    </header>
  );
}

function Hero({ hasPlan }: { hasPlan: boolean }) {
  if (hasPlan) return <div className="h-6" />;
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className="no-print py-10 sm:py-14"
    >
      <h1 className="max-w-3xl text-3xl font-extrabold leading-[1.1] tracking-tight text-ink sm:text-5xl">
        Plan the route.
        <br />
        <span
          style={{
            background: "linear-gradient(120deg, var(--accent), var(--accent-2))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Draw the logs.
        </span>
      </h1>
      <p className="mt-4 max-w-xl text-[0.98rem] leading-relaxed text-muted">
        Enter a trip and get a road route with every required stop, plus a
        filled-out FMCSA driver&apos;s daily log for each day — drawn line by
        line, and checked against the hours-of-service rules.
      </p>
    </motion.section>
  );
}

function EmptyState() {
  const points: [string, string][] = [
    [
      "Route with required stops",
      "Fuel every 1,000 miles, breaks and rests placed on real roads.",
    ],
    [
      "A sheet for every day",
      "Long trips produce as many log sheets as they need.",
    ],
    [
      "Checked, not just drawn",
      "Every plan is re-verified against the HOS limits independently.",
    ],
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="card flex min-h-[24rem] flex-col justify-center p-8"
    >
      <div className="mx-auto w-full max-w-md">
        <BlankGrid />
        <p className="mt-6 text-center text-sm text-muted">
          Fill in the trip on the left and the plan appears here.
        </p>
        <ul className="mt-6 space-y-3">
          {points.map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              <span>
                <span className="block text-[0.86rem] font-semibold text-ink">
                  {title}
                </span>
                <span className="block text-[0.8rem] text-subtle">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

/** A quiet nod to the real form: an empty grid with a pen tracing it. */
function BlankGrid() {
  const rows = 4;
  const w = 320;
  const h = 88;
  const rowH = h / rows;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" aria-hidden>
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={h - 1}
        rx={4}
        fill="var(--surface-2)"
        stroke="var(--border)"
      />
      {Array.from({ length: rows - 1 }, (_, i) => (
        <line
          key={i}
          x1={0}
          y1={(i + 1) * rowH}
          x2={w}
          y2={(i + 1) * rowH}
          stroke="var(--border)"
        />
      ))}
      {Array.from({ length: 25 }, (_, i) => (
        <line
          key={`v${i}`}
          x1={(i / 24) * w}
          y1={0}
          x2={(i / 24) * w}
          y2={h}
          stroke="var(--border)"
          opacity={i % 6 === 0 ? 0.9 : 0.35}
        />
      ))}
      <motion.path
        d={`M 0 ${rowH * 0.5} L 70 ${rowH * 0.5} L 70 ${rowH * 3.5} L 120 ${
          rowH * 3.5
        } L 120 ${rowH * 2.5} L 230 ${rowH * 2.5} L 230 ${rowH * 0.5} L ${w} ${
          rowH * 0.5
        }`}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{
          duration: 2.6,
          ease: "easeInOut",
          repeat: Infinity,
          repeatDelay: 1.1,
        }}
      />
    </svg>
  );
}

function PlanningSkeleton() {
  const steps = [
    "Geocoding locations",
    "Routing over the road network",
    "Applying hours-of-service limits",
    "Drawing the daily logs",
  ];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton h-[5.4rem]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="skeleton h-[30rem] lg:h-[34rem]" />
        <div className="skeleton h-[30rem] lg:h-[34rem]" />
      </div>
      <div className="card p-5">
        <ul className="space-y-3">
          {steps.map((step, i) => (
            <motion.li
              key={step}
              initial={{ opacity: 0.3 }}
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.3 }}
              className="flex items-center gap-3 text-sm text-muted"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--accent)" }}
              />
              {step}…
            </motion.li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

function RefreshingBar() {
  return (
    <div className="no-print mb-4 h-0.5 w-full overflow-hidden rounded-full bg-surface-3">
      <motion.div
        className="h-full w-1/3 rounded-full"
        style={{ background: "var(--accent)" }}
        animate={{ x: ["-100%", "300%"] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function Footer() {
  return (
    <footer className="no-print border-t border-line py-6">
      <div className="mx-auto flex w-full max-w-[86rem] flex-wrap items-center justify-between gap-3 px-4 text-[0.74rem] text-subtle sm:px-6">
        <p>
          Rules per the FMCSA{" "}
          <em>Interstate Truck Driver&apos;s Guide to Hours of Service</em> (49
          CFR Part 395).
        </p>
        <p>
          Routing by OSRM · geocoding by Nominatim · map tiles © OpenStreetMap
          contributors
        </p>
      </div>
    </footer>
  );
}
