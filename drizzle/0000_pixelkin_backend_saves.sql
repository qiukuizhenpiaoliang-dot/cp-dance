CREATE TABLE IF NOT EXISTS `pixelkin_saves` (
  `owner_id` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('world', 'character')),
  `record_id` text NOT NULL,
  `updated_at` text NOT NULL,
  `object_key` text NOT NULL,
  PRIMARY KEY (`owner_id`, `kind`, `record_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pixelkin_saves_owner_updated_idx`
ON `pixelkin_saves` (`owner_id`, `kind`, `updated_at` DESC);
