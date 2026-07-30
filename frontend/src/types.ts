/** Shapes returned by the Django API. Mirrors api/services/planner.py. */

export type DutyStatus = "OFF" | "SB" | "D" | "ON";

export interface LogEntry {
  status: DutyStatus;
  status_label: string;
  kind: string;
  label: string;
  /** Minute of day, 0-1440. */
  start: number;
  end: number;
  start_clock: string;
  end_clock: string;
  minutes: number;
  hours: number;
  miles: number;
  location: string;
  lat: number;
  lon: number;
}

export interface LogRemark {
  minute: number;
  clock: string;
  label: string;
  kind: string;
  location: string;
  lat: number | null;
  lon: number | null;
}

export interface LogDay {
  day_index: number;
  day_number: number;
  date: string;
  entries: LogEntry[];
  remarks: LogRemark[];
  totals: Record<DutyStatus, { minutes: number; hours: number }>;
  total_minutes: number;
  miles_driving: number;
  total_mileage: number;
  on_duty_hours: number;
  cycle_used_end: number;
  cycle_available_tomorrow: number;
  carrier_name: string;
  driver_name: string;
  main_office: string;
  truck_number: string;
  trailer_number: string;
  shipper: string;
  commodity: string;
  load_id: string;
  co_driver: string;
}

export interface Stop {
  kind: "origin" | "pickup" | "dropoff" | "fuel" | "break" | "reset" | "restart";
  title: string;
  detail: string;
  location: string;
  lat: number;
  lon: number;
  mile: number;
  arrive: string;
  depart: string;
  minutes: number;
}

export interface Waypoint {
  kind: "origin" | "pickup" | "dropoff";
  title: string;
  label: string;
  lat: number;
  lon: number;
  mile: number;
  source: string;
  at: string | null;
}

export interface Segment {
  status: DutyStatus;
  status_label: string;
  kind: string;
  label: string;
  start: string;
  end: string;
  minutes: number;
  hours: number;
  miles: number;
  odometer: number;
  location: string;
  lat: number;
  lon: number;
}

export interface RouteLeg {
  label: string;
  miles: number;
  minutes: number;
}

export interface RouteInfo {
  geometry: [number, number][];
  total_miles: number;
  total_drive_minutes: number;
  legs: RouteLeg[];
  source: string;
  degraded: boolean;
}

export interface Summary {
  start_datetime: string;
  end_datetime: string;
  elapsed_minutes: number;
  elapsed_hours: number;
  total_miles: number;
  driving_minutes: number;
  on_duty_minutes: number;
  off_duty_minutes: number;
  sleeper_minutes: number;
  days: number;
  fuel_stops: number;
  rest_resets: number;
  short_breaks: number;
  cycle_restarts: number;
  cycle_used_start: number;
  cycle_used_end: number;
  cycle_limit_hours: number;
  cycle_remaining: number;
  average_speed_mph: number;
}

export interface ComplianceIssue {
  rule: string;
  citation: string;
  detail: string;
  at: string;
}

export interface Compliance {
  compliant: boolean;
  issues: ComplianceIssue[];
  rules: { rule: string; citation: string; limit: string }[];
}

export interface TripPlan {
  inputs: {
    current_location: string;
    pickup_location: string;
    dropoff_location: string;
    cycle_used_hours: number;
    start_datetime: string;
  };
  driver: Record<string, string>;
  waypoints: Waypoint[];
  route: RouteInfo;
  segments: Segment[];
  stops: Stop[];
  log_days: LogDay[];
  summary: Summary;
  compliance: Compliance;
  assumptions: string[];
}

export interface PlanResponse {
  id: string | null;
  saved: boolean;
  plan: TripPlan;
}

export interface TripFormValues {
  current_location: string;
  pickup_location: string;
  dropoff_location: string;
  current_cycle_used: string;
  start_datetime: string;
  driver_name: string;
  carrier_name: string;
  main_office: string;
  truck_number: string;
  trailer_number: string;
  shipper: string;
  commodity: string;
  load_id: string;
  co_driver: string;
}

export interface LocationSuggestion {
  label: string;
  lat: number;
  lon: number;
  source: string;
}

export interface LogValidationDay {
  date: string;
  totals: Record<DutyStatus, { minutes: number; hours: number }>;
  total_minutes: number;
  balanced: boolean;
  on_duty_hours: number;
  driving_hours: number;
  cycle_used_end: number;
  cycle_available_tomorrow: number;
}

export interface LogValidation {
  compliant: boolean;
  issues: ComplianceIssue[];
  structural: { date: string; detail: string }[];
  days: LogValidationDay[];
  summary: {
    driving_minutes: number;
    on_duty_minutes: number;
    cycle_used_end: number;
    cycle_remaining: number;
  };
}

/** One span of an edited grid, as the validation endpoint expects it. */
export interface LogEntryPayload {
  status: DutyStatus;
  start: number;
  end: number;
  kind?: string;
  label?: string;
}

export interface LogDayPayload {
  date: string;
  entries: LogEntryPayload[];
}

export interface TripSummaryRow {
  id: string;
  title: string;
  pickup_location: string;
  dropoff_location: string;
  total_miles: number;
  log_days: number;
  is_compliant: boolean;
  created_at: string;
}
