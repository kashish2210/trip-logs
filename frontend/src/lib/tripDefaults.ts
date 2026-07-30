import type { TripFormValues } from "../types";
import { nowLocalInput } from "./format";

/**
 * Form defaults and demo trips.
 *
 * These live outside the component file on purpose: a module that exports both
 * a component and plain values breaks React Fast Refresh, so every edit would
 * remount the app and throw away the plan on screen.
 */

export const EMPTY_FORM: TripFormValues = {
  current_location: "",
  pickup_location: "",
  dropoff_location: "",
  current_cycle_used: "0",
  start_datetime: nowLocalInput(),
  driver_name: "",
  carrier_name: "",
  main_office: "",
  truck_number: "",
  trailer_number: "",
  shipper: "",
  commodity: "",
  load_id: "",
  co_driver: "",
};

export interface SampleTrip {
  name: string;
  blurb: string;
  values: Partial<TripFormValues>;
}

export const SAMPLES: SampleTrip[] = [
  {
    name: "Cross-country",
    blurb: "Green Bay → Laredo · multi-day",
    values: {
      current_location: "Green Bay, WI",
      pickup_location: "Fond du Lac, WI",
      dropoff_location: "Laredo, TX",
      current_cycle_used: "14",
      driver_name: "H. Alvarez",
      carrier_name: "Northline Freight",
      main_office: "Green Bay, WI",
      truck_number: "T-4471",
      trailer_number: "TR-9082",
      shipper: "Don's Paper Company",
      commodity: "Paper products",
      load_id: "LD-77120",
    },
  },
  {
    name: "Regional run",
    blurb: "Chicago → Nashville · shorter haul",
    values: {
      current_location: "Chicago, IL",
      pickup_location: "Joliet, IL",
      dropoff_location: "Nashville, TN",
      current_cycle_used: "8",
      driver_name: "R. Okafor",
      carrier_name: "Midwest Haulage",
      main_office: "Chicago, IL",
      truck_number: "T-1180",
      trailer_number: "TR-3345",
      shipper: "Lakeside Distribution",
      commodity: "Packaged goods",
      load_id: "LD-20551",
    },
  },
  {
    name: "Near the cycle limit",
    blurb: "Denver → Atlanta · forces a 34-hour restart",
    values: {
      current_location: "Denver, CO",
      pickup_location: "Colorado Springs, CO",
      dropoff_location: "Atlanta, GA",
      current_cycle_used: "66",
      driver_name: "T. Nakamura",
      carrier_name: "Summit Carriers",
      main_office: "Denver, CO",
      truck_number: "T-2290",
      trailer_number: "TR-6614",
      shipper: "Rocky Mountain Supply",
      commodity: "Machine parts",
      load_id: "LD-31884",
    },
  },
];
