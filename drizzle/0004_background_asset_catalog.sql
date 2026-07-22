CREATE TABLE IF NOT EXISTS cp_dance_background_assets (
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  license TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, asset_id)
);

CREATE INDEX IF NOT EXISTS cp_dance_background_assets_owner_created_idx
ON cp_dance_background_assets (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cp_dance_world_background_assets (
  owner_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('bundled', 'bundled-converted', 'generated')),
  scene_id TEXT NOT NULL,
  first_used_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, world_id, asset_id)
);

CREATE INDEX IF NOT EXISTS cp_dance_world_background_assets_lookup_idx
ON cp_dance_world_background_assets (owner_id, world_id, last_used_at DESC);
