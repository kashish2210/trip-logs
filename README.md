# ELD Trip Planner

Takes trip details as input and returns a road route with every required stop,
plus a filled-out FMCSA **Driver's Daily Log** for each day of the trip — drawn
line by line, and independently checked against the hours-of-service rules.

Django + DRF on the back, React + TypeScript on the front. No API keys needed.

---

## Quick start

Two terminals. The backend runs in the `venv` conda environment.

**Terminal 1 — backend**

```bash
conda activate venv && cd backend && pip install -r requirements.txt && python manage.py migrate && python manage.py runserver
```

**Terminal 2 — frontend**

```bash
cd frontend && npm install && npm run dev
```

Then open <http://localhost:5173>. The Vite dev server proxies `/api` to
Django on port 8000, so both run on one origin and there are no CORS issues.

On Windows, `scripts\dev.ps1` starts both in one step.

---

## Inputs and outputs

**In:** current location, pickup location, drop-off location, current cycle
used (hours).

**Out:**

- A map of the route with every stop — pickup, drop-off, fuel, 30-minute
  breaks, 10-hour resets, 34-hour restarts — placed at the point on the road
  the driver actually reaches.
- One log sheet per calendar day, with the duty line drawn across the 24-hour
  grid, city/state remarks at each duty change, per-status totals, and the
  70-hour/8-day recap.
- A compliance panel that re-derives every clock from the finished timeline.

---

## Hours-of-service rules

Implemented from the FMCSA *Interstate Truck Driver's Guide to Hours of
Service* (2022) and 49 CFR Part 395.

| Rule | Limit | Citation |
| --- | --- | --- |
| Driving limit | 11 h per shift | 395.3(a)(3) |
| Driving window | 14 h from first work | 395.3(a)(2) |
| Break from driving | 30 min after 8 h cumulative driving | 395.3(a)(3)(ii) |
| Off-duty reset | 10 consecutive h | 395.3(a)(1) |
| On-duty cycle | 70 h / 8 days | 395.3(b)(2) |
| Cycle restart | 34 consecutive h off | 395.3(c) |

Assumptions, as specified in the assessment:

- Property-carrying driver on the 70 hr / 8 day cycle.
- No adverse-driving-conditions exception.
- Fuel stop at least every 1,000 miles (30 min on duty).
- 1 hour on duty at pickup and 1 hour at drop-off.

Two details worth calling out, because they change the output:

- **The 30-minute break may be taken on duty.** §395.3(a)(3)(ii) allows the
  qualifying interruption off duty, on duty, *or* in the sleeper berth, so a
  fuel stop or the hour spent loading satisfies it. The planner does not insert
  a redundant break after one.
- **The 11-hour limit is per shift, not per calendar day.** A single log sheet
  can legitimately show more than 11 hours of driving when it spans the tail of
  one duty period and the start of the next.

The planner is *constructive*: it only ever advances the clock by an amount
every active limit permits, so a compliant schedule falls out by construction.
`check_compliance()` then re-derives all the clocks from the finished timeline,
sharing no state with the generator, so it is a real check rather than a
restatement.

---

## Free services used

No API keys, no accounts.

| Purpose | Service |
| --- | --- |
| Routing | [OSRM](https://project-osrm.org/) demo server |
| Geocoding | [Nominatim](https://nominatim.openstreetmap.org/) |
| Map tiles | OpenStreetMap raster tiles via Leaflet |

Both HTTP upstreams are cached to disk and degrade gracefully:

- Nominatim is rate limited to one request per second (its usage policy) and
  retried once; if it is unreachable, a bundled 29,880-row US city table
  resolves the location offline.
- If OSRM is unreachable, the planner falls back to great-circle legs with a
  detour correction, and the response is flagged `degraded` so the UI says so
  rather than passing an estimate off as a real route.

Location autocomplete and the "City, ST" remarks are served entirely from the
bundled city table — a multi-day trip has a couple of dozen duty changes, and
reverse geocoding those online would add tens of seconds per plan and breach
Nominatim's rate limit.

---

## Layout

```
backend/
  eldcore/settings.py        two caches: in-memory for throttling, disk for geo
  api/
    services/
      hos.py                 the rule engine - pure python, no Django imports
      planner.py             geocode -> route -> simulate -> log sheets
      routing.py             OSRM client + great-circle fallback
      geo.py                 Nominatim client + offline fallback
      places.py              bundled city table, bucketed nearest-neighbour
      cache.py               best-effort cache access
    data/us_cities.csv       29,880 US cities
    tests/                   44 tests
frontend/
  src/
    components/LogSheet.tsx  the FMCSA grid, drawn in SVG
    components/RouteMap.tsx  Leaflet map with the route drawn on
    index.css                six themes as CSS custom properties
```

### Why the plan is stored as JSON

`Trip.plan` is a single JSON column. The plan is derived, immutable output
built from a fixed rule set — normalising it into a dozen tables would buy
nothing but joins. The columns beside it (distance, days, compliance, route
source) are the ones actually worth querying and indexing.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/plan/` | Plan a trip; returns route, timeline, log sheets |
| `GET` | `/api/trips/` | Recent trips |
| `GET` | `/api/trips/{id}/` | One saved plan |
| `GET` | `/api/locations/?q=` | Location autocomplete |
| `GET` | `/api/health/` | Health check |

```bash
curl -X POST http://127.0.0.1:8000/api/plan/ -H "Content-Type: application/json" -d "{\"current_location\":\"Green Bay, WI\",\"pickup_location\":\"Fond du Lac, WI\",\"dropoff_location\":\"Laredo, TX\",\"current_cycle_used\":14}"
```

---

## The log sheet

The grid follows §395.8: four duty rows, 24 hours divided into 15-minute
increments, per-status totals summing to exactly 24.00, and the remarks column
naming the city and state at every change of duty status.

The duty trace is a **single continuous SVG path** — horizontal runs joined by
vertical status changes — revealed by animating `pathLength`, with a nib
travelling along it on the same clock. That is why it looks like one
uninterrupted pen stroke rather than a set of separate lines appearing.

A run of duty changes at the same location is labelled once and the rest keep
only their tick; the labels that remain are dealt into three tiers so any that
are still close sit at different depths. Without that, a busy day renders as a
smear of overlapping text.

Sheets stay drawn once they have been drawn — a sheet that un-drew itself when
scrolled away would also export as an empty grid.

**Themes:** Midnight, Daybreak, Highway, Blueprint, Pine, and Logbook. Every
colour resolves through CSS custom properties, so a theme is one more
`[data-theme]` block and no component hard-codes a colour. The choice persists
to `localStorage` and is applied before first paint to avoid a flash.

**Export:** `↓ PNG` renders each visible sheet to a PNG; `⎙ Print / PDF` uses a
print stylesheet that drops the app chrome and puts one sheet per landscape
page.

---

## Tests

```bash
conda activate venv && cd backend && python manage.py test api
```

44 tests. The rule engine is tested rule by rule (11-hour, 14-hour, 30-minute
break, 10-hour reset, 70/8 cycle, 34-hour restart, fuel intervals), plus log
sheet integrity — every sheet totals exactly 1440 minutes, entries are
contiguous from 00:00 to 24:00, and daily mileage sums to the route total.
Network calls are stubbed, so the suite runs offline and deterministically.

---
## snaps:
<img width="1137" height="841" alt="image" src="https://github.com/user-attachments/assets/87ae0b1a-84e8-4451-b04f-25bf9d78259d" />
<img width="1310" height="796" alt="image" src="https://github.com/user-attachments/assets/8ae0f997-7912-46bc-97cf-92b35170e96f" />
<img width="1302" height="642" alt="image" src="https://github.com/user-attachments/assets/54d2cdf6-d1a8-47fb-9f22-bc92f9eeee95" />
<img width="1291" height="736" alt="image" src="https://github.com/user-attachments/assets/6f71dd73-53cb-459a-a45b-799fb4d9814e" />
<img width="1417" height="875" alt="image" src="https://github.com/user-attachments/assets/b16d30b5-9d08-4b24-a7b6-368cbb1ed6ab" />
<img width="331" height="837" alt="image" src="https://github.com/user-attachments/assets/401fa4fb-f869-42f6-96c5-e9608c9dff2c" />

## Notes and limits

- Times are naive local, treated as the driver's home-terminal time base, which
  is what §395.8(d) requires the RODS grid to use. `USE_TZ` is off deliberately.
- The rolling 70/8 cycle starts from the hours you enter. Without the previous
  eight days of logs there is nothing to roll off, so the planner accumulates
  forward from that figure and forces a 34-hour restart at the limit.
- SQLite by default. `DATABASES` is the only thing to change for Postgres.
- `DEBUG` defaults on for local use. Set `DJANGO_DEBUG=0` and
  `DJANGO_SECRET_KEY` before putting this anywhere public.
