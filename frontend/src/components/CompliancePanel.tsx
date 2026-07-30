import { motion } from "framer-motion";
import type { TripPlan } from "../types";
import { DUTY_META, dateTime, duration } from "../lib/format";

export default function CompliancePanel({ plan }: { plan: TripPlan }) {
  const { compliance, summary } = plan;
  const ok = compliance.compliant;

  const split = [
    { status: "D" as const, minutes: summary.driving_minutes },
    { status: "ON" as const, minutes: summary.on_duty_minutes },
    { status: "SB" as const, minutes: summary.sleeper_minutes },
    { status: "OFF" as const, minutes: summary.off_duty_minutes },
  ];
  const total = split.reduce((sum, s) => sum + s.minutes, 0) || 1;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Hours of service</p>
            <h3 className="mt-1 text-base font-bold text-ink">
              Rules applied to this trip
            </h3>
          </div>
          <span
            className="chip"
            style={{
              borderColor: ok ? "var(--success)" : "var(--danger)",
              color: ok ? "var(--success)" : "var(--danger)",
            }}
          >
            {ok ? "✓ Compliant" : "✕ Violations"}
          </span>
        </div>

        <ul className="mt-4 space-y-2">
          {compliance.rules.map((rule, i) => (
            <motion.li
              key={rule.rule}
              initial={{ opacity: 0, x: -6 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-[0.83rem] font-semibold text-ink">
                  {rule.rule}
                </span>
                <span className="block text-[0.7rem] text-subtle">
                  {rule.citation}
                </span>
              </span>
              <span className="num shrink-0 text-[0.8rem] font-bold text-accent">
                {rule.limit}
              </span>
            </motion.li>
          ))}
        </ul>

        {!ok && (
          <ul className="mt-4 space-y-2">
            {compliance.issues.map((issue, i) => (
              <li
                key={i}
                className="rounded-lg border px-3 py-2 text-[0.8rem]"
                style={{
                  borderColor: "color-mix(in oklab, var(--danger) 45%, transparent)",
                  background: "color-mix(in oklab, var(--danger) 10%, transparent)",
                }}
              >
                <span className="font-semibold text-danger">{issue.rule}</span>
                <span className="ml-2 text-muted">{issue.detail}</span>
                <span className="ml-2 text-subtle">at {dateTime(issue.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <p className="eyebrow">Duty split</p>
        <h3 className="mt-1 text-base font-bold text-ink">
          How the {summary.elapsed_hours} hours break down
        </h3>

        <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
          {split.map((s) => (
            <motion.div
              key={s.status}
              initial={{ width: 0 }}
              whileInView={{ width: `${(s.minutes / total) * 100}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              style={{ background: DUTY_META[s.status].color }}
              title={`${DUTY_META[s.status].label}: ${duration(s.minutes)}`}
            />
          ))}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2.5">
          {split.map((s) => (
            <div
              key={s.status}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: DUTY_META[s.status].color }}
              />
              <div className="min-w-0">
                <dt className="truncate text-[0.72rem] text-subtle">
                  {DUTY_META[s.status].line}. {DUTY_META[s.status].label}
                </dt>
                <dd className="num text-[0.86rem] font-bold text-ink">
                  {duration(s.minutes)}
                </dd>
              </div>
            </div>
          ))}
        </dl>

        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3">
          <p className="eyebrow">Planning assumptions</p>
          <ul className="mt-2 space-y-1">
            {plan.assumptions.map((line) => (
              <li key={line} className="flex gap-2 text-[0.76rem] text-muted">
                <span className="text-subtle">·</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
