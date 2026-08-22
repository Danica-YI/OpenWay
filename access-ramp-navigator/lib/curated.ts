/**
 * Surveyed accessibility profiles, keyed by real OpenStreetMap building id.
 *
 * This is the layer that makes the product worth more than a map: detail no
 * general mapping service carries. In production these records come from a
 * physical access audit. For the prototype they are illustrative sample data
 * attached to genuine QUT Gardens Point buildings.
 */

export type SurveyedProfile = {
  entrance: { side: string; level: string; door: string; hours: string };
  ramp: { side: string; rise: string; length: string; width: string; slope: string; surface: string; handrails: string } | null;
  toilet: { level: string; location: string; features: string };
  lift: { location: string; serves: string; details: string } | null;
  parking: { spaces: string; location: string; distance: string };
  extras: string[];
  steps: string[];
  surveyedOn: string;
};

export const CURATED: Record<string, SurveyedProfile> = {
  // V Block — Gardens Point library
  "way/361650701": {
    entrance: {
      side: "West side, facing the Main Drive lawn",
      level: "Ground floor",
      door: "Automatic double door, 1.6 m clear width",
      hours: "6:00 am–10:00 pm",
    },
    ramp: {
      side: "West lawn side",
      rise: "0.85 m vertical rise",
      length: "12 m",
      width: "1.5 m clear width",
      slope: "1:14",
      surface: "Non-slip concrete",
      handrails: "Both sides, with a midway landing",
    },
    toilet: {
      level: "Level 2",
      location: "Room V2-24, opposite the central lift",
      features: "Right-hand transfer, adult change table and emergency call button",
    },
    lift: {
      location: "Central atrium, 18 m from the west entrance",
      serves: "Ground–Level 5",
      details: "1.1 m door, tactile controls and audible announcements",
    },
    parking: { spaces: "2 accessible bays", location: "West service road", distance: "65 m from the ramp" },
    extras: ["Hearing loop at the help desk", "Low-height service counter", "Assistance animals welcome"],
    steps: ["Follow the Main Drive walkway south", "Turn right at the lawn crossing", "The ramp begins on your left"],
    surveyedOn: "18 August 2026",
  },

  // O Block — student services
  "way/361652184": {
    entrance: {
      side: "East side, Main Drive",
      level: "Ground floor",
      door: "Automatic sliding doors, 1.8 m opening",
      hours: "Open 24 hours",
    },
    ramp: null,
    toilet: {
      level: "Ground floor",
      location: "Beside reception, Room O-08",
      features: "Left-hand transfer, changing bench and emergency alarm",
    },
    lift: { location: "Behind reception", serves: "Ground–Level 4", details: "Wide car with rear mirror and braille controls" },
    parking: { spaces: "3 accessible bays", location: "Main Drive short-stay area", distance: "40 m from entrance" },
    extras: ["Quiet waiting room", "Hearing loop at reception", "Wheelchair-height water fountain"],
    steps: ["Follow Main Drive south", "Use the raised Main Walk crossing", "Continue east to the automatic entrance"],
    surveyedOn: "20 August 2026",
  },

  // P Block — Science and Engineering Centre
  "way/361538625": {
    entrance: {
      side: "North side, facing the Cube plaza",
      level: "Ground floor",
      door: "Power-assisted door with low push button",
      hours: "7:00 am–8:00 pm",
    },
    ramp: {
      side: "North plaza side",
      rise: "1.1 m vertical rise",
      length: "17.6 m",
      width: "1.6 m clear width",
      slope: "1:16",
      surface: "Covered textured concrete",
      handrails: "Both sides with a 1.5 m rest landing",
    },
    toilet: { level: "Level 1", location: "Room P1-12, near the southern lift", features: "Right-hand transfer and emergency call cord" },
    lift: {
      location: "South lobby",
      serves: "Ground–Level 8",
      details: "Tactile controls, audible announcements and a fold-down seat",
    },
    parking: { spaces: "No dedicated bay at building", location: "Use the V Block west bays", distance: "210 m via level path" },
    extras: ["Covered arrival area", "Height-adjustable desks in the ground-floor lab", "Assistance phone at entrance"],
    steps: ["Take the eastern walkway toward the Cube", "Keep right around the plaza", "Join the covered ramp beside the blue sign"],
    surveyedOn: "16 August 2026",
  },

  // U Block
  "way/361674615": {
    entrance: {
      side: "North side, inside the courtyard",
      level: "Ground floor",
      door: "Automatic door, 1.4 m clear opening",
      hours: "7:00 am–9:00 pm",
    },
    ramp: null,
    toilet: {
      level: "Levels 1 and 3",
      location: "Rooms U1-05 and U3-09, beside the lift core",
      features: "Alternating left and right transfer layouts",
    },
    lift: {
      location: "North lobby, 12 m inside the entrance",
      serves: "Ground–Level 5",
      details: "1.2 m door, audible announcements and tactile buttons",
    },
    parking: { spaces: "1 accessible bay", location: "North service court", distance: "55 m from the courtyard entrance" },
    extras: ["Lowered laboratory bench on Level 2", "Visual fire alarms", "Quiet room on Level 1"],
    steps: ["Take the northern level path east", "Turn right into the courtyard", "Use the automatic door; the lift is on the right"],
    surveyedOn: "19 August 2026",
  },

  // X Block — Gardens Theatre
  "way/361501397": {
    entrance: {
      side: "North-east garden side",
      level: "Foyer level",
      door: "Power-assisted single door, 1.05 m clear width",
      hours: "Open during events",
    },
    ramp: {
      side: "Garden side, right of the main steps",
      rise: "1.25 m vertical rise",
      length: "17.5 m",
      width: "1.5 m clear width",
      slope: "1:14",
      surface: "Broom-finished concrete",
      handrails: "Both sides with top and bottom landings",
    },
    toilet: { level: "Foyer level", location: "Behind the accessible ticket desk", features: "Left-hand transfer and emergency call button" },
    lift: null,
    parking: { spaces: "4 accessible bays", location: "Eastern car park", distance: "75 m via the garden path" },
    extras: ["Removable wheelchair seating", "Infrared hearing assistance", "Companion seating beside wheelchair spaces"],
    steps: ["Follow the Main Walk east past the gardens", "Turn left around the building edge", "Continue to the theatre ramp"],
    surveyedOn: "15 August 2026",
  },
};
