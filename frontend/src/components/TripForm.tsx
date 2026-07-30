import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import LocationInput from "./LocationInput";
import type { TripFormValues } from "../types";
import { EMPTY_FORM, SAMPLES } from "../lib/tripDefaults";

interface Props {
  values: TripFormValues;
  onChange: (values: TripFormValues) => void;
  onSubmit: () => void;
  loading: boolean;
  fieldErrors: Record<string, string[]>;
}

export default function TripForm({
  values,
  onChange,
  onSubmit,
  loading,
  fieldErrors,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const [touched, setTouched] = useState(false);

  const set = (key: keyof TripFormValues) => (value: string) =>
    onChange({ ...values, [key]: value });

  const cycle = Number(values.current_cycle_used || 0);
  const cycleInvalid =
    values.current_cycle_used !== "" &&
    (Number.isNaN(cycle) || cycle < 0 || cycle > 70);

  const missing = (key: keyof TripFormValues) =>
    touched && !values[key].trim() ? "Required." : undefined;

  const serverError = (key: string) => fieldErrors[key]?.[0];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (
      !values.current_location.trim() ||
      !values.pickup_location.trim() ||
      !values.dropoff_location.trim() ||
      cycleInvalid
    ) {
      return;
    }
    onSubmit();
  }

  return (
    <form onSubmit={submit} className="card p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">Trip details</p>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-ink">
            Where are you running?
          </h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((sample) => (
            <button
              key={sample.name}
              type="button"
              title={sample.blurb}
              onClick={() => onChange({ ...EMPTY_FORM, ...sample.values })}
              className="chip transition-colors hover:border-accent hover:text-accent"
            >
              {sample.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <LocationInput
            label="Current location"
            icon="◎"
            value={values.current_location}
            onChange={set("current_location")}
            placeholder="Green Bay, WI"
            error={missing("current_location") ?? serverError("current_location")}
          />
        </div>
        <LocationInput
          label="Pickup location"
          icon="↓"
          value={values.pickup_location}
          onChange={set("pickup_location")}
          placeholder="Fond du Lac, WI"
          error={missing("pickup_location") ?? serverError("pickup_location")}
        />
        <LocationInput
          label="Drop-off location"
          icon="⚑"
          value={values.dropoff_location}
          onChange={set("dropoff_location")}
          placeholder="Laredo, TX"
          error={missing("dropoff_location") ?? serverError("dropoff_location")}
        />

        <div>
          <label className="label" htmlFor="cycle">
            Current cycle used (hrs)
          </label>
          <input
            id="cycle"
            className="field num"
            type="number"
            min={0}
            max={70}
            step={0.25}
            value={values.current_cycle_used}
            aria-invalid={cycleInvalid ? "true" : undefined}
            onChange={(e) => set("current_cycle_used")(e.target.value)}
          />
          <CycleMeter hours={cycle} invalid={cycleInvalid} />
        </div>

        <div>
          <label className="label" htmlFor="start">
            Start date &amp; time
          </label>
          <input
            id="start"
            className="field num"
            type="datetime-local"
            value={values.start_datetime}
            onChange={(e) => set("start_datetime")(e.target.value)}
          />
          <p className="mt-1.5 text-[0.76rem] text-subtle">
            Home-terminal local time — the log day starts at midnight.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="mt-5 flex w-full items-center justify-between rounded-lg border border-line bg-surface-2 px-3.5 py-2.5 text-left text-sm text-muted transition-colors hover:border-line-strong hover:text-ink"
      >
        <span>
          <span className="font-semibold">Log sheet header</span>
          <span className="ml-2 text-subtle">
            carrier, driver, vehicle, shipping — optional
          </span>
        </span>
        <motion.span animate={{ rotate: showDetails ? 180 : 0 }} className="text-subtle">
          ▾
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="grid gap-3.5 pt-4 sm:grid-cols-2">
              {(
                [
                  ["driver_name", "Driver name", "H. Alvarez"],
                  ["co_driver", "Co-driver", "None"],
                  ["carrier_name", "Carrier", "Northline Freight"],
                  ["main_office", "Main office address", "Green Bay, WI"],
                  ["truck_number", "Truck / tractor no.", "T-4471"],
                  ["trailer_number", "Trailer no.", "TR-9082"],
                  ["shipper", "Shipper", "Don's Paper Company"],
                  ["commodity", "Commodity", "Paper products"],
                  ["load_id", "Load / Pro no.", "LD-77120"],
                ] as const
              ).map(([key, label, placeholder]) => (
                <div key={key}>
                  <label className="label" htmlFor={key}>
                    {label}
                  </label>
                  <input
                    id={key}
                    className="field"
                    value={values[key]}
                    placeholder={placeholder}
                    onChange={(e) => set(key)(e.target.value)}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button type="submit" disabled={loading} className="btn btn-primary mt-5 w-full">
        {loading ? (
          <>
            <Spinner /> Planning route &amp; drawing logs…
          </>
        ) : (
          <>Plan trip &amp; draw logs</>
        )}
      </button>
    </form>
  );
}

function CycleMeter({ hours, invalid }: { hours: number; invalid: boolean }) {
  const pct = Math.max(0, Math.min(100, (hours / 70) * 100));
  const remaining = Math.max(0, 70 - hours);
  const tone =
    invalid || hours > 70
      ? "var(--danger)"
      : pct > 85
        ? "var(--danger)"
        : pct > 65
          ? "var(--warning)"
          : "var(--success)";
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <motion.div
          className="h-full rounded-full"
          style={{ background: tone }}
          animate={{ width: `${pct}%` }}
          transition={{ type: "spring", stiffness: 180, damping: 24 }}
        />
      </div>
      <p className="mt-1.5 text-[0.76rem] text-subtle">
        {invalid ? (
          <span className="text-danger">Must be between 0 and 70 hours.</span>
        ) : (
          <>
            <span className="num text-muted">{remaining.toFixed(2)} h</span> left
            on the 70-hour / 8-day cycle
          </>
        )}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
