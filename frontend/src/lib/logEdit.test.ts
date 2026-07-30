import { describe, expect, it } from "vitest";
import type { DutyStatus, LogEntry } from "../types";
import {
  type DutyChange,
  addChange,
  initHistory,
  moveChange,
  normalise,
  pushHistory,
  redo,
  removeChange,
  setStatus,
  snap,
  toChanges,
  toSpans,
  totalsOf,
  tracePath,
  undo,
  updateChange,
} from "./logEdit";
import { MINUTES_PER_DAY } from "./logGeometry";

function change(
  minute: number,
  status: DutyStatus,
  location = ""
): DutyChange {
  return { minute, status, kind: "manual", label: "", location };
}

function entry(status: DutyStatus, start: number, end: number): LogEntry {
  return {
    status,
    status_label: status,
    kind: "drive",
    label: "x",
    start,
    end,
    start_clock: "",
    end_clock: "",
    minutes: end - start,
    hours: (end - start) / 60,
    miles: 0,
    location: "Chicago, IL",
    lat: 0,
    lon: 0,
  };
}

/** The invariant that matters: spans tile the day with no gaps or overlaps. */
function expectTiled(changes: DutyChange[]) {
  const spans = toSpans(changes);
  expect(spans[0].start).toBe(0);
  expect(spans[spans.length - 1].end).toBe(MINUTES_PER_DAY);
  for (let i = 1; i < spans.length; i += 1) {
    expect(spans[i].start).toBe(spans[i - 1].end);
  }
  const total = spans.reduce((sum, s) => sum + s.minutes, 0);
  expect(total).toBe(MINUTES_PER_DAY);
}

describe("normalise", () => {
  it("anchors the first change at midnight", () => {
    const result = normalise([change(300, "D")]);
    expect(result[0].minute).toBe(0);
    expect(result[0].status).toBe("OFF");
    expectTiled(result);
  });

  it("sorts changes given out of order", () => {
    const result = normalise([change(600, "ON"), change(0, "OFF"), change(300, "D")]);
    expect(result.map((c) => c.minute)).toEqual([0, 300, 600]);
  });

  it("drops a change to the status already in effect", () => {
    const result = normalise([change(0, "OFF"), change(300, "D"), change(600, "D")]);
    expect(result.map((c) => c.minute)).toEqual([0, 300]);
  });

  it("keeps the later of two changes at the same minute", () => {
    const result = normalise([change(0, "OFF"), change(300, "D"), change(300, "ON")]);
    expect(result).toHaveLength(2);
    expect(result[1].status).toBe("ON");
  });

  it("never returns an empty list", () => {
    const result = normalise([]);
    expect(result).toHaveLength(1);
    expectTiled(result);
  });

  it("clamps a change at or past midnight back inside the day", () => {
    const result = normalise([change(0, "OFF"), change(MINUTES_PER_DAY, "D")]);
    expect(result[result.length - 1].minute).toBeLessThan(MINUTES_PER_DAY);
    expectTiled(result);
  });
});

describe("toChanges / toSpans", () => {
  it("round-trips a day of entries", () => {
    const entries = [entry("OFF", 0, 360), entry("D", 360, 900), entry("SB", 900, 1440)];
    const changes = toChanges(entries);
    const spans = toSpans(changes);
    expect(spans.map((s) => [s.status, s.start, s.end])).toEqual([
      ["OFF", 0, 360],
      ["D", 360, 900],
      ["SB", 900, 1440],
    ]);
    expectTiled(changes);
  });

  it("ignores zero-length entries", () => {
    const changes = toChanges([entry("OFF", 0, 360), entry("D", 360, 360), entry("SB", 360, 1440)]);
    expect(toSpans(changes)).toHaveLength(2);
  });

  it("carries the location through", () => {
    const changes = toChanges([entry("OFF", 0, 1440)]);
    expect(changes[0].location).toBe("Chicago, IL");
  });
});

describe("addChange", () => {
  it("inserts a change in the right place", () => {
    const base = normalise([change(0, "OFF"), change(600, "D")]);
    const result = addChange(base, 300, "ON");
    expect(result.map((c) => c.minute)).toEqual([0, 300, 600]);
    expectTiled(result);
  });

  it("restyles an existing change rather than duplicating the minute", () => {
    const base = normalise([change(0, "OFF"), change(600, "D")]);
    const result = addChange(base, 600, "SB");
    expect(result).toHaveLength(2);
    expect(result[1].status).toBe("SB");
  });

  it("keeps the day tiled however many points are added", () => {
    let result = normalise([change(0, "OFF")]);
    for (const [minute, status] of [
      [120, "ON"],
      [400, "D"],
      [90, "SB"],
      [1200, "OFF"],
      [700, "D"],
    ] as [number, DutyStatus][]) {
      result = addChange(result, minute, status);
      expectTiled(result);
    }
    expect(result.map((c) => c.minute)).toEqual([0, 90, 120, 400, 700, 1200]);
  });
});

describe("moveChange", () => {
  const base = normalise([change(0, "OFF"), change(300, "D"), change(600, "ON")]);

  it("moves a change to a new minute", () => {
    const result = moveChange(base, 1, 420);
    expect(result[1].minute).toBe(420);
  });

  it("refuses to move the midnight anchor", () => {
    expect(moveChange(base, 0, 500)).toBe(base);
  });

  it("holds a change strictly between its neighbours", () => {
    expect(moveChange(base, 1, 5000)[1].minute).toBe(599);
    expect(moveChange(base, 1, -500)[1].minute).toBe(1);
  });

  it("never lets the order invert mid-drag", () => {
    for (const target of [-100, 0, 1, 299, 300, 599, 600, 900, 9999]) {
      const moved = moveChange(base, 1, target);
      expect(moved[1].minute).toBeGreaterThan(moved[0].minute);
      expect(moved[1].minute).toBeLessThan(moved[2].minute);
    }
  });

  it("ignores an out-of-range index", () => {
    expect(moveChange(base, 9, 100)).toBe(base);
  });
});

describe("setStatus / updateChange / removeChange", () => {
  const base = normalise([change(0, "OFF"), change(300, "D"), change(600, "ON")]);

  it("changes a status", () => {
    expect(setStatus(base, 1, "SB")[1].status).toBe("SB");
  });

  it("edits a remark without touching the timing", () => {
    const result = updateChange(base, 1, { location: "Rolla, MO", label: "Fuel" });
    expect(result[1].location).toBe("Rolla, MO");
    expect(result[1].label).toBe("Fuel");
    expect(result[1].minute).toBe(300);
  });

  it("removes a change and lets the previous status run on", () => {
    const result = removeChange(base, 1);
    expect(result.map((c) => c.minute)).toEqual([0, 600]);
    expectTiled(result);
  });

  it("refuses to remove the midnight anchor", () => {
    expect(removeChange(base, 0)).toBe(base);
  });

  it("merges neighbours that match after a removal", () => {
    const changes = normalise([change(0, "OFF"), change(300, "D"), change(600, "OFF")]);
    const result = removeChange(changes, 1);
    expect(result).toHaveLength(1);
    expectTiled(result);
  });
});

describe("totals", () => {
  it("always sum to a full day", () => {
    const changes = normalise([
      change(0, "OFF"),
      change(360, "ON"),
      change(420, "D"),
      change(900, "SB"),
    ]);
    const totals = totalsOf(changes);
    expect(totals.OFF + totals.SB + totals.D + totals.ON).toBe(MINUTES_PER_DAY);
    expect(totals.ON).toBe(60);
    expect(totals.D).toBe(480);
  });
});

describe("snap", () => {
  it("rounds to the nearest step", () => {
    expect(snap(307, 15)).toBe(300);
    expect(snap(308, 15)).toBe(315);
    expect(snap(302, 5)).toBe(300);
  });

  it("passes minutes through at step 1", () => {
    expect(snap(307.4, 1)).toBe(307);
  });
});

describe("tracePath", () => {
  it("draws one continuous stroke through every span", () => {
    const changes = normalise([change(0, "OFF"), change(720, "D")]);
    const path = tracePath(
      toSpans(changes),
      (m) => m / 10,
      (s) => (s === "OFF" ? 0 : 100)
    );
    expect(path).toBe("M 0 0 L 72 0 L 72 100 L 144 100");
  });
});

describe("history", () => {
  it("undoes and redoes", () => {
    let history = initHistory("a");
    history = pushHistory(history, "b");
    history = pushHistory(history, "c");
    expect(history.present).toBe("c");
    history = undo(history);
    expect(history.present).toBe("b");
    history = undo(history);
    expect(history.present).toBe("a");
    history = redo(history);
    expect(history.present).toBe("b");
  });

  it("is a no-op at the ends", () => {
    const history = initHistory("a");
    expect(undo(history).present).toBe("a");
    expect(redo(history).present).toBe("a");
  });

  it("drops the redo stack once a new edit lands", () => {
    let history = pushHistory(initHistory("a"), "b");
    history = undo(history);
    history = pushHistory(history, "c");
    expect(history.future).toHaveLength(0);
    expect(redo(history).present).toBe("c");
  });
});
