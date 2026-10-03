# area-photo-map — living spec

Last updated: 2026-09-28 (step 1: stack + data model)
Status: **design only — nothing implemented yet.**

## What this app is

Mobile-optimized web application that syncs photos from a Google Photos album, caches them
locally, and ties each photo to a precise location. Photos are pinned on a map, organized into
named **areas** (closed polygon outlines built from coordinates), browsable fullscreen by time,
and listed below the map in collapsible per-day batches.

Context: documentation of a house project — garden with a house on it; underground basement
(garage), 1st, 2nd, 3rd floor and roof. Real coordinates exist for the garden and the house
corners.

## Terminology

- **NP** — "nadzemní podlaží" (above-ground floor). Areas are named `1NP`, `2NP`, `3NP`, … never "floor".
- **Area** — a named closed polygon built from a set of coordinate points (GeoJSON Polygon;
  MultiPolygon possible after joins). Areas may nest inside areas (`parent_id`).
- **Photo area** — the single area a photo belongs to: the smallest polygon enclosing its
  point ("encloses most closely"). Manual override wins until reset.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite (SPA) | mobile-first, all interactivity client-side |
| Map | Leaflet + @geoman-io/leaflet-geoman-free + @turf/turf | polygon draw/edit; split/join/translate/measure client-side |
| Backend | Node 22 + Hono, TypeScript | single process serves API + built SPA = one container |
| DB access | postgres.js + hand-written SQL migrations applied at boot | PostGIS-heavy app — nearly every query is ST_*-flavored; an ORM would be bypassed everywhere, so typed query helpers instead |
| Images | sharp (thumb ~320w, preview ~2048w) + exifr (GPS + orientation + timestamps); derivatives served with immutable HTTP cache headers | we process images locally; Google Photos API cannot |
| DB | PostgreSQL 17 + PostGIS 3 | geometry types, `ST_Area` m², `ST_Distance` m, `ST_Covers` containment |
| Deploy | docker compose (`app`, `db`), Traefik labels, external network `proxy` | as requested |
| Auth | none in-app; optional Traefik basic-auth in front | single-user app |

### Google Photos integration

- Photos Library API, scope `photoslibrary.readonly`; OAuth refresh token via one-time consent.
- Sync worker (inside the app process): list media items → download originals once
  (`baseUrl=d`) → sharp generates thumb + preview → exifr extracts GPS/DateTimeOriginal.
- `baseUrl` links expire (~60 min) → local caching on the image volume is mandatory regardless.
- **API limitation:** media items carry no GPS; Google's "approximate location" is not exposed.
  Coordinates come from EXIF of the downloaded original. If absent → no pin until the user sets one.
  `location_label` holds an approximate place name (manual / future reverse-geocode) shown when
  no precise point exists.

## Data model (v1)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE albums (
  id              uuid PRIMARY KEY,
  google_album_id text UNIQUE NOT NULL,
  title           text NOT NULL,
  last_synced_at  timestamptz
);

CREATE TABLE areas (
  id         uuid PRIMARY KEY,
  parent_id  uuid REFERENCES areas(id),
  name       text NOT NULL,
  color      text,
  geom       geometry(Geometry, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX areas_geom_gix ON areas USING GIST (geom);

CREATE TABLE photos (
  id                   uuid PRIMARY KEY,
  album_id             uuid NOT NULL REFERENCES albums(id),
  google_media_item_id text UNIQUE NOT NULL,
  filename             text NOT NULL,
  mime_type            text NOT NULL DEFAULT 'image/jpeg',
  width                integer,
  height               integer,
  taken_at             timestamptz,
  taken_at_source      text,
  author               text,
  gps_point            geometry(Point, 4326),
  point_override       geometry(Point, 4326),
  point                geometry(Point, 4326)
    GENERATED ALWAYS AS (COALESCE(point_override, gps_point)) STORED,
  location_label       text,
  area_id              uuid REFERENCES areas(id),
  area_source          text NOT NULL DEFAULT 'auto',
  original_path        text,
  preview_path         text,
  thumb_path           text,
  bytes                bigint,
  cached_at            timestamptz
);
CREATE INDEX photos_point_gix ON photos USING GIST (point);
CREATE INDEX photos_taken_idx ON photos (taken_at);
```

(`id` = UUIDv7, generated app-side, time-sortable.)

### Behavior rules

- Effective point = `point_override` if set, else `gps_point` (generated column `point`).
- Auto-assign area: smallest polygon containing the point —
  `SELECT a.id FROM areas a WHERE ST_Covers(a.geom, $point) ORDER BY ST_Area(a.geom::geography) LIMIT 1;`
  Recompute on ingest, point edit, and after any area edit. `area_source='manual'` wins until reset.
- Area ops: create from N coordinate points (closed); copy = duplicate + translate by lat/lng
  delta (floors offset below the garden base); split by drawn polyline (Turf polygonize);
  join = Turf union; rename; set color.
- Measurements: area in m² via `ST_Area(geom::geography)`; line distance in meters.
  Measurement lines are ephemeral UI state, not persisted.
- Filters: by area subtree (recursive CTE), by area name across tree ("all kitchens"),
  combinations ("bathroom in 1NP").
- Photos outside every area: `area_id IS NULL`, excluded from area filters, still listed.

## UI (target behavior — not yet built)

- **Map (always visible, top):** area outlines (wireframes), photo pins at `point`. Distinct
  styling for precise (user-set) vs EXIF (Google/EXIF-derived) pins; approximate place name
  shown when no point exists. Tap pin → photo detail.
- **Viewer:** fullscreen, correct orientation; swipe / ← → arrow keys navigate in time
  (left = older, right = newer) **within the photo's area**; swipe up reveals details:
  area, date/time, author; area editable ("pick on map" → tap an area).
- **Photo list (below map, always):** collapsible batches grouped by day (`taken_at`,
  Europe/Prague), ordered ascending; first 5 batches expanded, rest collapsed; thumbs in a
  row of 5 per screen width; tap → fullscreen photo detail.

## Image serving & caching

Lazy loading + local caching, three layers (user-requested):

- **Server cache (from Google):** the sync worker downloads each original exactly once into the
  `images` volume and generates `thumbs/` (~320px) + `previews/` (~2048px) with sharp. After
  that Google is never contacted for a cached photo again.
- **Immutable HTTP caching:** `GET /images/{thumb|preview|original}/<photo-id>` streams from the
  volume with `Cache-Control: public, max-age=31536000, immutable` — derivative files never
  change, so the browser (and any CDN) keeps them locally forever.
- **Lazy loading:** photo list and map load thumbs via native `loading="lazy"`; the fullscreen
  viewer preloads adjacent photos (prev/next) so swiping feels instant.
- Optional later: PWA service worker to keep thumbs available offline on the phone.

## Storage / deployment

- Two containers: `app` (Node 22, serves SPA + API + sync worker) and `db` (postgis/postgis:17-3.5).
- Volumes: `pgdata`, `images` (originals + previews + thumbs; paths stored in DB).
- Traefik: labels on `app` (router rule `Host(${APP_DOMAIN})`, entrypoint `websecure`,
  certresolver from env), attached to external network `proxy`; db on the internal network only.
- No Docker in the local dev environment — the stack is built locally but deployed/verified on
  the Traefik server (`docker compose up -d --build`).
- Backup story: `pg_dump` + image volume.

## Decided / open

Decided: stack above; model v1; one Google album for v1 (`albums` table ready for more);
image bytes on volume (not bytea); measurement lines ephemeral; no in-app auth.

Open (for later steps): confirm Traefik entrypoint/cert-resolver names on the deployment
server; Google OAuth setup flow; handling photos deleted from the album; map tile source
(OSM vs satellite); whether measurement lines should ever persist; initial seeding of
garden/house corner coordinates.

## Steps taken

1. 2026-09-28 — stack + DB model (this file).
2. 2026-09-28 — scaffold: npm-workspaces repo (`server/` Hono + postgres.js, `web/` Vite +
   React), Dockerfile (multi-stage, single `app` container), `docker-compose.yml` (app + db,
   volumes `pgdata`/`images`, Traefik labels on external network `proxy`), migration
   `0001_init.sql` applied at boot, `/api/health`, immutable-cache `/images/:kind/:id` route.
   Verified: `npm install` + both builds pass, dev server boots (`tsx --env-file`).
   Not verified locally (no Docker): container build, migrations-at-boot, Traefik routing —
   these are the deploy-time checks on the server. Next candidate: areas CRUD + map canvas.