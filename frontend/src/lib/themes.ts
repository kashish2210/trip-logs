export interface Theme {
  id: string;
  name: string;
  blurb: string;
  /** Swatch colours shown in the picker: [background, surface, accent]. */
  swatch: [string, string, string];
  mode: "dark" | "light";
}

export const THEMES: Theme[] = [
  {
    id: "midnight",
    name: "Midnight",
    blurb: "Deep navy with a cyan edge",
    swatch: ["#070b14", "#141d30", "#22d3ee"],
    mode: "dark",
  },
  {
    id: "daybreak",
    name: "Daybreak",
    blurb: "Bright, high-contrast daylight",
    swatch: ["#f4f6fb", "#ffffff", "#2563eb"],
    mode: "light",
  },
  {
    id: "highway",
    name: "Highway",
    blurb: "Amber on asphalt, DOT signage",
    swatch: ["#0b0a08", "#1e1a13", "#fbbf24"],
    mode: "dark",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    blurb: "Technical drawing blues",
    swatch: ["#04182e", "#0a3153", "#7dd3fc"],
    mode: "dark",
  },
  {
    id: "pine",
    name: "Pine",
    blurb: "Low-glare night cab",
    swatch: ["#050f0d", "#10241f", "#34d399"],
    mode: "dark",
  },
  {
    id: "logbook",
    name: "Logbook",
    blurb: "Ink on printed paper",
    swatch: ["#e7e2d6", "#fbf8f1", "#9a3412"],
    mode: "light",
  },
];

const STORAGE_KEY = "eld.theme";
export const DEFAULT_THEME = "midnight";

export function loadTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved;
  } catch {
    /* private mode or storage disabled */
  }
  return DEFAULT_THEME;
}

export function applyTheme(id: string) {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
