import type {
  LocationSuggestion,
  LogDayPayload,
  LogValidation,
  PlanResponse,
  TripFormValues,
  TripSummaryRow,
} from "../types";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly fields: Record<string, string[]>;

  constructor(message: string, status: number, fields: Record<string, string[]> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      "Can't reach the planning service. Is the Django server running on port 8000?",
      0
    );
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status}).`;
    let fields: Record<string, string[]> = {};
    try {
      const body = await response.json();
      if (body?.detail) detail = body.detail;
      if (body?.errors && typeof body.errors === "object") fields = body.errors;
    } catch {
      /* non-JSON error body; keep the generic message */
    }
    throw new ApiError(detail, response.status, fields);
  }

  return (await response.json()) as T;
}

export function planTrip(values: TripFormValues, signal?: AbortSignal) {
  const payload: Record<string, unknown> = {
    current_location: values.current_location.trim(),
    pickup_location: values.pickup_location.trim(),
    dropoff_location: values.dropoff_location.trim(),
    current_cycle_used: Number(values.current_cycle_used || 0),
  };
  if (values.start_datetime) payload.start_datetime = values.start_datetime;

  for (const key of [
    "driver_name",
    "carrier_name",
    "main_office",
    "truck_number",
    "trailer_number",
    "shipper",
    "commodity",
    "load_id",
    "co_driver",
  ] as const) {
    const value = values[key]?.trim();
    if (value) payload[key] = value;
  }

  return request<PlanResponse>("/plan/", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
  });
}

export function suggestLocations(query: string, signal?: AbortSignal) {
  return request<LocationSuggestion[]>(
    `/locations/?q=${encodeURIComponent(query)}&limit=7`,
    { signal }
  );
}

export function recentTrips(signal?: AbortSignal) {
  return request<TripSummaryRow[]>("/trips/?limit=6", { signal });
}

/**
 * Re-check hand-edited log sheets.
 *
 * The rules live on the server so the editor and the planner are checked by
 * the same engine; a second copy in the browser would inevitably drift.
 */
export function validateLogs(
  days: LogDayPayload[],
  cycleUsedStart: number,
  signal?: AbortSignal
) {
  return request<LogValidation>("/logs/validate/", {
    method: "POST",
    body: JSON.stringify({ days, cycle_used_start: cycleUsedStart }),
    signal,
  });
}
