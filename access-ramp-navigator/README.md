# AccessRamp Navigator

Detailed building accessibility information for every building on the map — not
just the handful someone has surveyed.

Click any building and you get one of four things, always clearly labelled:

| Map colour | Meaning |
| --- | --- |
| **Teal** | Surveyed profile — ramp gradients, toilet room numbers, parking bays |
| **Blue** | Mapped in OpenStreetMap — entrances, wheelchair tags, lifts |
| **Amber** | Community reports only — unverified reports from users |
| **Grey, dashed** | No accessibility information yet — with a prompt to add the first detail |

That last state is the point of the product: an unmapped building is not a dead
end, it is the gap we ask people to fill.

## Requirements

- **Node.js 22.13 or newer** — check with `node -v`
- npm
- An internet connection (OpenStreetMap tiles and the Overpass API)

If you use `nvm`, run `nvm use` — the version is pinned in `.nvmrc`.

## Run it

```bash
npm install
npm run dev
```

Open the address printed in the terminal, normally <http://localhost:5173>.
The terminal also prints a Network address you can open on your phone, which is
worth doing since the layout is fully responsive.

That is the whole setup. There is no API key, no `.env` file, and no database to
provision — the local Cloudflare D1 database is created automatically under
`.wrangler/` the first time a contribution is saved.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:generate` | Regenerate Drizzle migrations after editing `db/schema.ts` |

The `sites:*` scripts are the hosting platform's Linux-only deploy pipeline.
Do not run them locally on macOS or Windows — they need `flock`, `sha256sum` and
GNU `timeout`.

## How it fits together

Data arrives in three layers, merged at render time and never blended together
in the UI:

1. **OpenStreetMap**, live, for any building in view.
   `app/api/buildings/route.ts` proxies the Overpass API from the worker, so the
   browser never calls it directly and one cached response serves everyone
   looking at the same place. `lib/osm.ts` turns raw Overpass output into
   building profiles — including **deriving which side each entrance is on** from
   the bearing between the building centre and the entrance node.
2. **Surveyed profiles** in `lib/curated.ts`, keyed by real OpenStreetMap id.
   This is the layer that makes the product worth more than a map. In production
   these come from a physical access audit; here they are illustrative sample
   data attached to genuine QUT Gardens Point buildings.
3. **Community reports** in Cloudflare D1, keyed by OpenStreetMap id so any
   building on Earth can be reported on.

### Important files

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | Map, sidebar, building profile drawer, contribution form |
| `lib/osm.ts` | Overpass queries and OSM tag → accessibility profile logic |
| `lib/curated.ts` | Surveyed profiles, keyed by OSM id |
| `app/api/buildings/route.ts` | Cached OpenStreetMap proxy |
| `app/api/contributions/route.ts` | Community report read/write |
| `app/api/contributions/counts/route.ts` | Report counts, for map colouring |
| `app/globals.css` | The complete responsive design |
| `db/schema.ts` | Database schema |
| `.openai/hosting.json` | Cloudflare binding names — **required for the dev server to start** |

## Moving the demo location

The map opens at `DEFAULT_CENTER` in `app/page.tsx`, with `DEMO_START` as the
stand-in "you are here" pin until a visitor grants location permission. Both are
constants at the top of the file, with the QUT coordinates kept in a comment.

Currently set to the TechnologyOne HQ precinct in Fortitude Valley. Surveyed
profiles exist for both areas, so either works as a demo.

## Adding a surveyed building

1. Find the building on <https://www.openstreetmap.org> and click it.
2. Read its id from the URL, e.g. `.../way/361650701`.
3. Add an entry keyed `"way/361650701"` to `CURATED` in `lib/curated.ts`.

It turns teal on the map immediately. Nothing else needs changing — there is no
second list to keep in sync.

## Resetting the local database

```bash
rm -rf .wrangler
```

The table is recreated on the next contribution.

## Prototype notice

Surveyed profiles are demonstration data. OpenStreetMap data is real but
community-maintained and incomplete. Routes are direct lines, not step-free
routed paths. A real deployment needs surveyed and verified information, a
moderation workflow, and a wheelchair-accessible routing graph.
