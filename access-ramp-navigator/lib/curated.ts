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
      serves: "Ground–Level 12",
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

  // ---------------------------------------------------------------------
  // TechnologyOne HQ precinct, Fortitude Valley — pitch venue demo data.
  // Real buildings and real OpenStreetMap ids; the access details below are
  // illustrative sample data, not a physical audit.
  // ---------------------------------------------------------------------

  // HQ North Tower — TechnologyOne headquarters, 540 Wickham Street
  "way/58694263": {
    entrance: {
      side: "South-west side, facing Wickham Street",
      level: "Ground floor, level threshold from the footpath",
      door: "Automatic sliding doors, 1.8 m clear opening",
      hours: "6:00 am–7:00 pm weekdays, security access after hours",
    },
    ramp: {
      side: "North-east side, up from the Gipps Street car park",
      rise: "0.62 m vertical rise",
      length: "9.4 m",
      width: "1.8 m clear width",
      slope: "1:15",
      surface: "Textured concrete with contrasting nosing",
      handrails: "Both sides, dual height at 865 mm and 700 mm",
    },
    toilet: {
      level: "Ground floor (accessible toilets on every level)",
      location: "Room G-14, immediately left of the lift lobby",
      features: "Right-hand transfer, 950 mm circulation space, emergency call button",
    },
    lift: {
      location: "Central lift core, 15 m straight ahead from the Wickham Street doors",
      serves: "Ground–Level 11",
      details: "Four cars, 1.1 m doors, braille and tactile controls, audible floor announcements",
    },
    parking: {
      spaces: "4 accessible bays",
      location: "Basement 1, entry from Gipps Street",
      distance: "Direct lift from bay level to reception",
    },
    extras: [
      "Hearing loop at the reception desk",
      "Visitor sign-in screen at 900 mm height",
      "Quiet room available on request at reception",
      "Assistance animals welcome throughout",
    ],
    steps: [
      "Follow Wickham Street with the HQ towers on your right",
      "The step-free entrance is under the awning at the tower link",
      "Reception is straight ahead; the lift core is on your left",
    ],
    surveyedOn: "21 August 2026",
  },

  // HQ South Tower
  "way/58694264": {
    entrance: {
      side: "West side, from the plaza between the two towers",
      level: "Ground floor",
      door: "Manual door with power-assist button at 1.0 m",
      hours: "7:00 am–6:00 pm weekdays",
    },
    ramp: {
      side: "West plaza side, beside the stairs",
      rise: "0.45 m vertical rise",
      length: "7.2 m",
      width: "1.5 m clear width",
      slope: "1:16",
      surface: "Bonded aggregate",
      handrails: "Both sides, with a bottom landing",
    },
    toilet: {
      level: "Level 2",
      location: "Room 2-06, beside the fire stair",
      features: "Left-hand transfer and emergency call cord",
    },
    lift: {
      location: "Plaza lobby, right of the building directory",
      serves: "Ground–Level 6",
      details: "1.0 m doors, tactile controls, no audible announcements",
    },
    parking: {
      spaces: "Shared with North Tower",
      location: "Basement 1, entry from Gipps Street",
      distance: "Use the North Tower bays; step-free link at basement level",
    },
    extras: ["Covered step-free link to North Tower", "Accessible end-of-trip facilities on Basement 1"],
    steps: [
      "Enter the plaza from Wickham Street",
      "Keep left past the water feature",
      "The ramp is beside the stairs on the plaza side",
    ],
    surveyedOn: "21 August 2026",
  },

  // Emporium
  "way/58694266": {
    entrance: {
      side: "North side, Ann Street frontage",
      level: "Ground floor, level entry",
      door: "Automatic sliding doors, 1.7 m opening",
      hours: "Retail 9:00 am–6:00 pm; hotel lobby 24 hours",
    },
    ramp: null,
    toilet: {
      level: "Level 1",
      location: "Beside the centre management office",
      features: "Right-hand transfer, adult change facility and emergency alarm",
    },
    lift: {
      location: "Central atrium",
      serves: "Basement–Level 4",
      details: "Glass car, 1.1 m doors, audible announcements",
    },
    parking: {
      spaces: "6 accessible bays",
      location: "Basement car park, entry from Ann Street",
      distance: "Lift access to all retail levels",
    },
    extras: ["Companion care room on Level 1", "Wheelchair loan at centre management", "Hearing loop at concierge"],
    steps: ["Head north-east to Ann Street", "The level entry is under the main awning", "Lifts are in the central atrium"],
    surveyedOn: "21 August 2026",
  },

  // Coco Republic
  "way/40717416": {
    entrance: {
      side: "South-east side, facing James Street",
      level: "Ground floor",
      door: "Manual double doors, held open during trading hours",
      hours: "10:00 am–5:00 pm",
    },
    ramp: {
      side: "South-east, immediately right of the main doors",
      rise: "0.28 m vertical rise",
      length: "4.6 m",
      width: "1.4 m clear width",
      slope: "1:17",
      surface: "Polished concrete with grip inlay",
      handrails: "One side only — on your left when ascending",
    },
    toilet: {
      level: "Ground floor",
      location: "Rear of the showroom, past the design studio",
      features: "Left-hand transfer; door opens outward into the corridor",
    },
    lift: null,
    parking: {
      spaces: "2 accessible bays",
      location: "James Street, metered",
      distance: "35 m, kerb ramp at the corner",
    },
    extras: ["Wide aisles throughout the showroom", "Seating at intervals"],
    steps: ["Walk south-west along James Street", "The showroom is on your right", "The ramp is right of the main doors"],
    surveyedOn: "21 August 2026",
  },

  // Goodstart Fortitude Valley
  "way/375769756": {
    entrance: {
      side: "West side, from the Brookes Street drop-off",
      level: "Ground floor, level threshold",
      door: "Secure intercom door, call button at 1.0 m",
      hours: "6:30 am–6:30 pm weekdays",
    },
    ramp: {
      side: "West, up from the drop-off bay",
      rise: "0.34 m vertical rise",
      length: "5.5 m",
      width: "1.5 m clear width",
      slope: "1:16",
      surface: "Non-slip rubberised surface",
      handrails: "Both sides, at child and adult height",
    },
    toilet: {
      level: "Ground floor",
      location: "Family room beside the foyer",
      features: "Right-hand transfer, adult and child change tables",
    },
    lift: null,
    parking: {
      spaces: "1 accessible bay plus 2 drop-off bays",
      location: "Brookes Street frontage",
      distance: "12 m to the ramp",
    },
    extras: ["Pram and wheelchair storage in the foyer", "Visual doorbell indicator at reception"],
    steps: ["Follow Brookes Street to the drop-off bays", "The ramp starts at the western fence line", "Use the intercom at the top"],
    surveyedOn: "21 August 2026",
  },

  // Brooklyn on Brookes
  "way/375770782": {
    entrance: {
      side: "East side, Brookes Street lobby",
      level: "Ground floor, level from the footpath",
      door: "Intercom-controlled glass door, 0.95 m clear width",
      hours: "Residents 24 hours; visitors via intercom",
    },
    ramp: null,
    toilet: {
      level: "No public accessible toilet",
      location: "Residential building — facilities are within apartments",
      features: "Step-free apartments available on Levels 2 and 5",
    },
    lift: {
      location: "Lobby, right of the mailboxes",
      serves: "Basement–Level 14",
      details: "0.9 m door — narrower than the current standard; measure before relying on it",
    },
    parking: {
      spaces: "2 accessible resident bays",
      location: "Basement, ramp entry from Brookes Street",
      distance: "Lift access from basement to all levels",
    },
    extras: ["Step-free path from the Brookes Street footpath", "Intercom at 1.1 m height"],
    steps: ["Follow Brookes Street north", "The lobby is on the eastern frontage", "Use the intercom to the right of the door"],
    surveyedOn: "21 August 2026",
  },
};
