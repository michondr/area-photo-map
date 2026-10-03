CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE albums (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_album_id text UNIQUE NOT NULL,
  title           text NOT NULL,
  last_synced_at  timestamptz
);

CREATE TABLE areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid REFERENCES areas(id) ON DELETE SET NULL,
  name       text NOT NULL,
  color      text,
  geom       geometry(Geometry, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX areas_geom_gix ON areas USING GIST (geom);
CREATE INDEX areas_parent_idx ON areas (parent_id);

CREATE TABLE photos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id             uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
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
  point                geometry(Point, 4326) GENERATED ALWAYS AS (COALESCE(point_override, gps_point)) STORED,
  location_label       text,
  area_id              uuid REFERENCES areas(id) ON DELETE SET NULL,
  area_source          text NOT NULL DEFAULT 'auto',
  original_path        text,
  preview_path         text,
  thumb_path           text,
  bytes                bigint,
  cached_at            timestamptz
);
CREATE INDEX photos_point_gix ON photos USING GIST (point);
CREATE INDEX photos_taken_idx ON photos (taken_at);
CREATE INDEX photos_area_idx ON photos (area_id);