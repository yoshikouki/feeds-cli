CREATE TABLE `feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_name_unique` ON `feeds` (`name`);
--> statement-breakpoint
CREATE TABLE `feed_aliases` (
	`feed_id` text NOT NULL,
	`alias` text NOT NULL,
	PRIMARY KEY(`feed_id`, `alias`),
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_aliases_alias_unique` ON `feed_aliases` (`alias`);
--> statement-breakpoint
CREATE TABLE `feed_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`scrape_config` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_sources_feed_url_unique` ON `feed_sources` (`feed_id`, `url`);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_sources_feed_position_unique` ON `feed_sources` (`feed_id`, `position`);
--> statement-breakpoint
CREATE INDEX `feed_sources_feed_idx` ON `feed_sources` (`feed_id`);
--> statement-breakpoint
CREATE TABLE `feed_source_tags` (
	`feed_source_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`feed_source_id`, `tag`),
	FOREIGN KEY (`feed_source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feed_source_tags_tag_idx` ON `feed_source_tags` (`tag`);
--> statement-breakpoint
CREATE TABLE `feed_source_states` (
	`feed_source_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`last_scanned_at` text,
	`last_article_at` text,
	`last_error` text,
	FOREIGN KEY (`feed_source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `canonical_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_url` text NOT NULL,
	`dedup_hash` text,
	`title` text NOT NULL,
	`summary` text,
	`content` text,
	`language` text,
	`published_at` text,
	`updated_at` text,
	`first_discovered_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_record_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canonical_articles_dedup_hash_unique` ON `canonical_articles` (`dedup_hash`) WHERE `dedup_hash` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `canonical_articles_published_idx` ON `canonical_articles` (`published_at`);
--> statement-breakpoint
CREATE TABLE `article_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_article_id` text NOT NULL,
	`feed_id` text NOT NULL,
	`feed_source_id` text NOT NULL,
	`source_url` text NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`summary` text,
	`content` text,
	`authors` text,
	`categories` text,
	`attachments` text,
	`published_at` text,
	`updated_at` text,
	`discovered_at` text NOT NULL,
	`language` text,
	`source_format` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_record_at` text NOT NULL,
	FOREIGN KEY (`canonical_article_id`) REFERENCES `canonical_articles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`feed_source_id`) REFERENCES `feed_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `article_occurrences_source_unique` ON `article_occurrences` (`feed_source_id`, `source_url`);
--> statement-breakpoint
CREATE INDEX `article_occurrences_feed_idx` ON `article_occurrences` (`feed_id`);
--> statement-breakpoint
CREATE INDEX `article_occurrences_canonical_idx` ON `article_occurrences` (`canonical_article_id`);
--> statement-breakpoint
CREATE INDEX `article_occurrences_discovered_idx` ON `article_occurrences` (`discovered_at`);
--> statement-breakpoint
CREATE TABLE `article_tags` (
	`canonical_article_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`canonical_article_id`, `tag`),
	FOREIGN KEY (`canonical_article_id`) REFERENCES `canonical_articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `article_tags_tag_idx` ON `article_tags` (`tag`);
--> statement-breakpoint
CREATE TABLE `article_states` (
	`canonical_article_id` text PRIMARY KEY NOT NULL,
	`read_at` text,
	`archived_at` text,
	`starred_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`canonical_article_id`) REFERENCES `canonical_articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `article_occurrences_fts` USING fts5(
	`title`,
	`summary`,
	`content`,
	content=`article_occurrences`,
	content_rowid=`rowid`
);
--> statement-breakpoint
CREATE TRIGGER `article_occurrences_fts_insert` AFTER INSERT ON `article_occurrences` BEGIN
	INSERT INTO article_occurrences_fts(rowid, title, summary, content)
	VALUES (new.rowid, new.title, new.summary, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER `article_occurrences_fts_delete` AFTER DELETE ON `article_occurrences` BEGIN
	INSERT INTO article_occurrences_fts(article_occurrences_fts, rowid, title, summary, content)
	VALUES ('delete', old.rowid, old.title, old.summary, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER `article_occurrences_fts_update` AFTER UPDATE ON `article_occurrences` BEGIN
	INSERT INTO article_occurrences_fts(article_occurrences_fts, rowid, title, summary, content)
	VALUES ('delete', old.rowid, old.title, old.summary, old.content);
	INSERT INTO article_occurrences_fts(rowid, title, summary, content)
	VALUES (new.rowid, new.title, new.summary, new.content);
END;
