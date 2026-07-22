CREATE TABLE IF NOT EXISTS `cp_dance_memory_documents` (
  `owner_id` text NOT NULL,
  `world_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `document_id` text NOT NULL,
  `path` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('general', 'character', 'topic')),
  `subject_agent_id` text,
  `latest_revision_id` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`owner_id`, `world_id`, `agent_id`, `document_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cp_dance_memory_documents_lookup_idx`
ON `cp_dance_memory_documents` (`owner_id`, `world_id`, `agent_id`, `updated_at` DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cp_dance_memory_revisions` (
  `owner_id` text NOT NULL,
  `world_id` text NOT NULL,
  `agent_id` text NOT NULL,
  `document_id` text NOT NULL,
  `revision_id` text NOT NULL,
  `base_revision_id` text,
  `created_turn` integer NOT NULL,
  `epistemic_status` text NOT NULL CHECK (`epistemic_status` IN ('observed', 'inferred', 'rumor')),
  `object_key` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`owner_id`, `world_id`, `agent_id`, `document_id`, `revision_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cp_dance_world_events` (
  `owner_id` text NOT NULL,
  `world_id` text NOT NULL,
  `event_id` text NOT NULL,
  `turn` integer NOT NULL,
  `object_key` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`owner_id`, `world_id`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cp_dance_world_events_lookup_idx`
ON `cp_dance_world_events` (`owner_id`, `world_id`, `turn` DESC);
