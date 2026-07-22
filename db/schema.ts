export const createPixelkinSavesTable = `
  CREATE TABLE IF NOT EXISTS pixelkin_saves (
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('world', 'character')),
    record_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    object_key TEXT NOT NULL,
    PRIMARY KEY (owner_id, kind, record_id)
  )
`;

export const createPixelkinSavesIndex = `
  CREATE INDEX IF NOT EXISTS pixelkin_saves_owner_updated_idx
  ON pixelkin_saves (owner_id, kind, updated_at DESC)
`;

export const createCpDanceSaveRevisionsTable = `
  CREATE TABLE IF NOT EXISTS cp_dance_save_revisions (
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('world', 'character')),
    record_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    object_key TEXT NOT NULL,
    PRIMARY KEY (owner_id, kind, record_id, revision_id)
  )
`;

export const createCpDanceSaveRevisionsIndex = `
  CREATE INDEX IF NOT EXISTS cp_dance_save_revisions_lookup_idx
  ON cp_dance_save_revisions (owner_id, kind, record_id, updated_at DESC)
`;

export const createCpDanceAssetsTable = `
  CREATE TABLE IF NOT EXISTS cp_dance_assets (
    owner_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, asset_id)
  )
`;

export const createCpDanceBackgroundAssetsTable = `
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
  )
`;

export const createCpDanceBackgroundAssetsIndex = `
  CREATE INDEX IF NOT EXISTS cp_dance_background_assets_owner_created_idx
  ON cp_dance_background_assets (owner_id, created_at DESC)
`;

export const createCpDanceWorldBackgroundAssetsTable = `
  CREATE TABLE IF NOT EXISTS cp_dance_world_background_assets (
    owner_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('bundled', 'bundled-converted', 'generated')),
    scene_id TEXT NOT NULL,
    first_used_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, world_id, asset_id)
  )
`;

export const createCpDanceWorldBackgroundAssetsIndex = `
  CREATE INDEX IF NOT EXISTS cp_dance_world_background_assets_lookup_idx
  ON cp_dance_world_background_assets (owner_id, world_id, last_used_at DESC)
`;

export const createCpDanceMemoryDocumentsTable = `
  CREATE TABLE IF NOT EXISTS cp_dance_memory_documents (
    owner_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('general', 'character', 'topic')),
    subject_agent_id TEXT,
    latest_revision_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, world_id, agent_id, document_id)
  )
`;

export const createCpDanceMemoryDocumentsIndex = `
  CREATE INDEX IF NOT EXISTS cp_dance_memory_documents_lookup_idx
  ON cp_dance_memory_documents (owner_id, world_id, agent_id, updated_at DESC)
`;

export const createCpDanceMemoryRevisionsTable = `
  CREATE TABLE IF NOT EXISTS cp_dance_memory_revisions (
    owner_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    base_revision_id TEXT,
    created_turn INTEGER NOT NULL,
    epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('observed', 'inferred', 'rumor')),
    object_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, world_id, agent_id, document_id, revision_id)
  )
`;

export const createCpDanceWorldEventsTable = `
  CREATE TABLE IF NOT EXISTS cp_dance_world_events (
    owner_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    object_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, world_id, event_id)
  )
`;

export const createCpDanceWorldEventsIndex = `
  CREATE INDEX IF NOT EXISTS cp_dance_world_events_lookup_idx
  ON cp_dance_world_events (owner_id, world_id, turn DESC)
`;

export const createCpDanceStoryPublicEventsTable = `
  CREATE TABLE IF NOT EXISTS cp_dance_story_public_events (
    owner_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    turn INTEGER NOT NULL,
    scene_id TEXT NOT NULL,
    beat_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('player', 'director', 'character', 'runtime')),
    object_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, world_id, event_id)
  )
`;

export const createCpDanceStoryPublicEventsIndex = `
  CREATE INDEX IF NOT EXISTS cp_dance_story_public_events_lookup_idx
  ON cp_dance_story_public_events (owner_id, world_id, turn ASC)
`;

export const createCpDanceStorySummaryRevisionsTable = `
  CREATE TABLE IF NOT EXISTS cp_dance_story_summary_revisions (
    owner_id TEXT NOT NULL,
    world_id TEXT NOT NULL,
    summary_id TEXT NOT NULL,
    revision_id TEXT NOT NULL,
    base_revision_id TEXT,
    scope TEXT NOT NULL CHECK (scope IN ('scene', 'beat', 'story')),
    covered_through_event_id TEXT NOT NULL,
    object_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (owner_id, world_id, revision_id)
  )
`;

export const createCpDanceStorySummaryRevisionsIndex = `
  CREATE INDEX IF NOT EXISTS cp_dance_story_summary_revisions_lookup_idx
  ON cp_dance_story_summary_revisions (owner_id, world_id, created_at ASC)
`;
