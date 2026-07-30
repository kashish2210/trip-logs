import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { Stop, TripPlan } from "../types";
import { STOP_META, dateTime, duration, miles } from "../lib/format";

/** Fits the map to the route once the plan changes. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length < 2) return;
    const bounds = L.latLngBounds(points.map(([a, b]) => L.latLng(a, b)));
    map.fitBounds(bounds, { padding: [48, 48], animate: true, duration: 0.9 });
  }, [map, points]);
  return null;
}

/**
 * Draws the route line on with a dash-offset sweep.
 *
 * Leaflet renders vector layers as real SVG paths, so the same
 * stroke-dasharray technique that animates the log sheet works here too.
 */
function DrawnRoute({
  points,
  replayKey,
}: {
  points: [number, number][];
  replayKey: number;
}) {
  const ref = useRef<L.Polyline>(null);

  useEffect(() => {
    const layer = ref.current;
    const el = layer?.getElement() as SVGPathElement | undefined;
    if (!el) return;

    const length = el.getTotalLength?.();
    if (!length || !Number.isFinite(length)) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.strokeDasharray = "";
      el.style.strokeDashoffset = "";
      return;
    }

    el.style.transition = "none";
    el.style.strokeDasharray = `${length}`;
    el.style.strokeDashoffset = `${length}`;
    // Force a reflow so the starting offset is committed before transitioning.
    void el.getBoundingClientRect();
    el.style.transition = "stroke-dashoffset 2.1s cubic-bezier(0.4, 0, 0.2, 1)";
    el.style.strokeDashoffset = "0";
  }, [points, replayKey]);

  return (
    <>
      <Polyline
        positions={points}
        pathOptions={{
          color: "var(--accent)",
          weight: 9,
          opacity: 0.16,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      <Polyline
        ref={ref}
        positions={points}
        pathOptions={{
          color: "var(--accent)",
          weight: 3.4,
          opacity: 1,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
    </>
  );
}

function pinIcon(stop: Stop, index: number, active: boolean) {
  const meta = STOP_META[stop.kind] ?? STOP_META.break;
  const big = stop.kind === "origin" || stop.kind === "pickup" || stop.kind === "dropoff";
  const size = big ? 34 : 26;
  return L.divIcon({
    className: "stop-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <div style="
        position:relative;width:${size}px;height:${size}px;
        display:grid;place-items:center;
        border-radius:999px;
        background:var(--surface);
        border:2px solid ${meta.color};
        box-shadow:0 3px 12px rgb(0 0 0 / .38)${active ? `, 0 0 0 5px color-mix(in oklab, ${meta.color} 30%, transparent)` : ""};
        color:${meta.color};
        font-size:${big ? 14 : 11}px;line-height:1;font-weight:800;
        transition:box-shadow .2s ease;
      ">
        ${big ? meta.icon : `<span style="font-size:10px">${index}</span>`}
      </div>`,
  });
}

interface Props {
  plan: TripPlan;
  activeStop: number | null;
  onSelectStop: (index: number | null) => void;
  replayKey: number;
}

export default function RouteMap({ plan, activeStop, onSelectStop, replayKey }: Props) {
  const [ready, setReady] = useState(false);
  const points = useMemo(
    () => plan.route.geometry.map(([lat, lon]) => [lat, lon] as [number, number]),
    [plan.route.geometry]
  );
  const center = points[Math.floor(points.length / 2)] ?? [39.5, -98.35];

  useEffect(() => {
    // Give the container a tick to size before Leaflet measures it.
    const id = window.setTimeout(() => setReady(true), 40);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[var(--radius)]">
      {ready && (
        <MapContainer
          center={center}
          zoom={5}
          scrollWheelZoom
          className="h-full w-full"
          zoomControl
        >
          <TileLayer
            className="map-tiles"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={18}
          />
          <FitBounds points={points} />
          <DrawnRoute points={points} replayKey={replayKey} />

          {plan.stops.map((stop, i) => (
            <Marker
              key={`${stop.kind}-${stop.arrive}-${i}`}
              position={[stop.lat, stop.lon]}
              icon={pinIcon(stop, i, activeStop === i)}
              eventHandlers={{
                click: () => onSelectStop(i),
                popupclose: () => onSelectStop(null),
              }}
            >
              <Popup>
                <div className="min-w-44">
                  <div className="text-[0.68rem] font-bold uppercase tracking-wider text-subtle">
                    {stop.title}
                  </div>
                  <div className="mt-0.5 text-sm font-semibold text-ink">
                    {stop.location}
                  </div>
                  <dl className="mt-2 space-y-1 text-[0.76rem] text-muted">
                    <div className="flex justify-between gap-4">
                      <dt>Arrive</dt>
                      <dd className="num text-ink">{dateTime(stop.arrive)}</dd>
                    </div>
                    {stop.minutes > 0 && (
                      <div className="flex justify-between gap-4">
                        <dt>Duration</dt>
                        <dd className="num text-ink">{duration(stop.minutes)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <dt>Mile</dt>
                      <dd className="num text-ink">{miles(stop.mile)}</dd>
                    </div>
                  </dl>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      )}

      {plan.route.degraded && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-[500] rounded-lg border border-warning/40 bg-surface/95 px-3 py-2 text-[0.74rem] text-warning shadow-lg backdrop-blur">
          Routing service unavailable — distances are straight-line estimates,
          not road miles.
        </div>
      )}
    </div>
  );
}
