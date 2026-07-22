CREATE TABLE IF NOT EXISTS `cp_dance_save_revisions` (
  `owner_id` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('world', 'character')),
  `record_id` text NOT NULL,
  `revision_id` text NOT NULL,
  `updated_at` text NOT NULL,
  `object_key` text NOT NULL,
  PRIMARY KEY (`owner_id`, `kind`, `record_id`, `revision_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `cp_dance_save_revisions_lookup_idx`
ON `cp_dance_save_revisions` (`owner_id`, `kind`, `record_id`, `updated_at` DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cp_dance_assets` (
  `owner_id` text NOT NULL,
  `asset_id` text NOT NULL,
  `object_key` text NOT NULL,
  `mime_type` text NOT NULL,
  `byte_size` integer NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`owner_id`, `asset_id`)
);
