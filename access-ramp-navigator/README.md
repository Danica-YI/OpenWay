# AccessRamp Navigator

A detailed building-accessibility directory and step-free navigation prototype.

## Features

- Interactive OpenStreetMap with clickable building footprints
- Building accessibility profiles
- Exact accessible entrance side and level
- Ramp rise, length, width, gradient, surface and handrail details
- Accessible toilet floor, room and transfer information
- Lift, accessible parking and other facility details
- Path-following step-free routes
- Search and accessibility filters
- Persistent community accessibility reports
- Clear separation of verified and unverified information
- Responsive desktop and mobile interface

## Requirements

- Node.js 22.13 or newer
- npm
- Internet access for OpenStreetMap tiles

## Run locally

1. Extract the ZIP.
2. Open a terminal in the `access-ramp-navigator` folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Open the address shown in the terminal, normally:

   ```text
   http://localhost:5173
   ```

The local development environment uses a local Cloudflare D1 database. The
contributions table is created automatically when the contribution API is first
used.

## Important files

- `app/page.tsx` — map, building profiles, navigation and contribution UI
- `app/globals.css` — complete responsive visual design
- `app/api/contributions/route.ts` — contribution API
- `db/schema.ts` — persistent database schema
- `drizzle/` — database migrations
- `.openai/hosting.json` — local database binding configuration

## Prototype notice

The building records and routes are demonstration data. Real-world deployment
requires surveyed and verified information, a moderation workflow and a
wheelchair-accessible routing graph.
