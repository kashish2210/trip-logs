import { useState } from "react";
import { motion } from "framer-motion";
import type { TripPlan } from "../types";
import SummaryBar, { RouteLegs } from "./SummaryBar";
import RouteMap from "./RouteMap";
import Itinerary from "./Itinerary";
import CompliancePanel from "./CompliancePanel";
import LogSheets from "./LogSheets";
import { dateTime } from "../lib/format";

export default function ResultsView({
  plan,
  replayKey,
}: {
  plan: TripPlan;
  replayKey: number;
}) {
  const [activeStop, setActiveStop] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="no-print"
      >
        <p className="eyebrow">Trip plan</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink">
          {plan.inputs.pickup_location} → {plan.inputs.dropoff_location}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Departing {dateTime(plan.summary.start_datetime)} · arriving{" "}
          {dateTime(plan.summary.end_datetime)}
        </p>
        <div className="mt-3">
          <RouteLegs plan={plan} />
        </div>
      </motion.header>

      <div className="no-print">
        <SummaryBar plan={plan} />
      </div>

      <div className="no-print grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <div className="card h-[30rem] overflow-hidden p-1.5 lg:h-[34rem]">
          <RouteMap
            plan={plan}
            activeStop={activeStop}
            onSelectStop={setActiveStop}
            replayKey={replayKey}
          />
        </div>
        <div className="h-[30rem] lg:h-[34rem]">
          <Itinerary
            plan={plan}
            activeStop={activeStop}
            onSelectStop={setActiveStop}
          />
        </div>
      </div>

      <div className="no-print">
        <CompliancePanel plan={plan} />
      </div>

      <LogSheets plan={plan} />
    </div>
  );
}
