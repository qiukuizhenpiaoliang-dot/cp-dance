CREATE TABLE IF NOT EXISTS `cp_dance_story_public_events` (
  `owner_id` text NOT NULL,
  `world_id` text NOT NULL,
  `event_id` text NOT NULL,
  `turn` integer NOT NULL,
  `scene_id` text NOT NULL,
  `beat_id` text NOT NULL,
  `source` text NOT NULL CHECK (`source` IN ('player', 'director', 'character', 'runtime')),
  `object_key` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`owner_id`, `world_id`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cp_dance_story_public_events_lookup_idx`
ON `cp_dance_story_public_events` (`owner_id`, `world_id`, `turn` ASC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cp_dance_story_summary_revisions` (
  `owner_id` text NOT NULL,
  `world_id` text NOT NULL,
  `summary_id` text NOT NULL,
  `revision_id` text NOT NULL,
  `base_revision_id` text,
  `scope` text NOT NULL CHECK (`scope` IN ('scene', 'beat', 'story')),
  `covered_through_event_id` text NOT NULL,
  `object_key` text NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`owner_id`, `world_id`, `revision_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cp_dance_story_summary_revisions_lookup_idx`
ON `cp_dance_story_summary_revisions` (`owner_id`, `world_id`, `created_at` ASC);
