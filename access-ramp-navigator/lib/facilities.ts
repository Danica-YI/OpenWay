/**
 * The accessibility features someone can report, and how each one is drawn.
 *
 * This is the single source of truth for the list: the contribution form, the
 * map pins and the API's validation all read it, so a feature cannot be
 * offered in the form but rejected on save.
 */

export type FacilityId = "ramp" | "entrance" | "toilet" | "lift" | "parking" | "door" | "other";

export type Facility = {
  id: FacilityId;
  /** Stored verbatim in the database, so it must stay stable once used. */
  label: string;
  /** Pin fill. Dark enough for a white glyph on top. */
  colour: string;
  /** Stroked paths on a 24x24 grid — no fills, so one glyph suits any pin size. */
  paths: string[];
};

export const FACILITIES: Facility[] = [
  {
    id: "ramp",
    label: "Ramp",
    colour: "#087f73",
    paths: ["M3 20h18", "M3 20 19 8.5", "M19 8.5V20"],
  },
  {
    id: "entrance",
    label: "Accessible entrance",
    colour: "#1f6f9e",
    paths: ["M13.5 3.5h5a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-5", "M4 12h10", "M10.5 8.2 14.2 12l-3.7 3.8"],
  },
  {
    id: "toilet",
    label: "Accessible toilet",
    colour: "#7a4fb0",
    paths: ["M4 3.5h4.5v13H4z", "M8.5 9h11.5v2a5.5 5.5 0 0 1-5.5 5.5h-6", "M6.2 16.5v4h9"],
  },
  {
    id: "lift",
    label: "Lift",
    colour: "#a85f05",
    paths: ["M4.5 3.5h15v17h-15z", "M9.5 14V7.5m-2.2 2.2L9.5 7.5l2.2 2.2", "M14.5 10v6.5m-2.2-2.2 2.2 2.2 2.2-2.2"],
  },
  {
    id: "parking",
    label: "Parking",
    colour: "#2f6d3a",
    paths: ["M8.5 20V4h4.8a4.6 4.6 0 0 1 0 9.2H8.5"],
  },
  {
    id: "door",
    label: "Door",
    colour: "#b03f56",
    paths: ["M6.5 3.5h11v17h-11z", "M14.2 12h.01"],
  },
  {
    id: "other",
    label: "Other",
    colour: "#4a5c68",
    paths: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0", "M12 11.5v4.5", "M12 8h.01"],
  },
];

export const FACILITY_LABELS: string[] = FACILITIES.map((facility) => facility.label);

const FALLBACK = FACILITIES[FACILITIES.length - 1];
const BY_LABEL = new Map(FACILITIES.map((facility) => [facility.label.toLowerCase(), facility]));

/**
 * Categories are stored as free text, so a row saved before this list existed
 * — or by a future version — still has to draw something rather than nothing.
 */
export function facilityFor(category: string | null | undefined): Facility {
  if (!category) return FALLBACK;
  return BY_LABEL.get(category.trim().toLowerCase()) ?? FALLBACK;
}

/** Markup for Leaflet's divIcon, which takes an HTML string rather than JSX. */
export function facilityGlyphMarkup(facility: Facility, size: number): string {
  const paths = facility.paths.map((d) => `<path d="${d}" />`).join("");
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
